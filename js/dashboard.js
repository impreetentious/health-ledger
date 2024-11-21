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
  getDateStringsInRange,
  shiftDateString,
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

const CHART_EMPTY_COPY = {
  weight: "No weight entries are logged for this week yet.",
  macro: "No macro entries are logged for this week yet.",
  calories: "No calorie entries are logged for this week yet.",
  protein: "No protein entries are logged for this week yet.",
  steps: "No step entries are logged for this week yet.",
  water: "No water entries are logged for this week yet.",
  volume: "No workouts are logged for this week yet.",
};

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
  renderWeeklyInsightNarrative({
    dailyLogsThisWeek,
    workoutsThisWeek,
    selectedWeek,
    settings,
    averageCalories,
    averageWeight,
  });
  renderConsistencyPanel(dailyLogs);

  const chartAvailability = {
    weight: dailyLogsThisWeek.some((log) => isNumber(log.weight)),
    macro: dailyLogsThisWeek.some((log) =>
      [log.macros?.protein, log.macros?.carbs, log.macros?.fat].some(isNumber)
    ),
    calories: dailyLogsThisWeek.some((log) => isNumber(log.calories)),
    protein: dailyLogsThisWeek.some((log) => isNumber(log.macros?.protein)),
    steps: dailyLogsThisWeek.some((log) => isNumber(log.steps)),
    water: dailyLogsThisWeek.some((log) => isNumber(log.water?.glasses)),
    volume: workoutsThisWeek.some((log) => log.exercises?.some((exercise) => exercise.sets?.length)),
  };

  Object.entries(chartAvailability).forEach(([key, hasData]) => {
    setChartEmptyState(key, !hasData, CHART_EMPTY_COPY[key]);
  });

  // Chart drawing is contained so a missing Chart.js global (blocked CDN)
  // degrades to blank chart panels instead of bubbling into the hydration
  // recovery path in app.js, which would sign the user out and blame Firestore.
  try {
    if (chartAvailability.weight) renderWeightChart(dailyLogs, selectedWeek);
    if (chartAvailability.calories) renderCalorieChart(dailyLogsThisWeek, selectedWeek, settings.calorieTarget);
    if (chartAvailability.protein) renderProteinChart(dailyLogsThisWeek, selectedWeek, settings.proteinGramTarget);
    if (chartAvailability.steps) renderStepsChart(dailyLogsThisWeek, selectedWeek);
    if (chartAvailability.water) renderWaterChart(dailyLogsThisWeek, selectedWeek, settings);
    if (chartAvailability.macro) renderMacroChart(dailyLogsThisWeek, settings.macroTarget);
    if (chartAvailability.volume) renderVolumeChart(workoutsThisWeek);
    animateChartPanels(chartAvailability);
  } catch (error) {
    console.error(error);
    Object.entries(chartAvailability).forEach(([key, hasData]) => {
      if (hasData) {
        setChartEmptyState(key, true, "This chart could not be drawn. Reload to try again.", false);
      }
    });
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
  Object.keys(CHART_EMPTY_COPY).forEach((key) => {
    setChartEmptyState(key, true, "Sign in to load this chart.", false);
  });
  dom.insightCards.innerHTML = "";
  dom.alertCards.innerHTML = `
    <article class="alert-card ok">
      <span>Account Required</span>
      <strong>Sign In</strong>
      <p>Your dashboard and forms unlock after Firebase Authentication confirms your session.</p>
    </article>
  `;
  dom.weeklyInsightNarrative.textContent = "Sign in to turn your logs into a weekly summary.";
  dom.loggingStreakCount.textContent = "—";
  dom.consistencyCaption.textContent = "Sign in to view your last 90 days of daily logging.";
  dom.consistencyHeatmap.replaceChildren();
  dom.consistencyHeatmap.setAttribute("aria-label", "Sign in to view daily logging consistency.");
}

/** Shows or hides the lightweight dashboard skeleton during workspace hydration. */
export function setDashboardHydrationState(isHydrating) {
  dom.dashboardHydrationSkeleton.hidden = !isHydrating;
  dom.dashboardHydrationSkeleton.setAttribute("aria-hidden", String(!isHydrating));
  dom.dashboardView.setAttribute("aria-busy", String(isHydrating));
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
  const safeTarget = isNumber(targetGlasses) && targetGlasses > 0 ? targetGlasses : 0;
  const completion = safeTarget ? Math.min(Math.max(glasses / safeTarget, 0), 1) : 0;
  const completionPercent = Math.round(completion * 100);

  dom.quickWaterProgress.textContent =
    `${formatNumberForDisplay(glasses)} / ${formatNumberForDisplay(targetGlasses)} Glasses`;
  dom.quickWaterMeter.style.setProperty("--water-progress", String(completion));
  dom.quickWaterMeterLabel.textContent = `${completionPercent}%`;
  dom.quickWaterMeter.setAttribute(
    "aria-label",
    `Water progress: ${formatNumberForDisplay(glasses)} of ${formatNumberForDisplay(targetGlasses)} glasses`
  );
  dom.quickWaterButton.disabled = !appState.currentUser;
}

