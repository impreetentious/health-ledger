"use strict";

/*
  Fitness Ledger
  ---------------------------------------------------------------------------
  localStorage access is isolated so this can be swapped for Firestore later.
*/

const STORAGE_KEYS = {
  dailyLogs: "fitnessLedger.dailyLogs",
  workoutLogs: "fitnessLedger.workoutLogs",
  userSettings: "fitnessLedger.userSettings",
};

const DEFAULT_SETTINGS = {
  calorieTarget: 2300,
  proteinGramTarget: 180,
  macroTarget: {
    protein: 30,
    carbs: 40,
    fat: 30,
  },
  waterTargetGlasses: 8,
  waterUnitAmountMl: 250,
};

const DAILY_QUOTES = [
  { text: "Consistency is still progress when the day feels ordinary.", source: "Daily Ledger" },
  { text: "A calm system beats a perfect week.", source: "Daily Ledger" },
  { text: "One honest log is better than a forgotten ideal.", source: "Daily Ledger" },
  { text: "Momentum usually starts as something small repeated on time.", source: "Daily Ledger" },
  { text: "Take care of the boring basics and the big results start behaving.", source: "Daily Ledger" },
  { text: "Your plan does not need drama. It needs another solid day.", source: "Daily Ledger" },
  { text: "Energy follows structure more often than motivation.", source: "Daily Ledger" },
  { text: "The body likes patience more than heroics.", source: "Daily Ledger" },
];

const chartInstances = {
  weight: null,
  calories: null,
  protein: null,
  steps: null,
  water: null,
  macros: null,
  volume: null,
};

const appState = {
  selectedWeekKey: getCurrentWeekKey(),
};

const dom = {};

document.addEventListener("DOMContentLoaded", initializeApp);

function initializeApp() {
  cacheDomReferences();
  initializeStorage();
  bindEvents();
  populateSettingsForm();
  seedFormDates();
  resetWorkoutForm();
  setDailyQuote();
  populateDailyFormForDate(getLocalDateString());
  renderHistoryTables();
  renderStorageStatus();
  refreshCurrentView("dashboard");
}

function cacheDomReferences() {
  dom.navButtons = document.querySelectorAll(".nav-button");
  dom.views = document.querySelectorAll(".view");
  dom.statusMessage = document.getElementById("status-message");

  dom.dailyQuoteText = document.getElementById("daily-quote-text");
  dom.dailyQuoteSource = document.getElementById("daily-quote-source");

  dom.dashboardSummary = document.getElementById("dashboard-summary");
  dom.dashboardToday = document.getElementById("dashboard-today");
  dom.dashboardWeekTitle = document.getElementById("dashboard-week-title");
  dom.dashboardWeekCaption = document.getElementById("dashboard-week-caption");
  dom.dashboardWeekSelect = document.getElementById("dashboard-week-select");
  dom.insightCards = document.getElementById("insight-cards");
  dom.alertCards = document.getElementById("alert-cards");

  dom.dailyForm = document.getElementById("daily-log-form");
  dom.workoutForm = document.getElementById("workout-log-form");
  dom.settingsForm = document.getElementById("settings-form");
  dom.csvImport = document.getElementById("csv-import");
  dom.exportBackupButton = document.getElementById("export-backup-button");
  dom.storageStatus = document.getElementById("storage-status");

  dom.exerciseList = document.getElementById("exercise-list");
  dom.addExerciseButton = document.getElementById("add-exercise-button");
  dom.macroPreview = document.getElementById("macro-preview");

  dom.dailyHistoryBody = document.getElementById("daily-history-body");
  dom.workoutHistoryBody = document.getElementById("workout-history-body");

  dom.weightChart = document.getElementById("weightChart");
  dom.calorieChart = document.getElementById("calorieChart");
  dom.proteinChart = document.getElementById("proteinChart");
  dom.stepsChart = document.getElementById("stepsChart");
  dom.waterChart = document.getElementById("waterChart");
  dom.macroChart = document.getElementById("macroChart");
  dom.volumeChart = document.getElementById("volumeChart");
}

function bindEvents() {
  dom.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      refreshCurrentView(button.dataset.view);
    });
  });

  dom.dashboardWeekSelect.addEventListener("change", (event) => {
    appState.selectedWeekKey = event.target.value;
    renderDashboard();
  });

  dom.dailyForm.addEventListener("submit", handleDailyLogSubmit);
  dom.dailyForm.addEventListener("input", updateNutritionPreview);
  dom.dailyForm.elements.date.addEventListener("change", () => {
    populateDailyFormForDate(dom.dailyForm.elements.date.value);
  });

  dom.workoutForm.addEventListener("submit", handleWorkoutLogSubmit);
  dom.settingsForm.addEventListener("submit", handleSettingsSubmit);
  dom.csvImport.addEventListener("change", handleCsvImport);
  dom.exportBackupButton.addEventListener("click", handleBackupExport);
  dom.addExerciseButton.addEventListener("click", () => addExerciseCard());
}

/*
  ---------------------------------------------------------------------------
  localStorage data access layer
  ---------------------------------------------------------------------------
*/

function initializeStorage() {
  if (!localStorage.getItem(STORAGE_KEYS.dailyLogs)) {
    writeToStorage(STORAGE_KEYS.dailyLogs, []);
  }

  if (!localStorage.getItem(STORAGE_KEYS.workoutLogs)) {
    writeToStorage(STORAGE_KEYS.workoutLogs, []);
  }

  initializeUserSettings();
}

