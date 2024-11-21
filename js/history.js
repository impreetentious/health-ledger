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

const HISTORY_PAGE_SIZE = 30;

const historyFilters = {
  from: "",
  to: "",
  query: "",
  dailyVisible: HISTORY_PAGE_SIZE,
  workoutVisible: HISTORY_PAGE_SIZE,
};

/**
 * Reads the filter controls, normalises their values, and returns both history
 * record types to their first page. Date inputs provide valid ISO strings in
 * normal use; trimming here also keeps programmatic callers harmless.
 */
export function applyHistoryFiltersFromControls() {
  historyFilters.from = dom.historyDateFrom.value.trim();
  historyFilters.to = dom.historyDateTo.value.trim();
  historyFilters.query = dom.historySearch.value.trim().toLocaleLowerCase();
  historyFilters.dailyVisible = HISTORY_PAGE_SIZE;
  historyFilters.workoutVisible = HISTORY_PAGE_SIZE;
  renderHistoryTables();
}

/** Clears all history controls and returns both tables to their first page. */
export function clearHistoryFilters() {
  historyFilters.from = "";
  historyFilters.to = "";
  historyFilters.query = "";
  historyFilters.dailyVisible = HISTORY_PAGE_SIZE;
  historyFilters.workoutVisible = HISTORY_PAGE_SIZE;
  dom.historyDateFrom.value = "";
  dom.historyDateTo.value = "";
  dom.historySearch.value = "";
  renderHistoryTables();
}

/** Reveals the next bounded page for one history table. */
export function loadMoreHistory(logType) {
  if (logType === "daily") {
    historyFilters.dailyVisible += HISTORY_PAGE_SIZE;
  } else if (logType === "workout") {
    historyFilters.workoutVisible += HISTORY_PAGE_SIZE;
  } else {
    return;
  }
  renderHistoryTables();
}