function renderInsightCards(averageWeight, averageCalories, averageProtein, averageSteps, totalWorkouts) {
  const cards = [
    {
      label: "Average Weight",
      value: isNumber(averageWeight) ? `${averageWeight.toFixed(1)} kg` : "No data",
      detail: "Only logged days are counted.",
      count: averageWeight,
      decimals: 1,
      suffix: " kg",
    },
    {
      label: "Average Calories",
      value: isNumber(averageCalories) ? `${Math.round(averageCalories)} kcal` : "No data",
      detail: "Empty days stay out of the math.",
      count: averageCalories,
      decimals: 0,
      suffix: " kcal",
    },
    {
      label: "Average Protein",
      value: isNumber(averageProtein) ? `${Math.round(averageProtein)} g` : "No data",
      detail: "Based on logged protein only.",
      count: averageProtein,
      decimals: 0,
      suffix: " g",
    },
    {
      label: "Average Steps",
      value: isNumber(averageSteps) ? `${Math.round(averageSteps)}` : "No data",
      detail: "Daily step average for the selected week.",
      count: averageSteps,
      decimals: 0,
      suffix: "",
    },
    {
      label: "Total Workouts",
      value: `${totalWorkouts}`,
      detail: "Sessions inside the selected week.",
      count: totalWorkouts,
      decimals: 0,
      suffix: "",
    },
  ];

  dom.insightCards.innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <span>${escapeHtml(card.label)}</span>
          <strong
            class="stat-value"
            ${isNumber(card.count) ? `data-count-to="${card.count}" data-count-decimals="${card.decimals}" data-count-suffix="${card.suffix}"` : ""}
          >${escapeHtml(card.value)}</strong>
          <p>${escapeHtml(card.detail)}</p>
        </article>
      `
    )
    .join("");

  animateInsightValues();
}

function renderWeeklyInsightNarrative({
  dailyLogsThisWeek,
  workoutsThisWeek,
  selectedWeek,
  settings,
  averageCalories,
  averageWeight,
}) {
  const sentences = [];
  const previousWeightAverage = calculateAverage(
    filterLogsByWindow(appState.dailyLogs, getPreviousWeekInfo(selectedWeek))
      .map((log) => log.weight)
      .filter(isNumber)
  );

  if (isNumber(averageCalories)) {
    const target = settings.calorieTarget;
    if (isNumber(target) && target > 0) {
      const targetDifference = ((averageCalories - target) / target) * 100;
      const roundedDifference = Math.round(Math.abs(targetDifference));
      const direction = targetDifference > 0 ? "over" : targetDifference < 0 ? "under" : "on";
      const targetCopy = direction === "on"
        ? "on your saved target"
        : `${roundedDifference}% ${direction} your saved target`;
      sentences.push(`Average intake was ${Math.round(averageCalories).toLocaleString("en-US")} kcal, ${targetCopy}.`);
    } else {
      sentences.push(`Average intake was ${Math.round(averageCalories).toLocaleString("en-US")} kcal.`);
    }
  }

  if (isNumber(averageWeight) && isNumber(previousWeightAverage)) {
    const change = averageWeight - previousWeightAverage;
    if (Math.abs(change) < 0.05) {
      sentences.push("Average weight was essentially steady versus the previous week.");
    } else {
      const direction = change > 0 ? "up" : "down";
      sentences.push(`Average weight was ${Math.abs(change).toFixed(1)} kg ${direction} versus the previous week.`);
    }
  } else if (isNumber(averageWeight)) {
    sentences.push(`Average weight was ${averageWeight.toFixed(1)} kg across the logged days.`);
  }

  if (workoutsThisWeek.length) {
    const totalSets = workoutsThisWeek.reduce(
      (sum, workout) => sum + (workout.exercises || []).reduce(
        (exerciseTotal, exercise) => exerciseTotal + (exercise.sets || []).length,
        0
      ),
      0
    );
    const sessionLabel = workoutsThisWeek.length === 1 ? "workout" : "workouts";
    const setLabel = totalSets === 1 ? "set" : "sets";
    sentences.push(`You logged ${workoutsThisWeek.length} ${sessionLabel} and ${totalSets} total ${setLabel}.`);
  }

  if (!sentences.length) {
    const hasAnyLogs = dailyLogsThisWeek.length || workoutsThisWeek.length;
    dom.weeklyInsightNarrative.textContent = hasAnyLogs
      ? "This week has entries, but not enough of these metrics for a full trend summary yet."
      : "Log a daily entry or workout to start building a useful weekly summary.";
    return;
  }

  dom.weeklyInsightNarrative.textContent = sentences.join(" ");
}

function renderConsistencyPanel(dailyLogs) {
  const today = getLocalDateString();
  const dates = getDateStringsInRange(shiftDateString(today, -89), today);
  const logsByDate = new Map(dailyLogs.map((log) => [log.date, log]));
  const loggedDayCount = dates.filter((date) => logsByDate.has(date)).length;
  let streak = 0;
  let cursor = today;
  while (logsByDate.has(cursor)) {
    streak += 1;
    cursor = shiftDateString(cursor, -1);
  }

  const fragment = document.createDocumentFragment();
  dates.forEach((date) => {
    const log = logsByDate.get(date);
    const cell = document.createElement("span");
    const detailLevel = getDailyLogDetailLevel(log);
    cell.className = `heat-cell heat-cell--${detailLevel}`;
    cell.setAttribute("aria-hidden", "true");
    cell.title = log ? `${date}: logged` : `${date}: no daily log`;
    fragment.append(cell);
  });
  dom.consistencyHeatmap.replaceChildren(fragment);
  dom.consistencyHeatmap.setAttribute(
    "aria-label",
    `${loggedDayCount} of the last 90 days have a daily log. Current streak: ${streak} ${streak === 1 ? "day" : "days"}.`
  );
  dom.loggingStreakCount.textContent = `${streak} ${streak === 1 ? "day" : "days"}`;
  dom.consistencyCaption.textContent =
    `${loggedDayCount} of the last 90 days have a daily log. A streak counts consecutive days ending today.`;
}

function getDailyLogDetailLevel(log) {
  if (!log) return 0;
  const trackedValues = [
    log.weight,
    log.calories,
    log.macros?.protein,
    log.macros?.carbs,
    log.macros?.fat,
    log.steps,
    log.water?.glasses,
    log.sleep,
    log.energy,
  ];
  const trackedCount = trackedValues.filter(isNumber).length + (log.notes?.trim() ? 1 : 0);
  return Math.max(1, Math.min(4, Math.ceil(trackedCount / 2)));
}

function setChartEmptyState(key, isEmpty, message, showEntryAction = true) {
  const canvas = {
    weight: dom.weightChart,
    macro: dom.macroChart,
    calories: dom.calorieChart,
    protein: dom.proteinChart,
    steps: dom.stepsChart,
    water: dom.waterChart,
    volume: dom.volumeChart,
  }[key];
  if (!canvas) return;

  const panel = canvas.closest(".chart-panel");
  if (!panel) return;

  let emptyState = panel.querySelector(".chart-empty-state");
  if (!emptyState) {
    emptyState = document.createElement("div");
    emptyState.className = "chart-empty-state";
    emptyState.setAttribute("role", "status");
    const copy = document.createElement("p");
    copy.className = "chart-empty-state-copy";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "secondary-button chart-empty-state-action";
    action.dataset.openDashboardView = "entry";
    action.textContent = "Open Data Entry";
    emptyState.append(copy, action);
    panel.append(emptyState);
  }

  emptyState.querySelector(".chart-empty-state-copy").textContent = message;
  emptyState.querySelector(".chart-empty-state-action").hidden = !showEntryAction;
  emptyState.hidden = !isEmpty;
  canvas.hidden = isEmpty;
  panel.classList.toggle("has-chart-empty-state", isEmpty);
}

function animateInsightValues() {
  const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  dom.insightCards.querySelectorAll("[data-count-to]").forEach((element) => {
    const target = Number(element.dataset.countTo);
    const decimals = Number(element.dataset.countDecimals || 0);
    const suffix = element.dataset.countSuffix || "";
    if (!Number.isFinite(target)) return;

    const writeValue = (value) => {
      element.textContent = `${value.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}${suffix}`;
    };

    if (prefersReducedMotion || target === 0) {
      writeValue(target);
      return;
    }

    const startedAt = performance.now();
    const duration = 460;
    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      writeValue(target * eased);
      if (progress < 1 && element.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function animateChartPanels(chartAvailability) {
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  Object.entries(chartAvailability).forEach(([key, hasData]) => {
    if (!hasData) return;
    const canvas = {
      weight: dom.weightChart,
      macro: dom.macroChart,
      calories: dom.calorieChart,
      protein: dom.proteinChart,
      steps: dom.stepsChart,
      water: dom.waterChart,
      volume: dom.volumeChart,
    }[key];
    const panel = canvas?.closest(".chart-panel");
    if (!panel) return;
    panel.classList.remove("chart-panel--ready");
    requestAnimationFrame(() => panel.classList.add("chart-panel--ready"));
  });
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