function initializeUserSettings() {
  const existing = readFromStorage(STORAGE_KEYS.userSettings, null);
  const mergedSettings = {
    calorieTarget: existing?.calorieTarget ?? DEFAULT_SETTINGS.calorieTarget,
    proteinGramTarget: existing?.proteinGramTarget ?? DEFAULT_SETTINGS.proteinGramTarget,
    macroTarget: {
      protein: existing?.macroTarget?.protein ?? DEFAULT_SETTINGS.macroTarget.protein,
      carbs: existing?.macroTarget?.carbs ?? DEFAULT_SETTINGS.macroTarget.carbs,
      fat: existing?.macroTarget?.fat ?? DEFAULT_SETTINGS.macroTarget.fat,
    },
    waterTargetGlasses: existing?.waterTargetGlasses ?? DEFAULT_SETTINGS.waterTargetGlasses,
    waterUnitAmountMl: existing?.waterUnitAmountMl ?? DEFAULT_SETTINGS.waterUnitAmountMl,
  };

  saveUserSettings(mergedSettings);
}

function readFromStorage(storageKey, fallbackValue) {
  try {
    const rawValue = localStorage.getItem(storageKey);
    return rawValue ? JSON.parse(rawValue) : fallbackValue;
  } catch (error) {
    console.error(`Unable to read storage key: ${storageKey}`, error);
    return fallbackValue;
  }
}

function writeToStorage(storageKey, value) {
  localStorage.setItem(storageKey, JSON.stringify(value));
}

function getDailyLogs() {
  return readFromStorage(STORAGE_KEYS.dailyLogs, [])
    .map(normalizeDailyLog)
    .sort(sortByDateAsc);
}

function saveAllDailyLogs(dailyLogs) {
  writeToStorage(
    STORAGE_KEYS.dailyLogs,
    dedupeLogsByDate(dailyLogs.map(normalizeDailyLog)).sort(sortByDateAsc)
  );
}

function saveDailyLog(dailyLog) {
  const logs = getDailyLogs();
  const existingIndex = logs.findIndex((log) => log.date === dailyLog.date);

  if (existingIndex >= 0) {
    logs[existingIndex] = mergeDailyLogs(logs[existingIndex], dailyLog);
  } else {
    logs.push(mergeDailyLogs(createEmptyDailyLog(dailyLog.date), dailyLog));
  }

  saveAllDailyLogs(logs);
}

function mergeLegacyDailyLogs(importedLogs) {
  const mergedByDate = Object.fromEntries(
    getDailyLogs().map((log) => [log.date, clonePlainData(log)])
  );

  importedLogs.forEach((importedLog) => {
    const existingLog = mergedByDate[importedLog.date] || createEmptyDailyLog(importedLog.date);
    mergedByDate[importedLog.date] = mergeDailyLogs(existingLog, importedLog);
  });

  const mergedLogs = Object.values(mergedByDate).sort(sortByDateAsc);
  saveAllDailyLogs(mergedLogs);
  return mergedLogs.length;
}

function getWorkoutLogs() {
  return readFromStorage(STORAGE_KEYS.workoutLogs, []).sort(sortByDateAsc);
}

function saveAllWorkoutLogs(workoutLogs) {
  writeToStorage(STORAGE_KEYS.workoutLogs, workoutLogs.sort(sortByDateAsc));
}

function saveWorkoutLog(workoutLog) {
  const workoutLogs = getWorkoutLogs();
  workoutLogs.push(workoutLog);
  saveAllWorkoutLogs(workoutLogs);
}

function getUserSettings() {
  return readFromStorage(STORAGE_KEYS.userSettings, DEFAULT_SETTINGS);
}

function saveUserSettings(userSettings) {
  writeToStorage(STORAGE_KEYS.userSettings, userSettings);
}

/*
  ---------------------------------------------------------------------------
  UI actions and handlers
  ---------------------------------------------------------------------------
*/

function refreshCurrentView(viewName) {
  dom.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  dom.views.forEach((view) => {
    view.classList.toggle("active", view.id === `${viewName}-view`);
  });

  destroyAllCharts();

  if (viewName === "dashboard") {
    renderDashboard();
  } else if (viewName === "history") {
    populateSettingsForm();
    renderHistoryTables();
    renderStorageStatus();
  }
}

function handleDailyLogSubmit(event) {
  event.preventDefault();

  const calories = toNumberOrNull(dom.dailyForm.elements.calories.value);
  const protein = toNumberOrNull(dom.dailyForm.elements.protein.value);
  const carbPercent = toNumberOrNull(dom.dailyForm.elements.carbPercent.value);
  const fatPercent = toNumberOrNull(dom.dailyForm.elements.fatPercent.value);

  const macroPayload = buildMacroPayloadFromInputs(calories, protein, carbPercent, fatPercent);
  if (macroPayload.error) {
    showStatusMessage(macroPayload.error, true);
    return;
  }

  const dailyLog = {
    date: dom.dailyForm.elements.date.value,
    weight: toNumberOrNull(dom.dailyForm.elements.weight.value),
    calories,
    macros: macroPayload.macros,
    macroPercentages: macroPayload.macroPercentages,
    steps: toNumberOrNull(dom.dailyForm.elements.steps.value),
    sleep: toNumberOrNull(dom.dailyForm.elements.sleep.value),
    water: {
      glasses: toNumberOrNull(dom.dailyForm.elements.waterGlasses.value),
      targetGlasses: toNumberOrNull(dom.dailyForm.elements.waterTargetGlasses.value),
      unitAmountMl: toNumberOrNull(dom.dailyForm.elements.waterUnitAmountMl.value),
    },
    energy: toNumberOrNull(dom.dailyForm.elements.energy.value),
    notes: dom.dailyForm.elements.notes.value.trim(),
  };

  saveDailyLog(dailyLog);
  renderHistoryTables();
  renderStorageStatus();
  showStatusMessage(`Saved daily log for ${dailyLog.date}.`);
  refreshCurrentView(getActiveViewName());
}

