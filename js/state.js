/*
  state.js — global application state and its direct mutations
  ---------------------------------------------------------------------------
  All state reads and writes that are shared across modules live here.
  No DOM access and no Firebase calls — those belong in ui.js and db.js.
*/

import { getCurrentWeekKey, cloneDefaultSettings, sortByDateAsc } from "./utils.js";

export const appState = {
  currentUser: null,
  selectedWeekKey: getCurrentWeekKey(),
  dailyLogs: [],
  workoutLogs: [],
  userSettings: cloneDefaultSettings(),
  authPending: false,
  pendingGoogleCredential: null,
  pendingLinkEmail: "",
  previewMode: false,
  authGeneration: 0,
  workspaceRevision: 0,
  restoreApplying: false,
};

let operationSequence = 0;
const owners = new Map();

export function invalidateSession() {
  appState.authGeneration += 1;
  appState.workspaceRevision += 1;
  appState.restoreApplying = false;
  owners.clear();
}

export function captureSession(owner) {
  const token = {
    generation: appState.authGeneration,
    uid: appState.currentUser?.uid ?? null,
    preview: appState.previewMode,
    operationId: ++operationSequence,
    owner,
  };
  if (owner) owners.set(owner, token.operationId);
  return token;
}

export function isSessionCurrent(token) {
  return (
    token.generation === appState.authGeneration &&
    token.uid === (appState.currentUser?.uid ?? null) &&
    token.preview === appState.previewMode &&
    (!token.owner || owners.get(token.owner) === token.operationId)
  );
}

export function assertSessionCurrent(token, importProgress) {
  if (isSessionCurrent(token)) return;
  const error = new Error("This operation belongs to an earlier account session.");
  error.name = "StaleSessionError";
  if (importProgress) error.importProgress = importProgress;
  throw error;
}

export function markWorkspaceChanged() {
  appState.workspaceRevision += 1;
}

// ── Reads ──────────────────────────────────────────────────────────────────

export function getExistingDailyLog(date) {
  return appState.dailyLogs.find((log) => log.date === date) || null;
}

export function requireAuthenticatedUser() {
  if (!appState.currentUser) {
    throw new Error("You must be signed in to save data.");
  }
  return appState.currentUser;
}

// ── Writes ─────────────────────────────────────────────────────────────────

export function upsertDailyLogInState(dailyLog) {
  const nextLogs = [...appState.dailyLogs];
  const existingIndex = nextLogs.findIndex((log) => log.date === dailyLog.date);

  if (existingIndex >= 0) {
    nextLogs[existingIndex] = dailyLog;
  } else {
    nextLogs.push(dailyLog);
  }

  appState.dailyLogs = nextLogs.sort(sortByDateAsc);
  markWorkspaceChanged();
}

export function upsertWorkoutLogInState(workoutLog) {
  const nextLogs = [...appState.workoutLogs];
  const existingIndex = workoutLog.id ? nextLogs.findIndex((log) => log.id === workoutLog.id) : -1;

  if (existingIndex >= 0) {
    nextLogs[existingIndex] = workoutLog;
  } else {
    nextLogs.push(workoutLog);
  }

  appState.workoutLogs = nextLogs.sort(sortByDateAsc);
  markWorkspaceChanged();
}

export function removeDailyLogFromState(date) {
  appState.dailyLogs = appState.dailyLogs.filter((log) => log.date !== date);
  markWorkspaceChanged();
}

export function removeWorkoutLogFromState(id) {
  appState.workoutLogs = appState.workoutLogs.filter((log) => log.id !== id);
  markWorkspaceChanged();
}

export function clearUserDataState() {
  appState.dailyLogs = [];
  appState.workoutLogs = [];
  appState.userSettings = cloneDefaultSettings();
  appState.selectedWeekKey = getCurrentWeekKey();
}

export function clearPendingGoogleLink() {
  appState.pendingGoogleCredential = null;
  appState.pendingLinkEmail = "";
}
