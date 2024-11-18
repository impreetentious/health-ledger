/*
  dashboard.js — dashboard rendering
  ---------------------------------------------------------------------------
  Reads from appState and writes the dashboard view's DOM (summary copy, week
  selector, quick water, insight cards, alert cards). Delegates the actual
  chart drawing to charts.js, passing only the data slice each chart needs —
  charts.js never reads appState directly.
*/

import { dom } from "./dom.js";
import { appState, getExistingDailyLog } from "./state.js";
import {
  getAvailableWeekOptions,
  filterLogsByWindow,
  calculateAverage,
  isNumber,
  escapeHtml,
  formatLongDate,
  getCurrentWeekKey,
  getPreviousWeekInfo,
  toNumberOrNull,
  formatNumberForDisplay,
  getFriendlyUserName,
  getLocalDateString,
} from "./utils.js";
import { showStatusMessage } from "./ui.js";
import {
  destroyAllCharts,
  renderWeightChart,
  renderCalorieChart,
  renderProteinChart,
  renderStepsChart,
  renderWaterChart,
  renderMacroChart,
  renderVolumeChart,
} from "./charts.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public — orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders the full dashboard view: summary copy, week selector, quick water,
 * insight cards, alert cards, and every chart.
 * Falls back to the signed-out placeholder state when there is no current user.
 */
export function renderDashboard() {
  // Direct callers (week-select change, quick-water) hit this without a view
  // switch, so charts must be torn down here — not only in refreshCurrentView.
  destroyAllCharts();

  if (!appState.currentUser) {
    clearDashboardPanels("Sign in to view your private dashboard and Firestore-backed trends.");
    return;
  }

  dom.dashboardHeading.textContent = `Welcome back, ${getFriendlyUserName(appState.currentUser)}!`;

  const dailyLogs = appState.dailyLogs;
  const workoutLogs = appState.workoutLogs;
  const settings = appState.userSettings;
  const weekOptions = getAvailableWeekOptions(dailyLogs, workoutLogs);
  const selectedWeek = syncWeekSelector(weekOptions);
  const dailyLogsThisWeek = filterLogsByWindow(dailyLogs, selectedWeek);
  const workoutsThisWeek = filterLogsByWindow(workoutLogs, selectedWeek);

  const averageWeight = calculateAverage(
    dailyLogsThisWeek.map((log) => log.weight).filter(isNumber)
  );
  const averageCalories = calculateAverage(
    dailyLogsThisWeek.map((log) => log.calories).filter(isNumber)
  );
  const averageProtein = calculateAverage(
    dailyLogsThisWeek.map((log) => log.macros.protein).filter(isNumber)
  );
  const averageSteps = calculateAverage(
    dailyLogsThisWeek.map((log) => log.steps).filter(isNumber)
  );
  const totalWorkouts = workoutsThisWeek.length;

  dom.dashboardSummary.textContent =
    `Reviewing ${selectedWeek.label} with ${dailyLogsThisWeek.length} daily logs and ` +
    `${workoutsThisWeek.length} workouts.`;

  renderQuickWaterProgress();
  renderInsightCards(averageWeight, averageCalories, averageProtein, averageSteps, totalWorkouts);
  renderAlertCards(dailyLogs, selectedWeek, settings);

  // Chart drawing is contained so a missing Chart.js global (blocked CDN)
  // degrades to blank chart panels instead of bubbling into the hydration
  // recovery path in app.js, which would sign the user out and blame Firestore.
  try {
    renderWeightChart(dailyLogs, selectedWeek);
    renderCalorieChart(dailyLogsThisWeek, selectedWeek, settings.calorieTarget);
    renderProteinChart(dailyLogsThisWeek, selectedWeek, settings.proteinGramTarget);
    renderStepsChart(dailyLogsThisWeek, selectedWeek);
    renderWaterChart(dailyLogsThisWeek, selectedWeek, settings);
    renderMacroChart(dailyLogsThisWeek, settings.macroTarget);
    renderVolumeChart(workoutsThisWeek);
  } catch (error) {
    console.error(error);
    showStatusMessage(
      "Your data is loaded, but the charts could not be drawn (Chart.js failed to load). Check your connection and reload to retry.",
      true
    );
  }
}

/**
 * Resets the dashboard to its signed-out placeholder state with a custom
 * message. Also called directly by app.js's renderSignedOutState.
 */
