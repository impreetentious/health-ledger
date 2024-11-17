/*
  history.js — history tables, storage status, and backup export
  ---------------------------------------------------------------------------
  Renders the Daily Log History and Workout History tables, the storage
  status caption in the Backup Vault panel, and handles the full-backup JSON
  export.
*/

import { dom } from "./dom.js";
import { appState } from "./state.js";
import {
  sortByDateDesc,
  escapeHtml,
  formatMaybeNumber,
  formatMacroHistory,
  formatWaterHistory,
  formatBytes,
  getLocalDateString,
  getFriendlyUserName,
} from "./utils.js";
import { showStatusMessage } from "./ui.js";
import { BACKUP_SCHEMA_VERSION } from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// History tables
// ─────────────────────────────────────────────────────────────────────────────

/** Renders both the daily log and workout history tables, newest first. */
export function renderHistoryTables() {
  const dailyLogs = [...appState.dailyLogs].sort(sortByDateDesc);
  const workoutLogs = [...appState.workoutLogs].sort(sortByDateDesc);

  if (!appState.currentUser) {
    dom.dailyHistoryBody.innerHTML =
      `<tr><td colspan="10" class="empty-state">Sign in to load daily history.</td></tr>`;
    dom.workoutHistoryBody.innerHTML =
      `<tr><td colspan="5" class="empty-state">Sign in to load workout history.</td></tr>`;
    return;
  }

  dom.dailyHistoryBody.innerHTML = dailyLogs.length
    ? dailyLogs
        .map(
          (log) => `
            <tr>
              <td>${escapeHtml(log.date)}</td>
              <td>${formatMaybeNumber(log.weight)}</td>
              <td>${formatMaybeNumber(log.calories)}</td>
              <td>${formatMaybeNumber(log.macros.protein)}</td>
              <td>${escapeHtml(formatMacroHistory(log))}</td>
              <td>${formatMaybeNumber(log.steps)}</td>
              <td>${escapeHtml(formatWaterHistory(log, appState.userSettings))}</td>
              <td>${formatMaybeNumber(log.sleep)}</td>
              <td>${formatMaybeNumber(log.energy)}</td>
              <td>${escapeHtml(log.notes || "-")}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="10" class="empty-state">No daily logs saved yet.</td></tr>`;

  dom.workoutHistoryBody.innerHTML = workoutLogs.length
    ? workoutLogs
        .map((log) => {
          const totalSets = log.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
          return `
            <tr>
              <td>${escapeHtml(log.date)}</td>
              <td>${escapeHtml(log.session_type || "-")}</td>
              <td>${formatMaybeNumber(log.duration)} min</td>
              <td>${escapeHtml(String(log.exercises.length))}</td>
              <td>${escapeHtml(String(totalSets))}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5" class="empty-state">No workout logs saved yet.</td></tr>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updates the Backup Vault status caption to reflect offline preview,
 * signed-out, or signed-in + synced state, including an approximate byte
 * size of the user's current data.
 */
export function renderStorageStatus() {
  if (appState.previewMode) {
    const snapshot = JSON.stringify({
      userSettings: appState.userSettings,
      dailyLogs: appState.dailyLogs,
      workoutLogs: appState.workoutLogs,
      profile: {
        displayName: appState.currentUser?.displayName || "",
        photoURL: appState.currentUser?.photoURL || "",
      },
    });

    dom.storageStatus.textContent =
      `Offline preview is active. ${appState.dailyLogs.length} daily logs and ` +
      `${appState.workoutLogs.length} workouts are being stored in this browser only, ` +
      `using about ${formatBytes(new Blob([snapshot]).size)} locally.`;
    return;
  }

  if (!appState.currentUser) {
    dom.storageStatus.textContent =
      "Sign in to sync your daily logs, workouts, and targets to Firestore. " +
      "When connected, all records stay scoped under your authenticated user ID.";
    return;
  }

  const snapshot = JSON.stringify({
    userSettings: appState.userSettings,
    dailyLogs: appState.dailyLogs,
    workoutLogs: appState.workoutLogs,
  });

  dom.storageStatus.textContent =
    `Cloud sync is active for ${appState.currentUser.email || getFriendlyUserName(appState.currentUser)}. ` +
    `${appState.dailyLogs.length} daily logs and ${appState.workoutLogs.length} workouts ` +
    `currently use about ${formatBytes(new Blob([snapshot]).size)} in this export. ` +
    `Firestore reads and writes stay scoped to users/${appState.currentUser.uid}/...`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup export
// ─────────────────────────────────────────────────────────────────────────────

/** Builds and downloads a full JSON backup of the user's current workspace. */
export function handleBackupExport() {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: BACKUP_SCHEMA_VERSION,
    user: appState.currentUser
      ? {
          uid: appState.currentUser.uid,
          email: appState.currentUser.email || "",
          displayName: appState.currentUser.displayName || "",
        }
      : null,
    userSettings: appState.userSettings,
    dailyLogs: appState.dailyLogs,
    workoutLogs: appState.workoutLogs,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `health-ledger-backup-${getLocalDateString()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);

  showStatusMessage("Backup exported. You can archive it or re-import it later.");
}
