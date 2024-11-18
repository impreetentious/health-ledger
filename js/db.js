/*
  db.js — Firestore operations and offline-preview persistence
  ---------------------------------------------------------------------------
  Every function that reads from or writes to Firestore (or localStorage in
  offline preview mode) lives here. No DOM access, no UI calls.

  Private helpers (getUserProfileDoc etc.) are not exported — callers use the
  high-level save / load functions only.
*/

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { db, assertFirebaseConfigured } from "./firebase.js";
import {
  appState,
  requireAuthenticatedUser,
  upsertDailyLogInState,
  upsertWorkoutLogInState,
  getExistingDailyLog,
} from "./state.js";
import {
  normalizeDailyLog,
  normalizeWorkoutLog,
  normalizeUserSettings,
  normalizeWorkspacePayload,
  normalizeBackupPayload,
  cloneDefaultSettings,
  clonePlainData,
  mergeDailyLogs,
  createEmptyDailyLog,
  generateOfflineId,
  getWorkoutSignature,
  sortByDateAsc,
} from "./utils.js";
import {
  OFFLINE_PREVIEW_STORAGE_KEY,
  LOCAL_WORKSPACE_SCHEMA_VERSION,
} from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Private — Firestore document / collection reference builders
// ─────────────────────────────────────────────────────────────────────────────

function getUserProfileDoc(uid) {
  return doc(db, "users", uid);
}

function getUserSettingsDoc(uid) {
  return doc(db, "users", uid, "meta", "settings");
}

function getUserDailyLogsCollection(uid) {
  return collection(db, "users", uid, "dailyLogs");
}

function getUserDailyLogDoc(uid, logId) {
  return doc(db, "users", uid, "dailyLogs", logId);
}