export function clearDashboardPanels(message) {
  destroyAllCharts();
  dom.dashboardHeading.textContent = "Welcome to Health Ledger";
  dom.dashboardSummary.textContent = message;
  dom.dashboardToday.textContent = "Secure sync is paused";
  dom.dashboardWeekTitle.textContent = "Week Overview";
  dom.dashboardWeekCaption.textContent = "Sign in to load your weekly charts.";
  dom.dashboardWeekSelect.innerHTML = `<option value="${getCurrentWeekKey()}">Current week</option>`;
  renderQuickWaterProgress();
  dom.insightCards.innerHTML = "";
  dom.alertCards.innerHTML = `
    <article class="alert-card ok">
      <span>Account Required</span>
      <strong>Sign In</strong>
      <p>Your dashboard and forms unlock after Firebase Authentication confirms your session.</p>
    </article>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Private — week selector, quick water, insight cards, alert cards
// ─────────────────────────────────────────────────────────────────────────────

function syncWeekSelector(weekOptions) {
  const selected =
    weekOptions.find((option) => option.key === appState.selectedWeekKey) || weekOptions[0];

  appState.selectedWeekKey = selected.key;

  dom.dashboardWeekSelect.innerHTML = weekOptions
    .map(
      (option) =>
        `<option value="${option.key}" ${option.key === selected.key ? "selected" : ""}>${escapeHtml(option.label)}</option>`
    )
    .join("");

  dom.dashboardToday.textContent = `Today - ${formatLongDate(new Date())}`;
  dom.dashboardWeekTitle.textContent = `Week ${selected.week}, ${selected.year}`;
  dom.dashboardWeekCaption.textContent = `${selected.start} to ${selected.end}`;

  return selected;
}

function renderQuickWaterProgress() {
  const todayLog = getExistingDailyLog(getLocalDateString());
  const settings = appState.userSettings;
  const glasses = toNumberOrNull(todayLog?.water?.glasses) ?? 0;
  const targetGlasses =
    toNumberOrNull(todayLog?.water?.targetGlasses) ?? settings.waterTargetGlasses;

  dom.quickWaterProgress.textContent =
    `${formatNumberForDisplay(glasses)} / ${formatNumberForDisplay(targetGlasses)} Glasses`;
  dom.quickWaterButton.disabled = !appState.currentUser;
}

function renderInsightCards(averageWeight, averageCalories, averageProtein, averageSteps, totalWorkouts) {
  const cards = [
    {
      label: "Average Weight",
      value: isNumber(averageWeight) ? `${averageWeight.toFixed(1)} kg` : "No data",
      detail: "Only logged days are counted.",
    },
    {
      label: "Average Calories",
      value: isNumber(averageCalories) ? `${Math.round(averageCalories)} kcal` : "No data",
      detail: "Empty days stay out of the math.",
    },
    {
      label: "Average Protein",
      value: isNumber(averageProtein) ? `${Math.round(averageProtein)} g` : "No data",
      detail: "Based on logged protein only.",
    },
    {
      label: "Average Steps",
      value: isNumber(averageSteps) ? `${Math.round(averageSteps)}` : "No data",
      detail: "Daily step average for the selected week.",
    },
    {
      label: "Total Workouts",
      value: `${totalWorkouts}`,
      detail: "Sessions inside the selected week.",
    },
  ];

  dom.insightCards.innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <p>${escapeHtml(card.detail)}</p>
        </article>
      `
    )
    .join("");
}

function renderAlertCards(dailyLogs, selectedWeek, settings) {
  const previousWeek = getPreviousWeekInfo(selectedWeek);
  const currentCalories = calculateAverage(
    filterLogsByWindow(dailyLogs, selectedWeek)
      .map((log) => log.calories)
      .filter(isNumber)
  );
  const currentWeightAverage = calculateAverage(
    filterLogsByWindow(dailyLogs, selectedWeek)
      .map((log) => log.weight)
      .filter(isNumber)
  );
  const previousWeightAverage = calculateAverage(
    filterLogsByWindow(dailyLogs, previousWeek)
      .map((log) => log.weight)
      .filter(isNumber)
  );
  const currentProtein = calculateAverage(
    filterLogsByWindow(dailyLogs, selectedWeek)
      .map((log) => log.macros.protein)
      .filter(isNumber)
  );

  const weightLossPercent =
    isNumber(currentWeightAverage) && isNumber(previousWeightAverage)
      ? ((previousWeightAverage - currentWeightAverage) / previousWeightAverage) * 100
      : null;

  // Threshold is target-relative rather than a fixed floor: it tracks the
  // user's own configured calorieTarget so the warning stays meaningful for
  // both cutting and bulking goals and never invents a global health rule.
  const calorieShortfallRatio = 0.8;
  const calorieFloor = isNumber(settings.calorieTarget) && settings.calorieTarget > 0
    ? settings.calorieTarget * calorieShortfallRatio
    : null;

  const alerts = [
    isNumber(currentCalories) && isNumber(calorieFloor) && currentCalories < calorieFloor
      ? {
          tone: "warning",
          title: "Low Average Calories",
          value: `${Math.round(currentCalories)} kcal`,
          detail:
            `Average intake for the selected week is trending well below your target of ` +
            `${Math.round(settings.calorieTarget)} kcal.`,
        }
      : {
          tone: "ok",
          title: "Calorie Intake",
          value: isNumber(currentCalories) ? `${Math.round(currentCalories)} kcal` : "No data",
          detail: isNumber(calorieFloor)
            ? `Tracking against your ${Math.round(settings.calorieTarget)} kcal target.`
            : "Set a calorie target in Preferences to enable this warning.",
        },
    isNumber(weightLossPercent) && weightLossPercent > 1
      ? {
          tone: "danger",
          title: "Rapid Weight Loss",
          value: `${weightLossPercent.toFixed(2)}%`,
          detail: "Weekly average weight dropped by more than 1% versus the previous week.",
        }
      : {
          tone: "ok",
          title: "Weight Change",
          value: isNumber(weightLossPercent) ? `${weightLossPercent.toFixed(2)}%` : "No data",
          detail: "No rapid weekly drop is being flagged.",
        },
    isNumber(currentProtein) && currentProtein < settings.proteinGramTarget
      ? {
          tone: "warning",
          title: "Protein Below Target",
          value: `${Math.round(currentProtein)} g`,
          detail: `This week is trending below your ${settings.proteinGramTarget} g target.`,
        }
      : {
          tone: "ok",
          title: "Protein Intake",
          value: isNumber(currentProtein) ? `${Math.round(currentProtein)} g` : "No data",
          detail: "Protein is at or above the selected target trend.",
        },
  ];

  dom.alertCards.innerHTML = alerts
    .map(
      (alert) => `
        <article class="alert-card ${escapeHtml(alert.tone)}">
          <span>${escapeHtml(alert.title)}</span>
          <strong>${escapeHtml(alert.value)}</strong>
          <p>${escapeHtml(alert.detail)}</p>
        </article>
      `
    )
    .join("");
}
