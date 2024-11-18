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
};

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
}

export function upsertWorkoutLogInState(workoutLog) {
  const nextLogs = [...appState.workoutLogs];
  const existingIndex = workoutLog.id
    ? nextLogs.findIndex((log) => log.id === workoutLog.id)
    : -1;

  if (existingIndex >= 0) {
    nextLogs[existingIndex] = workoutLog;
  } else {
    nextLogs.push(workoutLog);
  }

  appState.workoutLogs = nextLogs.sort(sortByDateAsc);
}

export function removeDailyLogFromState(date) {
  appState.dailyLogs = appState.dailyLogs.filter((log) => log.date !== date);
}

export function removeWorkoutLogFromState(id) {
  appState.workoutLogs = appState.workoutLogs.filter((log) => log.id !== id);
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