function getUserWorkoutLogsCollection(uid) {
  return collection(db, "users", uid, "workoutLogs");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — workspace hydration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the user's settings, all daily logs, and all workout logs from
 * Firestore in parallel, then writes them into appState.
 *
 * Callers (handleAuthStateChange in app.js) are responsible for triggering
 * any UI refresh after this resolves.
 */
export async function hydrateUserWorkspace(uid) {
  assertFirebaseConfigured();
  const [settingsSnapshot, dailyLogsSnapshot, workoutLogsSnapshot] = await Promise.all([
    getDoc(getUserSettingsDoc(uid)),
    getDocs(getUserDailyLogsCollection(uid)),
    getDocs(getUserWorkoutLogsCollection(uid)),
  ]);

  let settings = cloneDefaultSettings();

  if (settingsSnapshot.exists()) {
    settings = normalizeUserSettings(settingsSnapshot.data());
  } else {
    // First-ever sign-in: seed Firestore with default settings.
    await setDoc(getUserSettingsDoc(uid), clonePlainData(settings), { merge: true });
  }

  appState.userSettings = settings;

  appState.dailyLogs = dailyLogsSnapshot.docs
    .map((snapshot) => normalizeDailyLog({ id: snapshot.id, ...snapshot.data() }))
    .sort(sortByDateAsc);

  appState.workoutLogs = workoutLogsSnapshot.docs
    .map((snapshot) => normalizeWorkoutLog({ id: snapshot.id, ...snapshot.data() }))
    .sort(sortByDateAsc);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — save operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves (or merges) a daily log for the given date.
 * Uses the date string as the Firestore document ID so each date has exactly
 * one document. Partial objects are merged on top of any existing data.
 *
 * Pass `replace: true` for full-form saves: the incoming log is treated as
 * the complete record for that date, so fields the user cleared become null
 * instead of silently keeping their old values. Partial writers (quick-water,
 * CSV import, backup import) keep the default merge semantics.
 */
export async function saveDailyLog(dailyLog, { replace = false } = {}) {
  const user        = requireAuthenticatedUser();
  const existingLog = replace ? null : getExistingDailyLog(dailyLog.date);
  const mergedLog   = mergeDailyLogs(
    existingLog ?? createEmptyDailyLog(dailyLog.date),
    dailyLog,
  );
  const normalizedLog = normalizeDailyLog(mergedLog);

  if (appState.previewMode) {
    const previousLogs = appState.dailyLogs;
    upsertDailyLogInState(normalizedLog);
    try {
      persistOfflinePreviewWorkspace();
    } catch (error) {
      appState.dailyLogs = previousLogs;
      throw error;
    }
    return normalizedLog;
  }

  assertFirebaseConfigured();
  await setDoc(
    getUserDailyLogDoc(user.uid, normalizedLog.date),
    clonePlainData(normalizedLog),
    { merge: true },
  );

  upsertDailyLogInState(normalizedLog);
  return normalizedLog;
}

/**
 * Appends a new workout log document to Firestore.
 * Each workout gets its own auto-generated document ID (stored as `id` on the
 * returned object so delete operations can address it later).
 */
export async function saveWorkoutLog(workoutLog) {
  const user          = requireAuthenticatedUser();
  const normalizedLog = normalizeWorkoutLog(workoutLog);

  if (appState.previewMode) {
    const savedLog = { ...normalizedLog, id: normalizedLog.id || generateOfflineId() };
    const previousLogs = appState.workoutLogs;
    upsertWorkoutLogInState(savedLog);
    try {
      persistOfflinePreviewWorkspace();
    } catch (error) {
      appState.workoutLogs = previousLogs;
      throw error;
    }
    return savedLog;
  }

  assertFirebaseConfigured();
  // Strip the local `id` field before writing; Firestore assigns its own.
  const { id, ...payload } = normalizedLog;
  const docRef  = await addDoc(getUserWorkoutLogsCollection(user.uid), clonePlainData(payload));
  const savedLog = { ...normalizedLog, id: docRef.id };

  upsertWorkoutLogInState(savedLog);
  return savedLog;
}

/** Persists the user's preference/target settings to Firestore. */
export async function saveUserSettings(userSettings) {
  const user               = requireAuthenticatedUser();
  const normalizedSettings = normalizeUserSettings(userSettings);

  if (appState.previewMode) {
    const previousSettings = appState.userSettings;
    appState.userSettings = normalizedSettings;
    try {
      persistOfflinePreviewWorkspace();
    } catch (error) {
      appState.userSettings = previousSettings;
      throw error;
    }
    return normalizedSettings;
  }

  assertFirebaseConfigured();
  await setDoc(
    getUserSettingsDoc(user.uid),
    clonePlainData(normalizedSettings),
    { merge: true },
  );

  appState.userSettings = normalizedSettings;
  return normalizedSettings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — profile and account management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upserts the user's public profile document so it always reflects the
 * current displayName, photoURL, and last-seen timestamp.
 */
export async function ensureUserProfile(user) {
  if (appState.previewMode) {
    persistOfflinePreviewWorkspace();
    return;
  }

  assertFirebaseConfigured();
  await setDoc(
    getUserProfileDoc(user.uid),
    {
      uid:         user.uid,
      email:       user.email       || "",
      displayName: user.displayName || "",
      photoURL:    user.photoURL    || "",
      lastSeenAt:  new Date().toISOString(),
    },
    { merge: true },
  );
}

/**
 * Deletes all of a user's Firestore documents (daily logs, workout logs,
 * settings, and profile) in batches of 450 to stay within Firestore limits.
 */
export async function deleteUserWorkspace(uid) {
  assertFirebaseConfigured();
  const [dailyLogsSnapshot, workoutLogsSnapshot] = await Promise.all([
    getDocs(getUserDailyLogsCollection(uid)),
    getDocs(getUserWorkoutLogsCollection(uid)),
  ]);

  const docRefs = [
    ...dailyLogsSnapshot.docs.map((snapshot) => snapshot.ref),
    ...workoutLogsSnapshot.docs.map((snapshot) => snapshot.ref),
    getUserSettingsDoc(uid),
    getUserProfileDoc(uid),
  ];

  for (let i = 0; i < docRefs.length; i += 450) {
    const batch = writeBatch(db);
    docRefs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — offline preview persistence (localStorage)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the offline preview workspace from localStorage.
 * Returns a safe fallback structure if nothing is stored or the JSON is
 * malformed.
 */
export function readOfflinePreviewWorkspace() {
  try {
    const raw    = localStorage.getItem(OFFLINE_PREVIEW_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeWorkspacePayload(parsed);
  } catch (error) {
    console.error("readOfflinePreviewWorkspace:", error);
    return normalizeWorkspacePayload();
  }
}

/**
 * Serialises the current appState to localStorage.
 * No-ops when not in preview mode so it can be called unconditionally by
 * save helpers.
 *
 * Throws a user-readable Error when the write fails (quota, blocked storage)
 * so callers can roll back and report the failure — swallowing it here would
 * let saves claim success for data that vanishes on reload.
 */
export function persistOfflinePreviewWorkspace() {
  if (!appState.previewMode) return;

  try {
    localStorage.setItem(
      OFFLINE_PREVIEW_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: LOCAL_WORKSPACE_SCHEMA_VERSION,
        userSettings: appState.userSettings,
        dailyLogs:    appState.dailyLogs,
        workoutLogs:  appState.workoutLogs,
        profile: {
          displayName: appState.currentUser?.displayName || "Offline Preview",
          email:       appState.currentUser?.email       || "preview@health-ledger.local",
          photoURL:    appState.currentUser?.photoURL    || "",
        },
      }),
    );
  } catch (error) {
    console.error("persistOfflinePreviewWorkspace:", error);
    throw new Error(
      "Preview data could not be saved to browser storage (it may be full or blocked), so this change was not stored."
    );
  }
}

/**
 * Imports a full JSON backup into the current workspace.
 * Daily logs merge by date, workouts are de-duplicated by content signature,
 * and imported settings replace the active settings.
 */
export async function importWorkspaceBackup(backupPayload) {
  const normalizedBackup = normalizeBackupPayload(backupPayload);
  const existingWorkoutSignatures = new Set(
    appState.workoutLogs.map((log) => getWorkoutSignature(log))
  );

  let dailyImported = 0;
  let workoutImported = 0;
  let workoutSkipped = 0;

  for (const log of normalizedBackup.dailyLogs) {
    await saveDailyLog(log);
    dailyImported += 1;
  }

  for (const workout of normalizedBackup.workoutLogs) {
    const signature = getWorkoutSignature(workout);
    if (existingWorkoutSignatures.has(signature)) {
      workoutSkipped += 1;
      continue;
    }

    await saveWorkoutLog(workout);
    existingWorkoutSignatures.add(signature);
    workoutImported += 1;
  }

  // Only restore targets the backup actually carried; otherwise a logs-only
  // file would reset the user's saved settings to defaults.
  if (normalizedBackup.hasUserSettings) {
    await saveUserSettings(normalizedBackup.userSettings);
  }

  return {
    version: normalizedBackup.version,
    dailyImported,
    workoutImported,
    workoutSkipped,
  };
}
