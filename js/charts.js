/*
  charts.js — Chart.js instance management and render functions
  ---------------------------------------------------------------------------
  `chartInstances` is private to this module. Only the render functions and
  `destroyAllCharts` are exported.

  Each render function accepts plain data arguments so dashboard.js controls
  what data is passed in — charts.js never reads appState directly.
*/

import { dom } from "./dom.js";
import {
  getDateStringsInRange,
  formatShortDateLabel,
  buildDailyLogMap,
  isNumber,
  calculateAverage,
  shiftDateString,
  createEmptyDailyLog,
  getWaterLitersFromLog,
  getWaterTargetLiters,
  getMacroCaloriesBreakdown,
  roundToOneDecimal,
} from "./utils.js";

// ─────────────────────────────────────────────────────────────────────────────
// Private — instance registry and shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const chartInstances = {
  weight: null,
  calories: null,
  protein: null,
  steps: null,
  water: null,
  macros: null,
  volume: null,
};

function getChartConstructor() {
  const Chart = globalThis.Chart;
  if (!Chart) {
    throw new Error("Chart.js failed to load. Check the CDN script in index.html.");
  }
  return Chart;
}

function buildSharedChartOptions(yAxisLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: "#f5fbff" } },
    },
    scales: {
      x: {
        ticks: { color: "#98acbc" },
        grid: { color: "rgba(255, 255, 255, 0.04)" },
      },
      y: {
        ticks: { color: "#98acbc" },
        grid: { color: "rgba(255, 255, 255, 0.04)" },
        title: { display: true, text: yAxisLabel, color: "#98acbc" },
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/** Destroys every active Chart.js instance and nulls the registry. */
export function destroyAllCharts() {
  Object.keys(chartInstances).forEach((key) => {
    if (chartInstances[key]) {
      chartInstances[key].destroy();
      chartInstances[key] = null;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — render functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weight trend line for the selected week with a rolling 7-day average
 * calculated from the full log history (not just the visible week).
 */
export function renderWeightChart(allDailyLogs, selectedWeek) {
  const Chart = getChartConstructor();
  const weekDates = getDateStringsInRange(selectedWeek.start, selectedWeek.end);
  const logMap = buildDailyLogMap(allDailyLogs);
  const weights = weekDates.map((date) => logMap[date]?.weight ?? null);

  const rollingAverage = weekDates.map((date, index) => {
    if (!isNumber(weights[index])) return null;
    const windowStart = shiftDateString(date, -6);
    const weightsInWindow = allDailyLogs
      .filter((log) => log.date >= windowStart && log.date <= date && isNumber(log.weight))
      .map((log) => log.weight);
    return calculateAverage(weightsInWindow);
  });

  chartInstances.weight = new Chart(dom.weightChart, {
    type: "line",
    data: {
      labels: weekDates.map(formatShortDateLabel),
      datasets: [
        {
          label: "Weight",
          data: weights,
          borderColor: "#68e4ff",
          backgroundColor: "rgba(104, 228, 255, 0.16)",
          tension: 0.35,
          fill: false,
          spanGaps: true,
        },
        {
          label: "7-Day Rolling Avg",
          data: rollingAverage,
          borderColor: "#f5fbff",
          backgroundColor: "rgba(245, 251, 255, 0.12)",
          tension: 0.35,
          borderDash: [8, 5],
          fill: false,
          spanGaps: true,
        },
      ],
    },
    options: buildSharedChartOptions("Weight (kg)"),
  });
}

/** Daily calorie bars against a flat target line. */
export function renderCalorieChart(dailyLogsThisWeek, selectedWeek, calorieTarget) {
  const Chart = getChartConstructor();
  const weekDates = getDateStringsInRange(selectedWeek.start, selectedWeek.end);
  const logMap = buildDailyLogMap(dailyLogsThisWeek);

  chartInstances.calories = new Chart(dom.calorieChart, {
    type: "bar",
    data: {
      labels: weekDates.map(formatShortDateLabel),
      datasets: [
        {
          type: "bar",
          label: "Calories",
          data: weekDates.map((date) => logMap[date]?.calories ?? null),
          backgroundColor: "rgba(104, 228, 255, 0.72)",
          borderRadius: 10,
        },
        {
          type: "line",
          label: "Target",
          data: weekDates.map(() => calorieTarget),
          borderColor: "#f5fbff",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: buildSharedChartOptions("Calories"),
  });
}

/** Daily protein bars against a flat gram target line. */
export function renderProteinChart(dailyLogsThisWeek, selectedWeek, proteinTarget) {
  const Chart = getChartConstructor();
  const weekDates = getDateStringsInRange(selectedWeek.start, selectedWeek.end);
  const logMap = buildDailyLogMap(dailyLogsThisWeek);

  chartInstances.protein = new Chart(dom.proteinChart, {
    type: "bar",
    data: {
      labels: weekDates.map(formatShortDateLabel),
      datasets: [
        {
          type: "bar",
          label: "Protein",
          data: weekDates.map((date) => logMap[date]?.macros.protein ?? null),
          backgroundColor: "rgba(214, 247, 255, 0.78)",
          borderRadius: 10,
        },
        {
          type: "line",
          label: "Target",
          data: weekDates.map(() => proteinTarget),
          borderColor: "#68e4ff",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: buildSharedChartOptions("Protein (g)"),
  });
}

/** Daily step bars with a weekly average reference line. */
export function renderStepsChart(dailyLogsThisWeek, selectedWeek) {
  const Chart = getChartConstructor();
  const weekDates = getDateStringsInRange(selectedWeek.start, selectedWeek.end);
  const logMap = buildDailyLogMap(dailyLogsThisWeek);
  const stepValues = weekDates.map((date) => logMap[date]?.steps ?? null);
  const averageSteps = calculateAverage(stepValues.filter(isNumber));

  chartInstances.steps = new Chart(dom.stepsChart, {
    type: "bar",
    data: {
      labels: weekDates.map(formatShortDateLabel),
      datasets: [
        {
          type: "bar",
          label: "Steps",
          data: stepValues,
          backgroundColor: "rgba(141, 160, 179, 0.72)",
          borderRadius: 10,
        },
        {
          type: "line",
          label: "Weekly Avg",
          data: weekDates.map(() => averageSteps),
          borderColor: "#f5fbff",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: buildSharedChartOptions("Steps"),
  });
}

/** Daily water-intake bars (in litres) against a per-day target line. */
export function renderWaterChart(dailyLogsThisWeek, selectedWeek, settings) {
  const Chart = getChartConstructor();
  const weekDates = getDateStringsInRange(selectedWeek.start, selectedWeek.end);
  const logMap = buildDailyLogMap(dailyLogsThisWeek);

  chartInstances.water = new Chart(dom.waterChart, {
    type: "bar",
    data: {
      labels: weekDates.map(formatShortDateLabel),
      datasets: [
        {
          type: "bar",
          label: "Water Intake",
          data: weekDates.map((date) =>
            getWaterLitersFromLog(logMap[date] || createEmptyDailyLog(date), settings),
          ),
          backgroundColor: "rgba(104, 228, 255, 0.5)",
          borderRadius: 10,
        },
        {
          type: "line",
          label: "Target",
          data: weekDates.map((date) =>
            getWaterTargetLiters(logMap[date] || createEmptyDailyLog(date), settings),
          ),
          borderColor: "#f5fbff",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: buildSharedChartOptions("Water (L)"),
  });
}

/**
 * Doughnut chart showing the actual weekly macro calorie split (inner ring)
 * against the user's saved target (outer ring).
 */
export function renderMacroChart(logsThisWeek, macroTarget) {
  const Chart = getChartConstructor();
  const totals = logsThisWeek.reduce(
    (acc, log) => {
      const breakdown = getMacroCaloriesBreakdown(log);
      acc.protein += breakdown.protein;
      acc.carbs += breakdown.carbs;
      acc.fat += breakdown.fat;
      return acc;
    },
    { protein: 0, carbs: 0, fat: 0 },
  );

  const totalMacroCalories = totals.protein + totals.carbs + totals.fat;
  const actualSplit =
    totalMacroCalories > 0
      ? [
          roundToOneDecimal((totals.protein / totalMacroCalories) * 100),
          roundToOneDecimal((totals.carbs / totalMacroCalories) * 100),
          roundToOneDecimal((totals.fat / totalMacroCalories) * 100),
        ]
      : [0, 0, 0];

  chartInstances.macros = new Chart(dom.macroChart, {
    type: "doughnut",
    data: {
      labels: ["Protein", "Carbs", "Fat"],
      datasets: [
        {
          label: "Actual Weekly Avg %",
          data: actualSplit,
          backgroundColor: ["#68e4ff", "#f5fbff", "#8da0b3"],
          borderWidth: 0,
        },
        {
          label: "Target %",
          data: [macroTarget.protein, macroTarget.carbs, macroTarget.fat],
          backgroundColor: [
            "rgba(104, 228, 255, 0.22)",
            "rgba(245, 251, 255, 0.18)",
            "rgba(141, 160, 179, 0.22)",
          ],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "52%",
      plugins: {
        legend: { labels: { color: "#f5fbff" } },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${context.formattedValue}%`,
          },
        },
      },
    },
  });
}

/** Horizontal bar chart of total weekly sets grouped by muscle group. */
export function renderVolumeChart(workoutsThisWeek) {
  const Chart = getChartConstructor();
  const volumeByMuscleGroup = {};

  workoutsThisWeek.forEach((workout) => {
    workout.exercises.forEach((exercise) => {
      const key = exercise.muscle_group || "Unspecified";
      volumeByMuscleGroup[key] = (volumeByMuscleGroup[key] || 0) + exercise.sets.length;
    });
  });

  const labels = Object.keys(volumeByMuscleGroup);
  const values = Object.values(volumeByMuscleGroup);

  chartInstances.volume = new Chart(dom.volumeChart, {
    type: "bar",
    data: {
      labels: labels.length ? labels : ["No workouts"],
      datasets: [
        {
          label: "Total Sets",
          data: values.length ? values : [0],
          backgroundColor: ["#68e4ff", "#d6f7ff", "#8da0b3", "#9ee9ff", "#c6fbff", "#eafcff"],
          borderRadius: 12,
        },
      ],
    },
    options: buildSharedChartOptions("Sets"),
  });
}