function handleWorkoutLogSubmit(event) {
  event.preventDefault();

  const exercises = collectExercisesFromForm();
  if (exercises.length === 0) {
    showStatusMessage("Add at least one exercise before saving a workout.", true);
    return;
  }

  const workoutLog = {
    id: generateId(),
    date: dom.workoutForm.elements.date.value,
    session_type: dom.workoutForm.elements.session_type.value.trim(),
    duration: toNumberOrNull(dom.workoutForm.elements.duration.value),
    exercises,
  };

  saveWorkoutLog(workoutLog);
  renderHistoryTables();
  renderStorageStatus();
  showStatusMessage(`Saved workout log for ${workoutLog.date}.`);
  resetWorkoutForm();
  refreshCurrentView(getActiveViewName());
}

function handleSettingsSubmit(event) {
  event.preventDefault();

  const calorieTarget = Number(dom.settingsForm.elements.calorieTarget.value);
  const proteinGramTarget = Number(dom.settingsForm.elements.proteinGramTarget.value);
  const protein = Number(dom.settingsForm.elements.proteinTarget.value);
  const carbs = Number(dom.settingsForm.elements.carbsTarget.value);
  const fat = Number(dom.settingsForm.elements.fatTarget.value);
  const waterTargetGlasses = Number(dom.settingsForm.elements.waterTargetGlasses.value);
  const waterUnitAmountMl = Number(dom.settingsForm.elements.waterUnitAmountMl.value);

  if (protein + carbs + fat !== 100) {
    showStatusMessage("Macro targets must add up to exactly 100%.", true);
    return;
  }

  saveUserSettings({
    calorieTarget,
    proteinGramTarget,
    macroTarget: { protein, carbs, fat },
    waterTargetGlasses,
    waterUnitAmountMl,
  });

  if (!getExistingDailyLog(dom.dailyForm.elements.date.value)) {
    populateDailyFormForDate(dom.dailyForm.elements.date.value);
  }

  renderStorageStatus();
  showStatusMessage("Saved settings and updated the weekly targets.");
  refreshCurrentView(getActiveViewName());
}

async function handleCsvImport(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const csvText = await file.text();
    const importedLogs = parseLegacyCsv(csvText);
    mergeLegacyDailyLogs(importedLogs);
    renderHistoryTables();
    renderStorageStatus();
    if (getActiveViewName() === "dashboard") {
      renderDashboard();
    }
    showStatusMessage(`Imported ${importedLogs.length} legacy row(s) from ${file.name}.`);
  } catch (error) {
    console.error(error);
    showStatusMessage(error.message || "Unable to import that CSV file.", true);
  } finally {
    event.target.value = "";
  }
}

