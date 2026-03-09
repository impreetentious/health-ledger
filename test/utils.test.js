import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMacroPayloadFromInputs,
  calculateMacroCaloriesFromGrams,
  getWeekInfoForDate,
  isValidIsoDateString,
  mergeDailyLogs,
  normalizeBackupPayload,
  normalizeDailyLog,
  normalizeUserSettings,
  parseLegacyCsv,
  splitCsvRow,
} from "../js/utils.js";
import { resolveOfflinePersistence, warnOnLegacyOfflinePersistence } from "../js/config.js";

test("offline persistence uses the Firebase namespace and warns on the legacy namespace", () => {
  assert.equal(resolveOfflinePersistence({ firebase: { enableOfflinePersistence: true } }), true);
  assert.equal(resolveOfflinePersistence({ firebase: { enableOfflinePersistence: false } }), false);
  assert.equal(
    resolveOfflinePersistence({ firebase: { enableOfflinePersistence: "true" } }),
    false,
  );
  assert.equal(resolveOfflinePersistence({}), false);

  const warnings = [];
  warnOnLegacyOfflinePersistence({ firestore: { enableOfflinePersistence: true } }, (message) =>
    warnings.push(message),
  );
  assert.equal(resolveOfflinePersistence({ firestore: { enableOfflinePersistence: true } }), true);
  assert.match(warnings[0], /use firebase\.enableOfflinePersistence/);
});

test("macro math keeps grams and calories internally consistent", () => {
  assert.equal(calculateMacroCaloriesFromGrams({ protein: 180, carbs: 250, fat: 70 }), 2350);

  const payload = buildMacroPayloadFromInputs(null, 180, 250, 70, "grams");
  assert.deepEqual(payload.macros, { protein: 180, carbs: 250, fat: 70 });
  assert.equal(payload.calories, 2350);
  assert.equal(payload.autoCalculatedCalories, true);
  assert.equal(payload.macroPercentages.protein, 30.6);

  const invalid = buildMacroPayloadFromInputs(2000, 40, 30, 20, "percentage");
  assert.match(invalid.error, /exactly 100%/);
});

test("daily merge preserves omitted values while retaining explicit zero", () => {
  const base = {
    date: "2026-07-19",
    weight: 72.4,
    calories: 2300,
    macros: { protein: 180, carbs: 230, fat: 70 },
    macroPercentages: { protein: 31, carbs: 40, fat: 29 },
    steps: 9000,
    sleep: 7.5,
    water: { glasses: 6, targetGlasses: 8, unitAmountMl: 250 },
    energy: 4,
    notes: "Baseline",
  };

  const merged = mergeDailyLogs(base, {
    date: "2026-07-19",
    calories: 0,
    water: { glasses: 7 },
    notes: "  Recovery day  ",
  });

  assert.equal(merged.calories, 0);
  assert.equal(merged.weight, 72.4);
  assert.equal(merged.water.glasses, 7);
  assert.equal(merged.water.targetGlasses, 8);
  assert.equal(merged.notes, "Recovery day");
});

test("daily normalization preserves water fields from the legacy flat schema", () => {
  const normalized = normalizeDailyLog({
    date: "2026-07-19",
    waterGlasses: 7,
    waterTargetGlasses: 9,
    waterUnitAmountMl: 300,
  });

  assert.deepEqual(normalized.water, {
    glasses: 7,
    targetGlasses: 9,
    unitAmountMl: 300,
  });
});

test("settings normalization rejects invalid imported targets", () => {
  const normalized = normalizeUserSettings({
    calorieTarget: -1,
    proteinGramTarget: 160,
    macroTarget: { protein: 80, carbs: 80, fat: -60 },
    waterTargetGlasses: 8,
    waterUnitAmountMl: -250,
  });

  assert.equal(normalized.calorieTarget, 2300);
  assert.equal(normalized.proteinGramTarget, 160);
  assert.deepEqual(normalized.macroTarget, { protein: 30, carbs: 40, fat: 30 });
  assert.equal(normalized.waterUnitAmountMl, 250);
});

test("date and week helpers reject impossible dates and handle ISO-year boundaries", () => {
  assert.equal(isValidIsoDateString("2026-02-29"), false);
  assert.equal(isValidIsoDateString("2024-02-29"), true);
  assert.equal(isValidIsoDateString("2026-13-01"), false);

  const week = getWeekInfoForDate("2021-01-01");
  assert.deepEqual(week, {
    key: "2020-W53",
    label: "Week 53, 2020",
    start: "2020-12-28",
    end: "2021-01-03",
    week: 53,
    year: 2020,
  });
});

test("CSV parsing handles quotes and produces normalized macro fields", () => {
  assert.deepEqual(splitCsvRow('2026-07-19,"72.4",2300,"180",250,70'), [
    "2026-07-19",
    "72.4",
    "2300",
    "180",
    "250",
    "70",
  ]);

  const [log] = parseLegacyCsv(
    "Date,Weight,Calories,Protein,Carbs,Fat\n2026-07-19,72.4,2350,180,250,70",
  );
  assert.deepEqual(log.macros, { protein: 180, carbs: 250, fat: 70 });
  assert.deepEqual(log.macroPercentages, { protein: 30.6, carbs: 42.6, fat: 26.8 });
});

test("backup validation rejects an impossible date before state normalization", () => {
  assert.throws(
    () =>
      normalizeBackupPayload({
        version: 4,
        dailyLogs: [{ date: "2024-02-31" }],
      }),
    /missing a valid YYYY-MM-DD date/,
  );
});

test("backup validation rejects malformed schema versions", () => {
  for (const version of [0, -1, 1.5, "not-a-version"]) {
    assert.throws(
      () => normalizeBackupPayload({ version, dailyLogs: [] }),
      /schema version must be a positive integer/,
    );
  }
});
