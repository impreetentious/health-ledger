/*
  forms.js — form population, macro preview, and workout exercise/set builder
  ---------------------------------------------------------------------------
  Owns the daily log form, workout log form, settings form, and account form.
  Dashboard rendering and history tables live in their own modules.
*/

import { dom } from "./dom.js";
import { appState, getExistingDailyLog } from "./state.js";
import {
  getLocalDateString,
  valueOrEmpty,
  deriveMacroPercentages,
  buildMacroPayloadFromInputs,
  toNumberOrNull,
  isNumber,
  escapeHtml,
  createEmptyDailyLog,
} from "./utils.js";

// ─────────────────────────────────────────────────────────────────────────────
// Daily log form
// ─────────────────────────────────────────────────────────────────────────────

/** Sets both the daily-log and workout-log date inputs to today. */
export function seedFormDates() {
  const today = getLocalDateString();
  dom.dailyForm.elements.date.value = today;
  dom.workoutForm.elements.date.value = today;
}

/**
 * Populates the daily log form with the saved log for `date`, or an empty
 * log if none exists yet. Always resets macro mode to percentage on load.
 */
export function populateDailyFormForDate(date) {
  const settings = appState.userSettings;
  const existingLog = getExistingDailyLog(date);
  const log = existingLog || createEmptyDailyLog(date);
  const derivedPercentages = deriveMacroPercentages(log.calories, log.macros);

  dom.dailyForm.elements.macroMode.value = "percentage";
  updateMacroInputMode();
  dom.dailyForm.elements.date.value = date;
  dom.dailyForm.elements.weight.value = valueOrEmpty(log.weight);
  dom.dailyForm.elements.calories.value = valueOrEmpty(log.calories);
  dom.dailyForm.elements.protein.value = valueOrEmpty(
    log.macroPercentages.protein ?? derivedPercentages.protein
  );
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

/** Rewrites the macro preview block from the current form values. */
export function updateNutritionPreview() {
  const calories = toNumberOrNull(dom.dailyForm.elements.calories.value);
  const protein = toNumberOrNull(dom.dailyForm.elements.protein.value);
  const carbPercent = toNumberOrNull(dom.dailyForm.elements.carbPercent.value);
  const fatPercent = toNumberOrNull(dom.dailyForm.elements.fatPercent.value);
  const macroMode = dom.dailyForm.elements.macroMode.value;

  const payload = buildMacroPayloadFromInputs(
    calories,
    protein,
    carbPercent,
    fatPercent,
    macroMode,
    true
  );

  if (payload.error) {
    dom.macroPreview.innerHTML = `<strong>Check:</strong> ${escapeHtml(payload.error)}`;
    return;
  }

  if (macroMode === "grams") {
    const calculatedText = isNumber(payload.calculatedCalories)
      ? `${Math.round(payload.calculatedCalories)} calories`
      : "Enter grams";
    const calorieText = isNumber(payload.calories)
      ? `${Math.round(payload.calories)} calories`
      : calculatedText;
    const proteinShare = isNumber(payload.macroPercentages.protein)
      ? `${payload.macroPercentages.protein.toFixed(1)}%`
      : "-";
    const carbsShare = isNumber(payload.macroPercentages.carbs)
      ? `${payload.macroPercentages.carbs.toFixed(1)}%`
      : "-";
    const fatShare = isNumber(payload.macroPercentages.fat)
      ? `${payload.macroPercentages.fat.toFixed(1)}%`
      : "-";

    dom.macroPreview.innerHTML = `
      <strong>Nutrition preview</strong><br />
      Gram math totals <strong>${calculatedText}</strong>. Saved calories will be
      <strong>${calorieText}</strong>.<br />
      Macro split: protein <strong>${proteinShare}</strong>, carbs <strong>${carbsShare}</strong>,
      fat <strong>${fatShare}</strong>.
    `;
    return;
  }

  const proteinText = isNumber(payload.macros.protein) ? `${payload.macros.protein.toFixed(1)} g` : "Enter calories";
  const carbsText = isNumber(payload.macros.carbs) ? `${payload.macros.carbs.toFixed(1)} g` : "Enter calories";
  const fatText = isNumber(payload.macros.fat) ? `${payload.macros.fat.toFixed(1)} g` : "Enter calories";
  const assignedText = isNumber(payload.assignedPercent)
    ? `${payload.assignedPercent.toFixed(1)}%`
    : "Not available";
  const remainingText = isNumber(payload.remainingPercent)
    ? `${payload.remainingPercent.toFixed(1)}%`
    : "Not available";

  dom.macroPreview.innerHTML = `
    <strong>Nutrition preview</strong><br />
    Protein converts to <strong>${proteinText}</strong>, carbs convert to <strong>${carbsText}</strong>,
    and fat converts to <strong>${fatText}</strong>.<br />
    Assigned intake: <strong>${assignedText}</strong>. Remaining unassigned: <strong>${remainingText}</strong>.
  `;
}

/** Swaps protein/carb/fat field labels and constraints between % and gram mode. */
export function updateMacroInputMode() {
  const isGrams = dom.dailyForm.elements.macroMode.value === "grams";
  const proteinInput = dom.dailyForm.elements.protein;
  const carbsInput = dom.dailyForm.elements.carbPercent;
  const fatInput = dom.dailyForm.elements.fatPercent;

  dom.dailyProteinLabel.textContent = isGrams ? "Protein (g)" : "Protein (%)";
  dom.dailyCarbsLabel.textContent = isGrams ? "Carbs (g)" : "Carbs (%)";
  dom.dailyFatLabel.textContent = isGrams ? "Fat (g)" : "Fat (%)";

  proteinInput.placeholder = isGrams ? "180" : "30";
  carbsInput.placeholder = isGrams ? "220" : "40";
  fatInput.placeholder = isGrams ? "70" : "30";

  [proteinInput, carbsInput, fatInput].forEach((input) => {
    if (isGrams) {
      input.removeAttribute("max");
      input.step = "0.1";
    } else {
      input.max = "100";
      input.step = "0.1";
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Workout log form — exercise / set builder
// ─────────────────────────────────────────────────────────────────────────────

/** Clears the workout form and seeds it with today's date and one blank exercise card. */
export function resetWorkoutForm() {
  dom.workoutForm.reset();
  delete dom.workoutForm.dataset.editingWorkoutId;
  dom.workoutForm.elements.date.value = getLocalDateString();
  dom.exerciseList.innerHTML = "";
  addExerciseCard();
  dom.workoutSaveButton.textContent = "Save Workout Log";
}

/**
 * Loads a saved workout into the entry form for editing or repeating. Passing
 * `isRepeat: true` intentionally clears the source ID so saving creates a new
 * session rather than mutating the original history item.
 */
export function populateWorkoutForm(workout, { isRepeat = false } = {}) {
  dom.workoutForm.reset();
  dom.exerciseList.innerHTML = "";
  dom.workoutForm.elements.date.value = isRepeat ? getLocalDateString() : workout.date;
  dom.workoutForm.elements.session_type.value = workout.session_type || "";
  dom.workoutForm.elements.duration.value = valueOrEmpty(workout.duration);

  if (isRepeat || !workout.id) {
    delete dom.workoutForm.dataset.editingWorkoutId;
    dom.workoutSaveButton.textContent = "Save Repeated Workout";
  } else {
    dom.workoutForm.dataset.editingWorkoutId = workout.id;
    dom.workoutSaveButton.textContent = "Save Workout Changes";
  }

  const exercises = workout.exercises?.length ? workout.exercises : [null];
  exercises.forEach((exercise) => addExerciseCard(exercise));
}

/**
 * Appends a new exercise card to the workout form.
 * Pass an existing exercise object to pre-fill it (e.g. when loading a
 * saved workout template into the form).
 */
export function addExerciseCard(exercise = null) {
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
        <input type="text" class="exercise-name" list="exercise-name-options" placeholder="Bench Press" required />
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

/** Appends a single set row (reps + weight) inside an exercise card's set list. Private. */
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

/** Reads every exercise card in the workout form into a plain array, dropping incomplete entries. */
export function collectExercisesFromForm() {
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

/** Updates the workout form's datalist from the user's existing exercise names. */
export function populateExerciseNameSuggestions(workoutLogs) {
  const names = new Map();
  workoutLogs.forEach((workout) => {
    workout.exercises?.forEach((exercise) => {
      const name = exercise.name?.trim();
      if (name) names.set(name.toLocaleLowerCase(), name);
    });
  });

  dom.exerciseNameOptions.innerHTML = "";
  [...names.values()]
    .sort((left, right) => left.localeCompare(right))
    .forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      dom.exerciseNameOptions.append(option);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings + account forms
// ─────────────────────────────────────────────────────────────────────────────

/** Writes the current appState.userSettings into the preferences modal form. */
export function populateSettingsForm() {
  const settings = appState.userSettings;
  dom.settingsForm.elements.calorieTarget.value = settings.calorieTarget;
  dom.settingsForm.elements.proteinGramTarget.value = settings.proteinGramTarget;
  dom.settingsForm.elements.proteinTarget.value = settings.macroTarget.protein;
  dom.settingsForm.elements.carbsTarget.value = settings.macroTarget.carbs;
  dom.settingsForm.elements.fatTarget.value = settings.macroTarget.fat;
  dom.settingsForm.elements.waterTargetGlasses.value = settings.waterTargetGlasses;
  dom.settingsForm.elements.waterUnitAmountMl.value = settings.waterUnitAmountMl;
}

/** Writes the current user's display name and photo URL into the account modal form. */
export function populateAccountForm() {
  const user = appState.currentUser;
  dom.accountDisplayName.value = user?.displayName || "";
  dom.accountPhotoUrl.value = user?.photoURL || "";
  dom.accountDeletePassword.value = "";
}