function handleBackupExport() {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 2,
    userSettings: getUserSettings(),
    dailyLogs: getDailyLogs(),
    workoutLogs: getWorkoutLogs(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `fitness-ledger-backup-${getLocalDateString()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);

  showStatusMessage("Backup exported. You can archive that file to Google Drive anytime.");
}

function populateSettingsForm() {
  const settings = getUserSettings();
  dom.settingsForm.elements.calorieTarget.value = settings.calorieTarget;
  dom.settingsForm.elements.proteinGramTarget.value = settings.proteinGramTarget;
  dom.settingsForm.elements.proteinTarget.value = settings.macroTarget.protein;
  dom.settingsForm.elements.carbsTarget.value = settings.macroTarget.carbs;
  dom.settingsForm.elements.fatTarget.value = settings.macroTarget.fat;
  dom.settingsForm.elements.waterTargetGlasses.value = settings.waterTargetGlasses;
  dom.settingsForm.elements.waterUnitAmountMl.value = settings.waterUnitAmountMl;
}

function seedFormDates() {
  const today = getLocalDateString();
  dom.dailyForm.elements.date.value = today;
  dom.workoutForm.elements.date.value = today;
}

function populateDailyFormForDate(date) {
  const settings = getUserSettings();
  const existingLog = getExistingDailyLog(date);
  const log = existingLog || createEmptyDailyLog(date);
  const derivedPercentages = deriveMacroPercentages(log.calories, log.macros);

  dom.dailyForm.elements.date.value = date;
  dom.dailyForm.elements.weight.value = valueOrEmpty(log.weight);
  dom.dailyForm.elements.calories.value = valueOrEmpty(log.calories);
  dom.dailyForm.elements.protein.value = valueOrEmpty(log.macros.protein);
  dom.dailyForm.elements.carbPercent.value = valueOrEmpty(
    log.macroPercentages.carbs ?? derivedPercentages.carbs
  );
  dom.dailyForm.elements.fatPercent.value = valueOrEmpty(
    log.macroPercentages.fat ?? derivedPercentages.fat
  );
  dom.dailyForm.elements.steps.value = valueOrEmpty(log.steps);
  dom.dailyForm.elements.sleep.value = valueOrEmpty(log.sleep);
  dom.dailyForm.elements.waterGlasses.value = valueOrEmpty(log.water.glasses);
  dom.dailyForm.elements.waterTargetGlasses.value = valueOrEmpty(
    log.water.targetGlasses ?? settings.waterTargetGlasses
  );
  dom.dailyForm.elements.waterUnitAmountMl.value = valueOrEmpty(
    log.water.unitAmountMl ?? settings.waterUnitAmountMl
  );
  dom.dailyForm.elements.energy.value = valueOrEmpty(log.energy);
  dom.dailyForm.elements.notes.value = log.notes || "";

  updateNutritionPreview();
}

function getExistingDailyLog(date) {
  return getDailyLogs().find((log) => log.date === date) || null;
}

function setDailyQuote() {
  const quoteIndex = hashString(getLocalDateString()) % DAILY_QUOTES.length;
  const quote = DAILY_QUOTES[quoteIndex];
  dom.dailyQuoteText.textContent = quote.text;
  dom.dailyQuoteSource.textContent = quote.source;
}

function showStatusMessage(message, isError = false) {
  dom.statusMessage.textContent = message;
  dom.statusMessage.classList.add("visible");
  dom.statusMessage.style.background = isError
    ? "rgba(255, 133, 133, 0.12)"
    : "rgba(104, 228, 255, 0.12)";
  dom.statusMessage.style.borderColor = isError
    ? "rgba(255, 133, 133, 0.22)"
    : "rgba(104, 228, 255, 0.2)";
}

function renderStorageStatus() {
  const dailyLogs = getDailyLogs();
  const workoutLogs = getWorkoutLogs();
  const snapshot = JSON.stringify({
    userSettings: getUserSettings(),
    dailyLogs,
    workoutLogs,
  });

  dom.storageStatus.textContent =
    `This data currently lives inside this browser on this device. ` +
    `${dailyLogs.length} daily logs and ${workoutLogs.length} workouts ` +
    `use about ${formatBytes(new Blob([snapshot]).size)}. Export backups here if you want to archive copies to Google Drive.`;
}

function updateNutritionPreview() {
  const calories = toNumberOrNull(dom.dailyForm.elements.calories.value);
  const protein = toNumberOrNull(dom.dailyForm.elements.protein.value);
  const carbPercent = toNumberOrNull(dom.dailyForm.elements.carbPercent.value);
  const fatPercent = toNumberOrNull(dom.dailyForm.elements.fatPercent.value);

  const payload = buildMacroPayloadFromInputs(calories, protein, carbPercent, fatPercent, true);

  if (payload.error) {
    dom.macroPreview.innerHTML = `<strong>Check:</strong> ${payload.error}`;
    return;
  }

  const carbsText = isNumber(payload.macros.carbs) ? `${payload.macros.carbs.toFixed(1)} g` : "Enter calories";
  const fatText = isNumber(payload.macros.fat) ? `${payload.macros.fat.toFixed(1)} g` : "Enter calories";
  const proteinShare = isNumber(payload.macroPercentages.protein)
    ? `${payload.macroPercentages.protein.toFixed(1)}%`
    : "Pending calories";
  const assignedText = isNumber(payload.assignedPercent)
    ? `${payload.assignedPercent.toFixed(1)}%`
    : "Not available";
  const remainingText = isNumber(payload.remainingPercent)
    ? `${payload.remainingPercent.toFixed(1)}%`
    : "Not available";

  dom.macroPreview.innerHTML = `
    <strong>Nutrition preview</strong><br />
    Carbs convert to <strong>${carbsText}</strong>, fat converts to <strong>${fatText}</strong>,
    and protein represents <strong>${proteinShare}</strong> of your calorie intake.<br />
    Assigned intake: <strong>${assignedText}</strong>. Remaining unassigned: <strong>${remainingText}</strong>.
  `;
}

/*
  ---------------------------------------------------------------------------
  Workout exercise builder
  ---------------------------------------------------------------------------
*/

function resetWorkoutForm() {
  dom.workoutForm.reset();
  dom.workoutForm.elements.date.value = getLocalDateString();
  dom.exerciseList.innerHTML = "";
  addExerciseCard();
}

function addExerciseCard(exercise = null) {
  const exerciseCard = document.createElement("article");
  exerciseCard.className = "exercise-card";
  exerciseCard.innerHTML = `
    <div class="exercise-top">
      <h4>Exercise</h4>
      <button type="button" class="secondary-button remove-exercise-button">Remove</button>
    </div>
    <div class="exercise-fields">
      <label>
        <span>Name</span>
        <input type="text" class="exercise-name" placeholder="Bench Press" required />
      </label>
      <label>
        <span>Muscle Group</span>
        <input type="text" class="exercise-muscle-group" placeholder="Chest" required />
      </label>
    </div>
    <div class="set-list"></div>
    <button type="button" class="secondary-button add-set-button">Add Set</button>
  `;

  const removeButton = exerciseCard.querySelector(".remove-exercise-button");
  const addSetButton = exerciseCard.querySelector(".add-set-button");
  const setList = exerciseCard.querySelector(".set-list");

  removeButton.addEventListener("click", () => {
    exerciseCard.remove();
  });

  addSetButton.addEventListener("click", () => {
    addSetRow(setList);
  });

  dom.exerciseList.appendChild(exerciseCard);

  exerciseCard.querySelector(".exercise-name").value = exercise?.name || "";
  exerciseCard.querySelector(".exercise-muscle-group").value = exercise?.muscle_group || "";

  if (exercise?.sets?.length) {
    exercise.sets.forEach((set) => addSetRow(setList, set));
  } else {
    addSetRow(setList);
  }
}

function addSetRow(setList, set = null) {
  const setRow = document.createElement("div");
  setRow.className = "set-row";
  setRow.innerHTML = `
    <div class="set-row-head">
      <strong>Set</strong>
      <button type="button" class="secondary-button remove-set-button">Remove</button>
    </div>
    <div class="set-fields">
      <label>
        <span>Reps</span>
        <input type="number" class="set-reps" min="0" placeholder="10" required />
      </label>
      <label>
        <span>Weight</span>
        <input type="number" class="set-weight" min="0" step="0.1" placeholder="60" required />
      </label>
    </div>
  `;

  setRow.querySelector(".remove-set-button").addEventListener("click", () => {
    setRow.remove();
  });

  setList.appendChild(setRow);
  setRow.querySelector(".set-reps").value = set?.reps ?? "";
  setRow.querySelector(".set-weight").value = set?.weight ?? "";
}

function collectExercisesFromForm() {
  return Array.from(dom.exerciseList.querySelectorAll(".exercise-card"))
    .map((exerciseCard) => {
      const sets = Array.from(exerciseCard.querySelectorAll(".set-row"))
        .map((setRow) => ({
          reps: toNumberOrNull(setRow.querySelector(".set-reps").value),
          weight: toNumberOrNull(setRow.querySelector(".set-weight").value),
        }))
        .filter((set) => set.reps !== null || set.weight !== null);

      return {
        name: exerciseCard.querySelector(".exercise-name").value.trim(),
        muscle_group: exerciseCard.querySelector(".exercise-muscle-group").value.trim(),
        sets,
      };
    })
    .filter((exercise) => exercise.name && exercise.muscle_group && exercise.sets.length > 0);
}

/*
  ---------------------------------------------------------------------------
  Dashboard rendering
  ---------------------------------------------------------------------------
*/

function renderDashboard() {
  const dailyLogs = getDailyLogs();
  const workoutLogs = getWorkoutLogs();
  const settings = getUserSettings();
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
    `Today is ${formatLongDate(new Date())}. Reviewing ${selectedWeek.label.toLowerCase()} with ${dailyLogsThisWeek.length} daily logs and ${workoutsThisWeek.length} workouts.`;

  renderInsightCards(averageWeight, averageCalories, averageProtein, averageSteps, totalWorkouts);
  renderAlertCards(dailyLogs, selectedWeek, settings);
  renderWeightChart(dailyLogs, selectedWeek);
  renderCalorieChart(dailyLogsThisWeek, selectedWeek, settings.calorieTarget);
  renderProteinChart(dailyLogsThisWeek, selectedWeek, settings.proteinGramTarget);
  renderStepsChart(dailyLogsThisWeek, selectedWeek);
  renderWaterChart(dailyLogsThisWeek, selectedWeek, settings);
  renderMacroChart(dailyLogsThisWeek, settings.macroTarget);
  renderVolumeChart(workoutsThisWeek);
}

function syncWeekSelector(weekOptions) {
  const selected = weekOptions.find((option) => option.key === appState.selectedWeekKey) || weekOptions[0];
  appState.selectedWeekKey = selected.key;

  dom.dashboardWeekSelect.innerHTML = weekOptions
    .map(
      (option) => `<option value="${option.key}" ${option.key === selected.key ? "selected" : ""}>${option.label}</option>`
    )
    .join("");

  dom.dashboardToday.textContent = `Today - ${formatLongDate(new Date())}`;
  dom.dashboardWeekTitle.textContent = `Week ${selected.week}, ${selected.year}`;
  dom.dashboardWeekCaption.textContent = `${selected.start} to ${selected.end}`;

  return selected;
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
          <span>${card.label}</span>
          <strong>${card.value}</strong>
          <p>${card.detail}</p>
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

  const alerts = [
    isNumber(currentCalories) && currentCalories < 1750
      ? {
          tone: "warning",
          title: "Low Average Calories",
          value: `${Math.round(currentCalories)} kcal`,
          detail: "Average intake for the selected week is below 1750 kcal.",
        }
      : {
          tone: "ok",
          title: "Calorie Intake",
          value: isNumber(currentCalories) ? `${Math.round(currentCalories)} kcal` : "No data",
          detail: "No low-calorie warning is active for this week.",
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
        <article class="alert-card ${alert.tone}">
          <span>${alert.title}</span>
          <strong>${alert.value}</strong>
          <p>${alert.detail}</p>
        </article>
      `
    )
    .join("");
}

