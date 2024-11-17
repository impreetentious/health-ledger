/*
  utils.js — pure helper functions
  ---------------------------------------------------------------------------
  No DOM access. No Firebase calls. No side effects beyond the return value.
  Organised into sections:
    1. Date helpers
    2. Math helpers
    3. String / format helpers
    4. Data models (create, merge, normalise)
    5. Macro math
    6. Water helpers
    7. History formatters
    8. CSV parsing
*/

import {
  DEFAULT_SETTINGS,
  MACRO_CALORIE_MARGIN,
  BACKUP_SCHEMA_VERSION,
} from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Date helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a copy of the given date (or a date parsed from a YYYY-MM-DD string)
 * with its time component fixed at noon local time. Using noon avoids all
 * DST-boundary edge cases when doing arithmetic that crosses midnight.
 */
export function toDateAtNoon(dateInput) {
  if (dateInput instanceof Date) {
    const clone = new Date(dateInput);
    clone.setHours(12, 0, 0, 0);
    return clone;
  }
  const date = new Date(`${dateInput}T12:00:00`);
  date.setHours(12, 0, 0, 0);
  return date;
}

/** Returns the local date as a YYYY-MM-DD string. Defaults to today. */
export function getLocalDateString(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : toDateAtNoon(dateInput);
  const year  = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day   = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Returns a new YYYY-MM-DD string shifted by `offsetDays` from `dateString`. */
export function shiftDateString(dateString, offsetDays) {
  const date = toDateAtNoon(dateString);
  date.setDate(date.getDate() + offsetDays);
  return getLocalDateString(date);
}

/**
 * Normalises a raw CSV date value to YYYY-MM-DD.
 * Accepts already-normalised strings and anything Date can parse.
 * Returns null if the value is empty or unparseable.
 */
export function normalizeCsvDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return getLocalDateString(parsed);
}

/** Long-form date label, e.g. "Wednesday, November 13, 2024". */
export function formatLongDate(dateInput) {
  const date = dateInput instanceof Date ? dateInput : toDateAtNoon(dateInput);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month:   "long",
    day:     "numeric",
    year:    "numeric",
  }).format(date);
}

