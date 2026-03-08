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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { db, assertFirebaseConfigured } from "./firebase.js";
import {
  appState,
  requireAuthenticatedUser,
  upsertDailyLogInState,
  upsertWorkoutLogInState,
  getExistingDailyLog,
  removeDailyLogFromState,
  removeWorkoutLogFromState,
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

import { OFFLINE_PREVIEW_STORAGE_KEY, LOCAL_WORKSPACE_SCHEMA_VERSION } from "./config.js";

// Keep comfortably below Firestore's 500-operation transaction/batch limit.
// This leaves room for a future import to add related metadata atomically.
const FIRESTORE_BATCH_SIZE = 450;

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

function getUserWorkoutLogDoc(uid, logId) {
  return doc(db, "users", uid, "workoutLogs", logId);
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
  const user = requireAuthenticatedUser();
  const existingLog = replace ? null : getExistingDailyLog(dailyLog.date);
  const mergedLog = mergeDailyLogs(existingLog ?? createEmptyDailyLog(dailyLog.date), dailyLog);
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
  await setDoc(getUserDailyLogDoc(user.uid, normalizedLog.date), clonePlainData(normalizedLog), {
    merge: true,
  });

  upsertDailyLogInState(normalizedLog);
  return normalizedLog;
}

/**
 * Imports daily logs in deterministic, bounded batches.
 *
 * Repeated dates in one source are folded in source order before any write, so
 * the final row wins only for fields it supplies and can never race another
 * write to the same Firestore document. State is advanced after each committed
 * batch; if a later batch fails, callers receive the exact persisted count.
 */
export async function importDailyLogs(dailyLogs) {
  const user = requireAuthenticatedUser();
  const mergedByDate = new Map();

  for (const incomingLog of dailyLogs) {
    const existingLog =
      mergedByDate.get(incomingLog.date) ??
      getExistingDailyLog(incomingLog.date) ??
      createEmptyDailyLog(incomingLog.date);
    const normalizedLog = normalizeDailyLog(mergeDailyLogs(existingLog, incomingLog));
    mergedByDate.set(normalizedLog.date, normalizedLog);
  }

  const logs = [...mergedByDate.values()];
  const duplicateRows = dailyLogs.length - logs.length;

  if (appState.previewMode) {
    const previousLogs = appState.dailyLogs;
    try {
      logs.forEach(upsertDailyLogInState);
      persistOfflinePreviewWorkspace();
    } catch (error) {
      appState.dailyLogs = previousLogs;
      throw createPartialImportError(
        "Preview import could not be saved to browser storage; no rows were imported.",
        { dailyImported: 0, workoutImported: 0, workoutSkipped: 0 },
        error,
      );
    }

    return { dailyImported: logs.length, duplicateRows };
  }

  assertFirebaseConfigured();
  let dailyImported = 0;

  try {
    for (let index = 0; index < logs.length; index += FIRESTORE_BATCH_SIZE) {
      const chunk = logs.slice(index, index + FIRESTORE_BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((log) => {
        batch.set(getUserDailyLogDoc(user.uid, log.date), clonePlainData(log), { merge: true });
      });
      await batch.commit();
      chunk.forEach(upsertDailyLogInState);
      dailyImported += chunk.length;
    }
  } catch (error) {
    throw createPartialImportError(
      "The CSV import stopped before every row could be saved.",
      { dailyImported, workoutImported: 0, workoutSkipped: 0 },
      error,
    );
  }

  return { dailyImported, duplicateRows };
}

/**
 * Creates a workout log or replaces an existing one when it carries an `id`.
 * New cloud logs receive an auto-generated Firestore document ID; the returned
 * object always carries it so future edits/deletes address the same session.
 */
export async function saveWorkoutLog(workoutLog) {
  const user = requireAuthenticatedUser();
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
  const { id, ...payload } = normalizedLog;
  let savedLog;

  if (id) {
    await setDoc(getUserWorkoutLogDoc(user.uid, id), clonePlainData(payload));
    savedLog = normalizedLog;
  } else {
    const docRef = await addDoc(getUserWorkoutLogsCollection(user.uid), clonePlainData(payload));
    savedLog = { ...normalizedLog, id: docRef.id };
  }

  upsertWorkoutLogInState(savedLog);
  return savedLog;
}

/** Deletes one daily log by its date-backed document ID. */
export async function deleteDailyLog(date) {
  const user = requireAuthenticatedUser();
  const existingLog = getExistingDailyLog(date);
  if (!existingLog) return false;

  if (appState.previewMode) {
    const previousLogs = appState.dailyLogs;
    removeDailyLogFromState(date);
    try {
      persistOfflinePreviewWorkspace();
    } catch (error) {
      appState.dailyLogs = previousLogs;
      throw error;
    }
    return true;
  }

  assertFirebaseConfigured();
  await deleteDoc(getUserDailyLogDoc(user.uid, date));
  removeDailyLogFromState(date);
  return true;
}

/** Deletes one workout log by its stable Firestore/offline ID. */
export async function deleteWorkoutLog(id) {
  const user = requireAuthenticatedUser();
  if (!id || !appState.workoutLogs.some((log) => log.id === id)) return false;

  if (appState.previewMode) {
    const previousLogs = appState.workoutLogs;
    removeWorkoutLogFromState(id);
    try {
      persistOfflinePreviewWorkspace();
    } catch (error) {
      appState.workoutLogs = previousLogs;
      throw error;
    }
    return true;
  }

  assertFirebaseConfigured();
  await deleteDoc(getUserWorkoutLogDoc(user.uid, id));
  removeWorkoutLogFromState(id);
  return true;
}

/** Persists the user's preference/target settings to Firestore. */
export async function saveUserSettings(userSettings) {
  const user = requireAuthenticatedUser();
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
  await setDoc(getUserSettingsDoc(user.uid), clonePlainData(normalizedSettings), { merge: true });

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
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
      lastSeenAt: new Date().toISOString(),
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
    const raw = localStorage.getItem(OFFLINE_PREVIEW_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.hasOwn(parsed, "schemaVersion") &&
      parsed.schemaVersion !== 1 &&
      parsed.schemaVersion !== LOCAL_WORKSPACE_SCHEMA_VERSION
    ) {
      throw new Error(
        "This offline preview was created by an unsupported app version. Its stored data was left untouched.",
      );
    }

    return normalizeWorkspacePayload(parsed);
  } catch (error) {
    if (error.message?.includes("unsupported app version")) {
      throw error;
    }
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
        dailyLogs: appState.dailyLogs,
        workoutLogs: appState.workoutLogs,
        profile: {
          displayName: appState.currentUser?.displayName || "Offline Preview",
          email: appState.currentUser?.email || "preview@health-ledger.local",
          photoURL: appState.currentUser?.photoURL || "",
        },
      }),
    );
  } catch (error) {
    console.error("persistOfflinePreviewWorkspace:", error);
    throw new Error(
      "Preview data could not be saved to browser storage (it may be full or blocked), so this change was not stored.",
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
    appState.workoutLogs.map((log) => getWorkoutSignature(log)),
  );

  let dailyImported = 0;
  let workoutImported = 0;
  let workoutSkipped = 0;

  try {
    const dailyResult = await importDailyLogs(normalizedBackup.dailyLogs);
    dailyImported = dailyResult.dailyImported;

    const uniqueWorkouts = [];
    for (const workout of normalizedBackup.workoutLogs) {
      const signature = getWorkoutSignature(workout);
      if (existingWorkoutSignatures.has(signature)) {
        workoutSkipped += 1;
        continue;
      }

      existingWorkoutSignatures.add(signature);
      uniqueWorkouts.push(normalizeWorkoutLog(workout));
    }

    workoutImported = await importWorkoutLogs(uniqueWorkouts);

    // Only restore targets the backup actually carried; otherwise a logs-only
    // file would reset the user's saved settings to defaults.
    if (normalizedBackup.hasUserSettings) {
      await saveUserSettings(normalizedBackup.userSettings);
    }
  } catch (error) {
    const progress = error.importProgress || {};
    throw createPartialImportError(
      "The backup import stopped before every item could be saved.",
      {
        dailyImported: Math.max(progress.dailyImported ?? 0, dailyImported),
        workoutImported: Math.max(progress.workoutImported ?? 0, workoutImported),
        workoutSkipped,
      },
      error,
    );
  }

  return {
    version: normalizedBackup.version,
    dailyImported,
    workoutImported,
    workoutSkipped,
  };
}