function renderWeightChart(allDailyLogs, selectedWeek) {
  const weekDates = getDateStringsInRange(selectedWeek.start, selectedWeek.end);
  const logMap = buildDailyLogMap(allDailyLogs);
  const weights = weekDates.map((date) => logMap[date]?.weight ?? null);
  const rollingAverage = weekDates.map((date, index) => {
    if (!isNumber(weights[index])) {
      return null;
    }

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

function renderCalorieChart(dailyLogsThisWeek, selectedWeek, calorieTarget) {
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

function renderProteinChart(dailyLogsThisWeek, selectedWeek, proteinTarget) {
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

function renderStepsChart(dailyLogsThisWeek, selectedWeek) {
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

function renderWaterChart(dailyLogsThisWeek, selectedWeek, settings) {
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
          data: weekDates.map((date) => getWaterLitersFromLog(logMap[date] || createEmptyDailyLog(date), settings)),
          backgroundColor: "rgba(104, 228, 255, 0.5)",
          borderRadius: 10,
        },
        {
          type: "line",
          label: "Target",
          data: weekDates.map((date) => getWaterTargetLiters(logMap[date] || createEmptyDailyLog(date), settings)),
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

function renderMacroChart(logsThisWeek, macroTarget) {
  const totals = logsThisWeek.reduce(
    (accumulator, log) => {
      const macroCalories = getMacroCaloriesBreakdown(log);
      accumulator.protein += macroCalories.protein;
      accumulator.carbs += macroCalories.carbs;
      accumulator.fat += macroCalories.fat;
      return accumulator;
    },
    { protein: 0, carbs: 0, fat: 0 }
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
        legend: {
          labels: { color: "#f5fbff" },
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${context.formattedValue}%`;
            },
          },
        },
      },
    },
  });
}

function renderVolumeChart(workoutsThisWeek) {
  const volumeByMuscleGroup = {};

  workoutsThisWeek.forEach((workout) => {
    workout.exercises.forEach((exercise) => {
      const key = exercise.muscle_group || "Unspecified";
      volumeByMuscleGroup[key] = (volumeByMuscleGroup[key] || 0) + exercise.sets.length;
    });
  });

  chartInstances.volume = new Chart(dom.volumeChart, {
    type: "bar",
    data: {
      labels: Object.keys(volumeByMuscleGroup),
      datasets: [
        {
          label: "Total Sets",
          data: Object.values(volumeByMuscleGroup),
          backgroundColor: ["#68e4ff", "#d6f7ff", "#8da0b3", "#9ee9ff", "#c6fbff", "#eafcff"],
          borderRadius: 12,
        },
      ],
    },
    options: buildSharedChartOptions("Sets"),
  });
}

function destroyAllCharts() {
  Object.keys(chartInstances).forEach((chartKey) => {
    if (chartInstances[chartKey]) {
      chartInstances[chartKey].destroy();
      chartInstances[chartKey] = null;
    }
  });
}

/*
  ---------------------------------------------------------------------------
  History tables
  ---------------------------------------------------------------------------
*/

function renderHistoryTables() {
  const dailyLogs = [...getDailyLogs()].sort(sortByDateDesc);
  const workoutLogs = [...getWorkoutLogs()].sort(sortByDateDesc);

  dom.dailyHistoryBody.innerHTML = dailyLogs.length
    ? dailyLogs
        .map(
          (log) => `
            <tr>
              <td>${log.date}</td>
              <td>${formatMaybeNumber(log.weight)}</td>
              <td>${formatMaybeNumber(log.calories)}</td>
              <td>${formatMaybeNumber(log.macros.protein)}</td>
              <td>${formatMacroHistory(log)}</td>
              <td>${formatMaybeNumber(log.steps)}</td>
              <td>${formatWaterHistory(log)}</td>
              <td>${formatMaybeNumber(log.sleep)}</td>
              <td>${formatMaybeNumber(log.energy)}</td>
              <td>${log.notes || "-"}</td>
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
              <td>${log.date}</td>
              <td>${log.session_type}</td>
              <td>${formatMaybeNumber(log.duration)} min</td>
              <td>${log.exercises.length}</td>
              <td>${totalSets}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5" class="empty-state">No workout logs saved yet.</td></tr>`;
}

/*
  ---------------------------------------------------------------------------
  Legacy CSV import
  ---------------------------------------------------------------------------
*/

function parseLegacyCsv(csvText) {
  const rows = csvText
    .trim()
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);

  if (rows.length < 2) {
    throw new Error("The CSV file must include a header row and at least one data row.");
  }

  const headers = splitCsvRow(rows[0]).map((header) => header.trim().toLowerCase());
  const requiredHeaders = ["date", "weight", "calories", "protein", "carbs", "fat"];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    throw new Error(`Missing CSV columns: ${missingHeaders.join(", ")}.`);
  }

  return rows.slice(1).map((row, index) => {
    const values = splitCsvRow(row);
    const rowObject = Object.fromEntries(
      headers.map((header, position) => [header, values[position] ?? ""])
    );
    const normalizedDate = normalizeCsvDate(rowObject.date);

    if (!normalizedDate) {
      throw new Error(`Invalid date in CSV row ${index + 2}. Use YYYY-MM-DD or a parseable date value.`);
    }

    const macros = {
      protein: toNumberOrNull(rowObject.protein),
      carbs: toNumberOrNull(rowObject.carbs),
      fat: toNumberOrNull(rowObject.fat),
    };

    return {
      date: normalizedDate,
      weight: toNumberOrNull(rowObject.weight),
      calories: toNumberOrNull(rowObject.calories),
      macros,
      macroPercentages: deriveMacroPercentages(toNumberOrNull(rowObject.calories), macros),
      steps: null,
      sleep: null,
      water: {
        glasses: null,
        targetGlasses: null,
        unitAmountMl: null,
      },
      energy: null,
      notes: "",
    };
  });
}

function splitCsvRow(row) {
  const values = [];
  let currentValue = "";
  let insideQuotes = false;

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    const nextCharacter = row[index + 1];

    if (character === '"' && insideQuotes && nextCharacter === '"') {
      currentValue += '"';
      index += 1;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === "," && !insideQuotes) {
      values.push(currentValue.trim());
      currentValue = "";
    } else {
      currentValue += character;
    }
  }

  values.push(currentValue.trim());
  return values;
}

/*
  ---------------------------------------------------------------------------
  Helpers
  ---------------------------------------------------------------------------
*/

function normalizeDailyLog(log) {
  const normalized = mergeDailyLogs(createEmptyDailyLog(log.date || getLocalDateString()), log);
  const derivedPercentages = deriveMacroPercentages(normalized.calories, normalized.macros);

  normalized.macroPercentages = {
    protein: normalized.macroPercentages.protein ?? derivedPercentages.protein,
    carbs: normalized.macroPercentages.carbs ?? derivedPercentages.carbs,
    fat: normalized.macroPercentages.fat ?? derivedPercentages.fat,
  };

  return normalized;
}

function buildMacroPayloadFromInputs(calories, proteinGrams, carbPercent, fatPercent, isPreview = false) {
  const hasCalories = isNumber(calories) && calories > 0;
  const hasCarbPercent = isNumber(carbPercent);
  const hasFatPercent = isNumber(fatPercent);
  const hasProtein = isNumber(proteinGrams);

  if ((hasCarbPercent || hasFatPercent) && !hasCalories) {
    return {
      error: isPreview
        ? "Enter calories to convert carb and fat percentages."
        : "Please enter calories before using carb or fat percentages.",
    };
  }

  const macros = {
    protein: hasProtein ? proteinGrams : null,
    carbs: null,
    fat: null,
  };

  const macroPercentages = {
    protein: null,
    carbs: hasCarbPercent ? carbPercent : null,
    fat: hasFatPercent ? fatPercent : null,
  };

  let assignedPercent = null;
  let remainingPercent = null;

  if (hasCalories) {
    if (hasProtein) {
      macroPercentages.protein = roundToOneDecimal(((proteinGrams * 4) / calories) * 100);
    }

    if (hasCarbPercent) {
      macros.carbs = roundToOneDecimal((calories * (carbPercent / 100)) / 4);
    }

    if (hasFatPercent) {
      macros.fat = roundToOneDecimal((calories * (fatPercent / 100)) / 9);
    }

    assignedPercent =
      (macroPercentages.protein || 0) +
      (macroPercentages.carbs || 0) +
      (macroPercentages.fat || 0);
    remainingPercent = Math.max(0, roundToOneDecimal(100 - assignedPercent));

    if (assignedPercent > 100.5) {
      return {
        error: isPreview
          ? "Protein plus carb and fat percentages add up to more than 100%."
          : "Protein plus carb and fat percentages currently add up to more than 100% of intake.",
      };
    }
  }

  return {
    macros,
    macroPercentages,
    assignedPercent,
    remainingPercent,
  };
}

function getMacroCaloriesBreakdown(log) {
  const calories = log.calories;
  const proteinCalories = isNumber(log.macros.protein)
    ? log.macros.protein * 4
    : percentToCalories(log.macroPercentages.protein, calories);
  const carbCalories = isNumber(log.macros.carbs)
    ? log.macros.carbs * 4
    : percentToCalories(log.macroPercentages.carbs, calories);
  const fatCalories = isNumber(log.macros.fat)
    ? log.macros.fat * 9
    : percentToCalories(log.macroPercentages.fat, calories);

  return {
    protein: proteinCalories || 0,
    carbs: carbCalories || 0,
    fat: fatCalories || 0,
  };
}

function deriveMacroPercentages(calories, macros) {
  if (!isNumber(calories) || calories <= 0) {
    return {
      protein: null,
      carbs: null,
      fat: null,
    };
  }

  return {
    protein: isNumber(macros.protein) ? roundToOneDecimal(((macros.protein * 4) / calories) * 100) : null,
    carbs: isNumber(macros.carbs) ? roundToOneDecimal(((macros.carbs * 4) / calories) * 100) : null,
    fat: isNumber(macros.fat) ? roundToOneDecimal(((macros.fat * 9) / calories) * 100) : null,
  };
}

function getWaterLitersFromLog(log, settings) {
  const glasses = log.water.glasses;
  const unitAmountMl = log.water.unitAmountMl ?? settings.waterUnitAmountMl;

  if (!isNumber(glasses) || !isNumber(unitAmountMl)) {
    return null;
  }

  return roundToTwoDecimals((glasses * unitAmountMl) / 1000);
}

function getWaterTargetLiters(log, settings) {
  const targetGlasses = log.water.targetGlasses ?? settings.waterTargetGlasses;
  const unitAmountMl = log.water.unitAmountMl ?? settings.waterUnitAmountMl;

  if (!isNumber(targetGlasses) || !isNumber(unitAmountMl)) {
    return null;
  }

  return roundToTwoDecimals((targetGlasses * unitAmountMl) / 1000);
}

function formatMacroHistory(log) {
  const derivedPercentages = deriveMacroPercentages(log.calories, log.macros);
  const carbsText = isNumber(log.macroPercentages.carbs ?? derivedPercentages.carbs)
    ? `${roundToOneDecimal(log.macroPercentages.carbs ?? derivedPercentages.carbs)}%`
    : "-";
  const fatText = isNumber(log.macroPercentages.fat ?? derivedPercentages.fat)
    ? `${roundToOneDecimal(log.macroPercentages.fat ?? derivedPercentages.fat)}%`
    : "-";

  return `C ${carbsText} / F ${fatText}`;
}

function formatWaterHistory(log) {
  const targetText = isNumber(log.water.targetGlasses) ? `${roundToOneDecimal(log.water.targetGlasses)}` : "-";
  const unitText = isNumber(log.water.unitAmountMl) ? `${Math.round(log.water.unitAmountMl)} ml` : "-";

  return `In ${formatMaybeNumber(log.water.glasses)} / Target ${targetText} @ ${unitText}`;
}

function createEmptyDailyLog(date) {
  return {
    date,
    weight: null,
    calories: null,
    macros: {
      protein: null,
      carbs: null,
      fat: null,
    },
    macroPercentages: {
      protein: null,
      carbs: null,
      fat: null,
    },
    steps: null,
    sleep: null,
    water: {
      glasses: null,
      targetGlasses: null,
      unitAmountMl: null,
    },
    energy: null,
    notes: "",
  };
}

function mergeDailyLogs(baseLog, incomingLog) {
  const templateDate = incomingLog.date || baseLog.date;

  return {
    ...createEmptyDailyLog(templateDate),
    ...baseLog,
    ...incomingLog,
    macros: {
      ...createEmptyDailyLog(templateDate).macros,
      ...(baseLog.macros || {}),
      ...(incomingLog.macros || {}),
    },
    macroPercentages: {
      ...createEmptyDailyLog(templateDate).macroPercentages,
      ...(baseLog.macroPercentages || {}),
      ...(incomingLog.macroPercentages || {}),
    },
    water: {
      ...createEmptyDailyLog(templateDate).water,
      ...(baseLog.water || {}),
      ...(incomingLog.water || {}),
    },
  };
}

function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value));
}

function dedupeLogsByDate(logs) {
  return Object.values(
    logs.reduce((accumulator, log) => {
      accumulator[log.date] = mergeDailyLogs(
        accumulator[log.date] || createEmptyDailyLog(log.date),
        log
      );
      return accumulator;
    }, {})
  );
}

function getActiveViewName() {
  return document.querySelector(".nav-button.active")?.dataset.view || "dashboard";
}

function generateId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `workout-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function buildDailyLogMap(logs) {
  return Object.fromEntries(logs.map((log) => [log.date, log]));
}

function getAvailableWeekOptions(dailyLogs, workoutLogs) {
  const currentWeek = getISOWeekInfo(new Date());
  const allDates = [
    ...dailyLogs.map((log) => log.date),
    ...workoutLogs.map((log) => log.date),
    currentWeek.start,
  ].filter(Boolean);

  const earliestDate = allDates.sort()[0];
  const earliestWeek = getISOWeekInfo(parseDateString(earliestDate));
  const options = [];
  let cursorDate = parseDateString(currentWeek.start);

  while (getLocalDateString(cursorDate) >= earliestWeek.start) {
    const info = getISOWeekInfo(cursorDate);
    options.push({
      ...info,
      label:
        info.key === currentWeek.key
          ? `Current Week - ${info.start} to ${info.end}`
          : `Week ${info.week}, ${info.year} - ${info.start} to ${info.end}`,
    });
    cursorDate.setDate(cursorDate.getDate() - 7);
  }

  return options;
}

function getCurrentWeekKey() {
  return getISOWeekInfo(new Date()).key;
}

function getPreviousWeekInfo(weekInfo) {
  const previousStartDate = parseDateString(weekInfo.start);
  previousStartDate.setDate(previousStartDate.getDate() - 7);
  return getISOWeekInfo(previousStartDate);
}

function getISOWeekInfo(dateValue) {
  const date = dateValue instanceof Date ? new Date(dateValue) : parseDateString(dateValue);
  date.setHours(12, 0, 0, 0);

  const day = (date.getDay() + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - day);

  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const year = thursday.getFullYear();

  const firstThursday = new Date(year, 0, 4);
  firstThursday.setHours(12, 0, 0, 0);
  const firstMonday = startOfISOWeek(firstThursday);
  const week = Math.round((monday - firstMonday) / (7 * 24 * 60 * 60 * 1000)) + 1;

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    key: `${year}-W${String(week).padStart(2, "0")}`,
    year,
    week,
    start: getLocalDateString(monday),
    end: getLocalDateString(sunday),
    label: `Week ${week}, ${year}`,
  };
}

function startOfISOWeek(dateValue) {
  const date = new Date(dateValue);
  date.setHours(12, 0, 0, 0);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
}

function parseDateString(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function getDateStringsInRange(startDate, endDate) {
  const dates = [];
  const cursor = parseDateString(startDate);
  const end = parseDateString(endDate);

  while (cursor <= end) {
    dates.push(getLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function formatShortDateLabel(dateString) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
  }).format(parseDateString(dateString));
}

function formatLongDate(dateValue) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(dateValue instanceof Date ? dateValue : parseDateString(dateValue));
}

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function calculateAverage(values) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMaybeNumber(value) {
  return isNumber(value) ? value : "-";
}

function valueOrEmpty(value) {
  return value ?? "";
}

function getLocalDateString(date = new Date()) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function shiftDateString(dateString, dayOffset) {
  const shiftedDate = parseDateString(dateString);
  shiftedDate.setDate(shiftedDate.getDate() + dayOffset);
  return getLocalDateString(shiftedDate);
}

function filterLogsByWindow(logs, window) {
  return logs.filter((log) => log.date >= window.start && log.date <= window.end);
}

function sortByDateAsc(first, second) {
  return first.date.localeCompare(second.date);
}

function sortByDateDesc(first, second) {
  return second.date.localeCompare(first.date);
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function roundToTwoDecimals(value) {
  return Math.round(value * 100) / 100;
}

function percentToCalories(percent, calories) {
  if (!isNumber(percent) || !isNumber(calories) || calories <= 0) {
    return null;
  }

  return (percent / 100) * calories;
}

function normalizeCsvDate(value) {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? "" : getLocalDateString(parsedDate);
}

function hashString(value) {
  return Array.from(value).reduce((hash, character) => hash + character.charCodeAt(0), 0);
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildSharedChartOptions(yAxisLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    scales: {
      x: {
        ticks: {
          color: "#98acbc",
        },
        grid: {
          color: "rgba(152, 172, 188, 0.08)",
        },
      },
      y: {
        ticks: {
          color: "#98acbc",
        },
        title: {
          display: true,
          text: yAxisLabel,
          color: "#f5fbff",
        },
        grid: {
          color: "rgba(152, 172, 188, 0.08)",
        },
      },
    },
    plugins: {
      legend: {
        labels: {
          color: "#f5fbff",
        },
      },
    },
  };
}