/** Renders both the daily log and workout history tables, newest first. */
export function renderHistoryTables() {
  const dailyLogs = [...appState.dailyLogs].sort(sortByDateDesc);
  const workoutLogs = [...appState.workoutLogs].sort(sortByDateDesc);

  if (!appState.currentUser) {
    dom.dailyHistoryBody.innerHTML =
      `<tr><td colspan="11" class="empty-state">Sign in to load daily history.</td></tr>`;
    dom.workoutHistoryBody.innerHTML =
      `<tr><td colspan="6" class="empty-state">Sign in to load workout history.</td></tr>`;
    dom.dailyHistorySummary.textContent = "Sign in to load daily history.";
    dom.workoutHistorySummary.textContent = "Sign in to load workout history.";
    dom.historyFilterStatus.textContent = "Sign in to filter your private history.";
    dom.dailyHistoryLoadMore.hidden = true;
    dom.workoutHistoryLoadMore.hidden = true;
    return;
  }

  const hasInvalidRange = Boolean(historyFilters.from && historyFilters.to && historyFilters.from > historyFilters.to);
  const filteredDailyLogs = hasInvalidRange ? [] : dailyLogs.filter(matchesDailyHistoryFilters);
  const filteredWorkoutLogs = hasInvalidRange ? [] : workoutLogs.filter(matchesWorkoutHistoryFilters);
  const visibleDailyLogs = filteredDailyLogs.slice(0, historyFilters.dailyVisible);
  const visibleWorkoutLogs = filteredWorkoutLogs.slice(0, historyFilters.workoutVisible);

  dom.dailyHistoryBody.innerHTML = visibleDailyLogs.length
    ? visibleDailyLogs
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
              <td>
                <div class="table-actions">
                  <button type="button" class="secondary-button table-action" data-history-action="edit-daily" data-log-date="${escapeHtml(log.date)}">Edit</button>
                  <button type="button" class="danger-button table-action" data-history-action="delete-daily" data-log-date="${escapeHtml(log.date)}">Delete</button>
                </div>
              </td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="11" class="empty-state">${getDailyEmptyMessage(dailyLogs.length, hasInvalidRange)}</td></tr>`;

  dom.workoutHistoryBody.innerHTML = visibleWorkoutLogs.length
    ? visibleWorkoutLogs
        .map((log) => {
          const totalSets = log.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
          return `
            <tr>
              <td>${escapeHtml(log.date)}</td>
              <td>${escapeHtml(log.session_type || "-")}</td>
              <td>${formatMaybeNumber(log.duration)} min</td>
              <td>${escapeHtml(String(log.exercises.length))}</td>
              <td>${escapeHtml(String(totalSets))}</td>
              <td>
                <div class="table-actions">
                  <button type="button" class="secondary-button table-action" data-history-action="edit-workout" data-log-id="${escapeHtml(log.id)}">Edit</button>
                  <button type="button" class="danger-button table-action" data-history-action="delete-workout" data-log-id="${escapeHtml(log.id)}">Delete</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="6" class="empty-state">${getWorkoutEmptyMessage(workoutLogs.length, hasInvalidRange)}</td></tr>`;

  updateHistoryPagination({
    dailyTotal: filteredDailyLogs.length,
    workoutTotal: filteredWorkoutLogs.length,
    dailyShown: visibleDailyLogs.length,
    workoutShown: visibleWorkoutLogs.length,
    hasInvalidRange,
  });
}

function matchesDailyHistoryFilters(log) {
  if (!matchesDateRange(log.date)) return false;
  if (!historyFilters.query) return true;
  return String(log.notes || "").toLocaleLowerCase().includes(historyFilters.query);
}

function matchesWorkoutHistoryFilters(log) {
  if (!matchesDateRange(log.date)) return false;
  if (!historyFilters.query) return true;
  const searchableWorkout = [
    log.session_type,
    ...(log.exercises || []).flatMap((exercise) => [exercise.name, exercise.muscle_group]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return searchableWorkout.includes(historyFilters.query);
}

function matchesDateRange(date) {
  return (
    (!historyFilters.from || date >= historyFilters.from) &&
    (!historyFilters.to || date <= historyFilters.to)
  );
}

function getDailyEmptyMessage(total, hasInvalidRange) {
  if (hasInvalidRange) return "Choose a From date on or before the To date.";
  return total ? "No daily logs match the current filters." : "No daily logs saved yet.";
}

function getWorkoutEmptyMessage(total, hasInvalidRange) {
  if (hasInvalidRange) return "Choose a From date on or before the To date.";
  return total ? "No workout logs match the current filters." : "No workout logs saved yet.";
}

function updateHistoryPagination({ dailyTotal, workoutTotal, dailyShown, workoutShown, hasInvalidRange }) {
  dom.dailyHistorySummary.textContent = buildHistorySummary("daily log", dailyShown, dailyTotal, hasInvalidRange);
  dom.workoutHistorySummary.textContent = buildHistorySummary("workout", workoutShown, workoutTotal, hasInvalidRange);
  dom.dailyHistoryLoadMore.hidden = dailyShown >= dailyTotal;
  dom.workoutHistoryLoadMore.hidden = workoutShown >= workoutTotal;

  if (hasInvalidRange) {
    dom.historyFilterStatus.textContent = "Choose a From date on or before the To date.";
    return;
  }

  const filtersApplied = Boolean(historyFilters.from || historyFilters.to || historyFilters.query);
  const totals = `${dailyTotal} daily ${pluralize("log", dailyTotal)} and ${workoutTotal} ${pluralize("workout", workoutTotal)}`;
  dom.historyFilterStatus.textContent = filtersApplied
    ? `Filters match ${totals}.`
    : `Showing all ${totals}.`;
}

function buildHistorySummary(label, shown, total, hasInvalidRange) {
  if (hasInvalidRange) return "Adjust the date range to view history.";
  if (total === 0) return `No matching ${pluralize(label, total)}.`;
  return shown < total
    ? `Showing ${shown} of ${total} ${pluralize(label, total)}.`
    : `Showing ${total} ${pluralize(label, total)}.`;
}

function pluralize(label, count) {
  return count === 1 ? label : `${label}s`;
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