/** Short chart axis label, e.g. "Jun 10". */
export function formatShortDateLabel(dateInput) {
  const date = toDateAtNoon(dateInput);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

/** Returns the ISO week number and year for any date. */
export function getIsoWeekInfo(dateInput) {
  const date     = toDateAtNoon(dateInput);
  const thursday = new Date(date);
  thursday.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const diffInDays    = Math.round((thursday - firstThursday) / 86400000);
  const week          = 1 + Math.floor((diffInDays + ((firstThursday.getDay() + 6) % 7)) / 7);
  return { year: thursday.getFullYear(), week };
}

/**
 * Returns a full week-info object for any date.
 * Week starts on Monday (ISO 8601 convention).
 */
export function getWeekInfoForDate(dateInput) {
  const date               = toDateAtNoon(dateInput);
  const distanceFromMonday = (date.getDay() + 6) % 7;
  const weekStart          = new Date(date);
  weekStart.setDate(date.getDate() - distanceFromMonday);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const isoInfo = getIsoWeekInfo(weekStart);
  return {
    key:   `${isoInfo.year}-W${String(isoInfo.week).padStart(2, "0")}`,
    label: `Week ${isoInfo.week}, ${isoInfo.year}`,
    start: getLocalDateString(weekStart),
    end:   getLocalDateString(weekEnd),
    week:  isoInfo.week,
    year:  isoInfo.year,
  };
}

/** Returns the ISO week key string for the current local week. */
export function getCurrentWeekKey() {
  return getWeekInfoForDate(getLocalDateString()).key;
}

/** Returns the week-info object for the week immediately before `weekInfo`. */
export function getPreviousWeekInfo(weekInfo) {
  return getWeekInfoForDate(shiftDateString(weekInfo.start, -7));
}

/** Returns an array of YYYY-MM-DD strings for every day in [startDate, endDate]. */
export function getDateStringsInRange(startDate, endDate) {
  const dates  = [];
  const cursor = toDateAtNoon(startDate);
  const end    = toDateAtNoon(endDate);
  while (cursor <= end) {
    dates.push(getLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/** Filters a log array to entries whose date falls within a week-info window. */
export function filterLogsByWindow(logs, weekInfo) {
  return logs.filter((log) => log.date >= weekInfo.start && log.date <= weekInfo.end);
}

/**
 * Derives the sorted list of unique ISO weeks represented in both log arrays
 * plus the current week. Used to populate the dashboard week selector.
 */
export function getAvailableWeekOptions(dailyLogs, workoutLogs) {
  const uniqueWeeks = new Map();
  const allDates = [
    ...dailyLogs.map((log) => log.date),
    ...workoutLogs.map((log) => log.date),
    getLocalDateString(),
  ];
  allDates.forEach((dateString) => {
    const weekInfo = getWeekInfoForDate(dateString);
    uniqueWeeks.set(weekInfo.key, weekInfo);
  });
  return Array.from(uniqueWeeks.values()).sort((l, r) => r.start.localeCompare(l.start));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Math helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the mean of an array of numbers, or null for an empty array. */
export function calculateAverage(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Rounds to one decimal place without floating-point drift. */
export function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Coerces a form-field value to a finite number or null.
 * Empty string, null, undefined, and non-finite results all return null.
 */
export function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Returns true only for finite number primitives. */
export function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Human-readable byte size string, e.g. "12.3 KB". */
export function formatBytes(bytes) {
  if (!isNumber(bytes) || bytes <= 0) return "0 B";
  const units    = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value    = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/** Fast non-cryptographic string hash (djb2 variant, unsigned 32-bit). */
export function hashString(value) {
  return Array.from(value).reduce((hash, ch) => ((hash << 5) - hash + ch.charCodeAt(0)) >>> 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. String / format helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Escapes the five HTML special characters so values are safe for innerHTML. */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&",  "&amp;")
    .replaceAll("<",  "&lt;")
    .replaceAll(">",  "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Returns the stringified number (HTML-escaped) or "-" for non-numbers. */
export function formatMaybeNumber(value) {
  return isNumber(value) ? escapeHtml(String(value)) : "-";
}

/** Display-safe number: integer → no decimals, fraction → one decimal. */
export function formatNumberForDisplay(value) {
  if (!isNumber(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Converts a Firebase error code into a human-readable sentence. */
export function formatFirebaseError(error) {
  if (!error) return "Something went wrong.";
  const code = typeof error.code === "string"
    ? error.code.replace("auth/", "").replace("firestore/", "")
    : "";
  if (!code) return error.message || "Something went wrong.";
  return code
    .split(/[-_/]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Returns the value unchanged, or "" if it is null / undefined. */
export function valueOrEmpty(value) {
  return value ?? "";
}

/** Lowercase-trims an email string for safe comparison. */
export function normalizeEmail(value) {
  return (value || "").trim().toLowerCase();
}

/** Ascending date comparator for Array.prototype.sort. */
export function sortByDateAsc(l, r) {
  return l.date.localeCompare(r.date);
}

/** Descending date comparator for Array.prototype.sort. */
export function sortByDateDesc(l, r) {
  return r.date.localeCompare(l.date);
}

/** Best-effort display name from a Firebase user object. */
export function getFriendlyUserName(user) {
  return user.displayName?.trim() || user.email?.split("@")[0] || "there";
}

/** Returns true when the app is running as a local file or the device is offline. */
export function shouldOfferOfflinePreview() {
  return window.location.protocol === "file:" || !navigator.onLine;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Data models — create, merge, normalise
// ─────────────────────────────────────────────────────────────────────────────

/** Deep-clones any JSON-serialisable value. */
export function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Returns a fresh deep-clone of DEFAULT_SETTINGS. */
export function cloneDefaultSettings() {
  return clonePlainData(DEFAULT_SETTINGS);
}

/** Returns a fully-typed empty daily log for the given date. */
export function createEmptyDailyLog(date) {
  return {
    date,
    weight:   null,
    calories: null,
    macros:            { protein: null, carbs: null, fat: null },
    macroPercentages:  { protein: null, carbs: null, fat: null },
    steps:  null,
    sleep:  null,
    water:  { glasses: null, targetGlasses: null, unitAmountMl: null },
    energy: null,
    notes:  "",
  };
}

/**
 * Merges `incomingLog` on top of `baseLog`.
 * A null / undefined incoming field falls back to the base value.
 * Used for both new saves and partial updates (e.g. quick-water).
 */
export function mergeDailyLogs(baseLog, incomingLog) {
  return {
    date:     incomingLog.date || baseLog.date,
    weight:   toNumberOrNull(incomingLog.weight)   ?? baseLog.weight   ?? null,
    calories: toNumberOrNull(incomingLog.calories) ?? baseLog.calories ?? null,
    macros: {
      protein: toNumberOrNull(incomingLog.macros?.protein) ?? baseLog.macros.protein ?? null,
      carbs:   toNumberOrNull(incomingLog.macros?.carbs)   ?? baseLog.macros.carbs   ?? null,
      fat:     toNumberOrNull(incomingLog.macros?.fat)     ?? baseLog.macros.fat     ?? null,
    },
    macroPercentages: {
      protein: toNumberOrNull(incomingLog.macroPercentages?.protein) ?? baseLog.macroPercentages.protein ?? null,
      carbs:   toNumberOrNull(incomingLog.macroPercentages?.carbs)   ?? baseLog.macroPercentages.carbs   ?? null,
      fat:     toNumberOrNull(incomingLog.macroPercentages?.fat)     ?? baseLog.macroPercentages.fat     ?? null,
    },
    steps: toNumberOrNull(incomingLog.steps) ?? baseLog.steps ?? null,
    sleep: toNumberOrNull(incomingLog.sleep) ?? baseLog.sleep ?? null,
    water: {
      glasses:       toNumberOrNull(incomingLog.water?.glasses)       ?? baseLog.water.glasses       ?? null,
      targetGlasses: toNumberOrNull(incomingLog.water?.targetGlasses) ?? baseLog.water.targetGlasses ?? null,
      unitAmountMl:  toNumberOrNull(incomingLog.water?.unitAmountMl)  ?? baseLog.water.unitAmountMl  ?? null,
    },
    energy: toNumberOrNull(incomingLog.energy) ?? baseLog.energy ?? null,
    notes: typeof incomingLog.notes === "string"
      ? incomingLog.notes.trim()
      : typeof baseLog.notes === "string" ? baseLog.notes : "",
  };
}

/**
 * Ensures a raw daily log (from Firestore or import) has every expected field
 * and that macroPercentages are populated — derived from macros + calories if
 * they were not stored directly.
 */
export function normalizeDailyLog(log) {
  const normalized         = mergeDailyLogs(createEmptyDailyLog(log.date || getLocalDateString()), log);
  const derivedPercentages = deriveMacroPercentages(normalized.calories, normalized.macros);
  normalized.macroPercentages = {
    protein: normalized.macroPercentages.protein ?? derivedPercentages.protein,
    carbs:   normalized.macroPercentages.carbs   ?? derivedPercentages.carbs,
    fat:     normalized.macroPercentages.fat     ?? derivedPercentages.fat,
  };
  return normalized;
}

/** Sanitises a raw exercise object from Firestore or the form. */
export function normalizeExercise(exercise) {
  if (!exercise) return null;
  const sets = Array.isArray(exercise.sets)
    ? exercise.sets
        .map((set) => ({
          reps:   toNumberOrNull(set?.reps),
          weight: toNumberOrNull(set?.weight),
        }))
        .filter((set) => set.reps !== null || set.weight !== null)
    : [];
  return {
    name:         (exercise.name         || "").trim(),
    muscle_group: (exercise.muscle_group || "").trim(),
    sets,
  };
}

/** Ensures a raw workout log has every expected field. */
export function normalizeWorkoutLog(log) {
  return {
    id:           log.id || "",
    date:         log.date || getLocalDateString(),
    session_type: (log.session_type || "").trim(),
    duration:     toNumberOrNull(log.duration),
    exercises:    Array.isArray(log.exercises)
      ? log.exercises.map(normalizeExercise).filter(Boolean)
      : [],
  };
}

/** Applies DEFAULT_SETTINGS fallbacks to any partial settings object. */
export function normalizeUserSettings(settings) {
  return {
    calorieTarget:     toNumberOrNull(settings?.calorieTarget)     ?? DEFAULT_SETTINGS.calorieTarget,
    proteinGramTarget: toNumberOrNull(settings?.proteinGramTarget) ?? DEFAULT_SETTINGS.proteinGramTarget,
    macroTarget: {
      protein: toNumberOrNull(settings?.macroTarget?.protein) ?? DEFAULT_SETTINGS.macroTarget.protein,
      carbs:   toNumberOrNull(settings?.macroTarget?.carbs)   ?? DEFAULT_SETTINGS.macroTarget.carbs,
      fat:     toNumberOrNull(settings?.macroTarget?.fat)     ?? DEFAULT_SETTINGS.macroTarget.fat,
    },
    waterTargetGlasses: toNumberOrNull(settings?.waterTargetGlasses) ?? DEFAULT_SETTINGS.waterTargetGlasses,
    waterUnitAmountMl:  toNumberOrNull(settings?.waterUnitAmountMl)  ?? DEFAULT_SETTINGS.waterUnitAmountMl,
  };
}

/** Converts an array of daily logs to a date-keyed object for O(1) lookup. */
export function buildDailyLogMap(logs) {
  return Object.fromEntries(logs.map((log) => [log.date, log]));
}

/** Builds the synthetic user object used in offline preview mode. */
export function buildOfflinePreviewUser(profile = {}) {
  return {
    uid:         "offline-preview",
    displayName: profile.displayName?.trim() || "Offline Preview",
    email:       profile.email               || "preview@health-ledger.local",
    photoURL:    profile.photoURL            || "",
  };
}

/** Returns a unique ID string that does not rely on Firestore. */
export function generateOfflineId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `offline-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  );
}

/** Stable comparison key for deduplicating workout imports/backups. */
export function getWorkoutSignature(log) {
  const normalized = normalizeWorkoutLog(log);
  return JSON.stringify({
    date: normalized.date,
    session_type: normalized.session_type,
    duration: normalized.duration,
    exercises: normalized.exercises,
  });
}

/** Normalizes a workspace-like payload into the app's in-memory shape. */
export function normalizeWorkspacePayload(payload = {}) {
  return {
    userSettings: normalizeUserSettings(payload.userSettings || {}),
    dailyLogs: Array.isArray(payload.dailyLogs)
      ? payload.dailyLogs.map((log) => normalizeDailyLog(log)).sort(sortByDateAsc)
      : [],
    workoutLogs: Array.isArray(payload.workoutLogs)
      ? payload.workoutLogs.map((log) => normalizeWorkoutLog(log)).sort(sortByDateAsc)
      : [],
    profile: payload.profile || {},
  };
}

/** Parses a JSON backup payload and rejects versions newer than this app supports. */
export function normalizeBackupPayload(payload = {}) {
  const version = toNumberOrNull(payload.version ?? payload.schemaVersion) ?? 1;

  if (version > BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `This backup was created by a newer Health Ledger version (v${version}). Update the app before importing it.`
    );
  }

  const workspace = normalizeWorkspacePayload(payload);

  return {
    version,
    exportedAt: payload.exportedAt || "",
    user: payload.user || null,
    ...workspace,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Macro math
// ─────────────────────────────────────────────────────────────────────────────

/** Calories from grams using standard 4/4/9 multipliers. */
export function calculateMacroCaloriesFromGrams(macros) {
  return macros.protein * 4 + macros.carbs * 4 + macros.fat * 9;
}

/**
 * Derives macro percentage split from stored gram values and total calories.
 * Returns nulls when the inputs are missing or calories is zero.
 */
export function deriveMacroPercentages(calories, macros) {
  if (!isNumber(calories) || calories <= 0) {
    return { protein: null, carbs: null, fat: null };
  }
  return {
    protein: isNumber(macros?.protein) ? roundToOneDecimal(((macros.protein * 4) / calories) * 100) : null,
    carbs:   isNumber(macros?.carbs)   ? roundToOneDecimal(((macros.carbs   * 4) / calories) * 100) : null,
    fat:     isNumber(macros?.fat)     ? roundToOneDecimal(((macros.fat     * 9) / calories) * 100) : null,
  };
}

/**
 * Builds a validated macro payload from raw form inputs.
 * Handles both percentage-mode and gram-mode entry.
 * Returns `{ error: string }` on any validation failure.
 * Pass isPreview = true to get softer, non-blocking error messages.
 */
export function buildMacroPayloadFromInputs(
  calories,
  proteinInput,
  carbInput,
  fatInput,
  macroMode  = "percentage",
  isPreview  = false,
) {
  const hasCalories  = isNumber(calories) && calories > 0;
  const hasProtein   = isNumber(proteinInput);
  const hasCarbs     = isNumber(carbInput);
  const hasFat       = isNumber(fatInput);
  const hasAnyMacro  = hasProtein || hasCarbs || hasFat;
  const hasAllMacros = hasProtein && hasCarbs && hasFat;

  if (!hasAnyMacro) {
    return {
      calories:         hasCalories ? calories : null,
      macros:           { protein: null, carbs: null, fat: null },
      macroPercentages: { protein: null, carbs: null, fat: null },
      assignedPercent:  null,
      remainingPercent: null,
    };
  }

  if (!hasAllMacros) {
    return {
      error: isPreview
        ? "Enter protein, carbs, and fat to validate macro math."
        : "Please enter protein, carbs, and fat before saving macros.",
    };
  }

  if ([proteinInput, carbInput, fatInput].some((v) => v < 0)) {
    return { error: "Macro values cannot be negative." };
  }

  // ── Gram mode ────────────────────────────────────────────────────────────
  if (macroMode === "grams") {
    const calculatedCalories = calculateMacroCaloriesFromGrams({
      protein: proteinInput,
      carbs:   carbInput,
      fat:     fatInput,
    });
    const resolvedCalories = hasCalories ? calories : Math.round(calculatedCalories);

    if (hasCalories && Math.abs(calories - calculatedCalories) > MACRO_CALORIE_MARGIN) {
      return {
        error:
          `Macro grams calculate to ${Math.round(calculatedCalories)} calories ` +
          `(protein ${proteinInput}g × 4 + carbs ${carbInput}g × 4 + fat ${fatInput}g × 9), ` +
          `but Total Calories is ${Math.round(calories)}. Adjust calories or macros before saving.`,
      };
    }

    return {
      calories: resolvedCalories,
      macros:   { protein: proteinInput, carbs: carbInput, fat: fatInput },
      macroPercentages: deriveMacroPercentages(resolvedCalories, {
        protein: proteinInput,
        carbs:   carbInput,
        fat:     fatInput,
      }),
      assignedPercent:      hasCalories ? roundToOneDecimal((calculatedCalories / calories) * 100) : 100,
      remainingPercent:     hasCalories ? roundToOneDecimal(100 - (calculatedCalories / calories) * 100) : 0,
      calculatedCalories,
      autoCalculatedCalories: !hasCalories,
    };
  }

  // ── Percentage mode ───────────────────────────────────────────────────────
  const assignedPercent = proteinInput + carbInput + fatInput;

  if (Math.abs(assignedPercent - 100) > 0.01) {
    return {
      error: `Macro percentages must add up to exactly 100%. Current total: ${roundToOneDecimal(assignedPercent)}%.`,
    };
  }

  if (!hasCalories) {
    return {
      error: isPreview
        ? "Enter calories to convert macro percentages."
        : "Please enter total calories before saving percentage-based macros.",
    };
  }

  const macros = {
    protein: roundToOneDecimal(((calories * proteinInput) / 100) / 4),
    carbs:   roundToOneDecimal(((calories * carbInput)   / 100) / 4),
    fat:     roundToOneDecimal(((calories * fatInput)    / 100) / 9),
  };

  return {
    calories,
    macros,
    macroPercentages: { protein: proteinInput, carbs: carbInput, fat: fatInput },
    assignedPercent:  roundToOneDecimal(assignedPercent),
    remainingPercent: roundToOneDecimal(100 - assignedPercent),
  };
}

/** Returns calorie contribution of each macro from a daily log's gram values. */
export function getMacroCaloriesBreakdown(log) {
  return {
    protein: isNumber(log.macros.protein) ? log.macros.protein * 4 : 0,
    carbs:   isNumber(log.macros.carbs)   ? log.macros.carbs   * 4 : 0,
    fat:     isNumber(log.macros.fat)     ? log.macros.fat     * 9 : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Water helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Converts glasses logged in a daily log to litres. Returns null if data is missing. */
export function getWaterLitersFromLog(log, settings) {
  const glasses      = toNumberOrNull(log?.water?.glasses);
  const unitAmountMl = toNumberOrNull(log?.water?.unitAmountMl) ?? toNumberOrNull(settings?.waterUnitAmountMl);
  if (!isNumber(glasses) || !isNumber(unitAmountMl)) return null;
  return roundToOneDecimal((glasses * unitAmountMl) / 1000);
}

/** Converts the water target for a day to litres. Returns null if data is missing. */
export function getWaterTargetLiters(log, settings) {
  const targetGlasses = toNumberOrNull(log?.water?.targetGlasses) ?? toNumberOrNull(settings?.waterTargetGlasses);
  const unitAmountMl  = toNumberOrNull(log?.water?.unitAmountMl)  ?? toNumberOrNull(settings?.waterUnitAmountMl);
  if (!isNumber(targetGlasses) || !isNumber(unitAmountMl)) return null;
  return roundToOneDecimal((targetGlasses * unitAmountMl) / 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. History formatters
// ─────────────────────────────────────────────────────────────────────────────

/** "P 180 g / C 220 g / F 70 g" summary string for a history table cell. */
export function formatMacroHistory(log) {
  return [
    `P ${isNumber(log.macros.protein) ? `${log.macros.protein} g` : "-"}`,
    `C ${isNumber(log.macros.carbs)   ? `${log.macros.carbs} g`   : "-"}`,
    `F ${isNumber(log.macros.fat)     ? `${log.macros.fat} g`     : "-"}`,
  ].join(" / ");
}

/**
 * "1.8 L / 2.0 L" intake-vs-target string for a history table cell.
 * `settings` is passed explicitly so this function stays pure.
 */
export function formatWaterHistory(log, settings) {
  const intake = getWaterLitersFromLog(log, settings);
  const target = getWaterTargetLiters(log, settings);
  return `${isNumber(intake) ? `${intake.toFixed(1)} L` : "-"} / ${isNumber(target) ? `${target.toFixed(1)} L` : "-"}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. CSV parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splits a single CSV row into an array of trimmed cell strings.
 * Handles quoted fields (including escaped inner quotes).
 */
export function splitCsvRow(row) {
  const values = [];
  let currentValue = "";
  let insideQuotes = false;

  for (let i = 0; i < row.length; i += 1) {
    const ch   = row[i];
    const next = row[i + 1];

    if (ch === '"' && insideQuotes && next === '"') {
      currentValue += '"';
      i += 1;
    } else if (ch === '"') {
      insideQuotes = !insideQuotes;
    } else if (ch === "," && !insideQuotes) {
      values.push(currentValue.trim());
      currentValue = "";
    } else {
      currentValue += ch;
    }
  }

  values.push(currentValue.trim());
  return values;
}

/**
 * Parses the legacy CSV format into an array of daily-log objects.
 * Required columns: Date, Weight, Calories, Protein, Carbs, Fat.
 * Throws a descriptive Error on any validation failure.
 */
export function parseLegacyCsv(csvText) {
  const rows = csvText.trim().replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);

  if (rows.length < 2) {
    throw new Error("The CSV file must include a header row and at least one data row.");
  }

  const headers         = splitCsvRow(rows[0]).map((h) => h.trim().toLowerCase());
  const requiredHeaders = ["date", "weight", "calories", "protein", "carbs", "fat"];
  const missingHeaders  = requiredHeaders.filter((h) => !headers.includes(h));

  if (missingHeaders.length > 0) {
    throw new Error(`Missing CSV columns: ${missingHeaders.join(", ")}.`);
  }

  return rows.slice(1).map((row, index) => {
    const values    = splitCsvRow(row);
    const rowObject = Object.fromEntries(
      headers.map((header, position) => [header, values[position] ?? ""])
    );
    const normalizedDate = normalizeCsvDate(rowObject.date);

    if (!normalizedDate) {
      throw new Error(
        `Invalid date in CSV row ${index + 2}. Use YYYY-MM-DD or a parseable date value.`
      );
    }

    const macros = {
      protein: toNumberOrNull(rowObject.protein),
      carbs:   toNumberOrNull(rowObject.carbs),
      fat:     toNumberOrNull(rowObject.fat),
    };

    return {
      date:             normalizedDate,
      weight:           toNumberOrNull(rowObject.weight),
      calories:         toNumberOrNull(rowObject.calories),
      macros,
      macroPercentages: deriveMacroPercentages(toNumberOrNull(rowObject.calories), macros),
      steps:  null,
      sleep:  null,
      water:  { glasses: null, targetGlasses: null, unitAmountMl: null },
      energy: null,
      notes:  "",
    };
  });
}