/** Writes unique backup workouts in bounded batches and keeps state truthful on partial failure. */
async function importWorkoutLogs(workouts) {
  if (workouts.length === 0) return 0;

  const user = requireAuthenticatedUser();

  if (appState.previewMode) {
    const previousLogs = appState.workoutLogs;
    const savedWorkouts = workouts.map((workout) => ({
      ...workout,
      id: workout.id || generateOfflineId(),
    }));

    try {
      savedWorkouts.forEach(upsertWorkoutLogInState);
      persistOfflinePreviewWorkspace();
    } catch (error) {
      appState.workoutLogs = previousLogs;
      throw createPartialImportError(
        "Preview import could not be saved to browser storage; no workouts were imported.",
        { dailyImported: 0, workoutImported: 0, workoutSkipped: 0 },
        error,
      );
    }

    return savedWorkouts.length;
  }

  assertFirebaseConfigured();
  let workoutImported = 0;

  try {
    for (let index = 0; index < workouts.length; index += FIRESTORE_BATCH_SIZE) {
      const chunk = workouts.slice(index, index + FIRESTORE_BATCH_SIZE);
      const batch = writeBatch(db);
      const savedWorkouts = chunk.map((workout) => {
        const docRef = doc(getUserWorkoutLogsCollection(user.uid));
        const payload = { ...workout };
        delete payload.id;
        batch.set(docRef, clonePlainData(payload));
        return { ...workout, id: docRef.id };
      });
      await batch.commit();
      savedWorkouts.forEach(upsertWorkoutLogInState);
      workoutImported += savedWorkouts.length;
    }
  } catch (error) {
    throw createPartialImportError(
      "The backup import stopped before every workout could be saved.",
      { dailyImported: 0, workoutImported, workoutSkipped: 0 },
      error,
    );
  }

  return workoutImported;
}

function createPartialImportError(message, importProgress, cause) {
  const error = new Error(message, { cause });
  error.name = "PartialImportError";
  error.importProgress = importProgress;
  return error;
}
