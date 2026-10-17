import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMacroPayloadFromInputs,
  buildRestorePlan,
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

test("restore preview folds supplied fields, keeps conflicts, and counts unique dates", () => {
  const workspace = {
    dailyLogs: [normalizeDailyLog({ date: "2026-07-19", weight: 70, calories: 0, notes: "Keep" })],
    workoutLogs: [],
    userSettings: normalizeUserSettings({ calorieTarget: 2100 }),
  };
  const payload = {
    dailyLogs: [
      { date: "2026-07-19", weight: 80, notes: "" },
      { date: "2026-07-19", weight: null, steps: 0 },
      { date: "2026-07-20", weight: 65 },
    ],
  };
  const plan = buildRestorePlan(payload, workspace);
  assert.equal(plan.sourceRows, 3);
  assert.equal(plan.duplicateRows, 1);
  assert.equal(plan.newDates, 1);
  assert.equal(plan.changedDates, 1);
  assert.equal(plan.dailyLogs[0].weight, 70);
  assert.equal(plan.dailyLogs[0].calories, 0);
  assert.equal(plan.dailyLogs[0].notes, "Keep");
  assert.equal(plan.dailyLogs[0].steps, 0);
  assert.equal(plan.userSettings, null);
  const incoming = buildRestorePlan(payload, workspace, { incomingWins: true });
  assert.equal(incoming.dailyLogs[0].weight, 80);
  assert.equal(incoming.dailyLogs[0].notes, "");
  assert.equal(incoming.dailyLogs[0].calories, 0);
});

test("restore settings are opt-in, partial and independent of workout identity", () => {
  const workout = { date: "2026-07-19", id: "old", session_type: "Run", exercises: [] };
  const workspace = {
    dailyLogs: [],
    workoutLogs: [workout],
    userSettings: normalizeUserSettings({ calorieTarget: 2100 }),
  };
  const payload = {
    workoutLogs: [
      { ...workout, id: "different" },
      { ...workout, date: "2026-07-20" },
      { ...workout, date: "2026-07-20", id: "again" },
    ],
    userSettings: { calorieTarget: 0 },
  };
  const plan = buildRestorePlan(payload, workspace, { restoreSettings: true });
  assert.equal(plan.workoutLogs.length, 1);
  assert.equal(plan.workoutSkipped, 2);
  assert.equal(plan.userSettings.calorieTarget, 0);
  assert.equal(plan.userSettings.waterTargetGlasses, workspace.userSettings.waterTargetGlasses);
  assert.equal(buildRestorePlan({ dailyLogs: [] }, workspace).hasChanges, false);
});

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

async function mockPersistence(overrides = {}) {
  const { readFile } = await import("node:fs/promises");
  const state = await import("../js/state.js");
  const utils = await import("../js/utils.js");
  const config = await import("../js/config.js");
  state.invalidateSession();
  state.appState.currentUser = { uid: "A" };
  state.appState.previewMode = false;
  state.clearUserDataState();
  const calls = [];
  const deps = {
    ...state,
    ...utils,
    ...config,
    db: {},
    assertFirebaseConfigured() {},
    doc: (...args) => args.slice(1).join("/"),
    collection: (...args) => args.slice(1).join("/"),
    setDoc: async (ref) => {
      calls.push(ref);
    },
    addDoc: async (ref) => {
      calls.push(ref);
      return { id: "generated" };
    },
    deleteDoc: async (ref) => {
      calls.push(ref);
    },
    writeBatch: () => ({ set() {}, delete() {}, async commit() {} }),
    ...overrides,
  };
  let source = await readFile(new URL("../js/db.js", import.meta.url), "utf8");
  source = source
    .replace(
      /import\s*\{([\s\S]*?)\}\s*from\s*["'][^"']+["'];/g,
      (_, names) => `const {${names}} = deps;`,
    )
    .replaceAll("export ", "");
  source +=
    "\nreturn { saveDailyLog, saveWorkoutLog, deleteDailyLog, deleteWorkoutLog, saveUserSettings, importDailyLogs, prepareWorkspaceRestore, importWorkspaceBackup };";
  const api = await new Function("deps", source)(deps);
  return { ...api, ...state, calls };
}

test("cloud save/delete completions cannot update another account or a repeated UID session", async () => {
  for (const operation of ["daily", "workout", "settings", "deleteDaily", "deleteWorkout"]) {
    let resolve;
    const pending = new Promise((done) => {
      resolve = done;
    });
    const api = await mockPersistence({
      setDoc: () => pending,
      addDoc: () => pending,
      deleteDoc: () => pending,
    });
    api.appState.dailyLogs = [normalizeDailyLog({ date: "2026-07-19", weight: 70 })];
    api.appState.workoutLogs = [{ id: "old", date: "2026-07-19" }];
    const task =
      operation === "daily"
        ? api.saveDailyLog({ date: "2026-07-19", weight: 80 })
        : operation === "workout"
          ? api.saveWorkoutLog({ id: "old", date: "2026-07-19" })
          : operation === "settings"
            ? api.saveUserSettings({ calorieTarget: 0 })
            : operation === "deleteDaily"
              ? api.deleteDailyLog("2026-07-19")
              : api.deleteWorkoutLog("old");
    api.invalidateSession();
    api.appState.currentUser = { uid: "B" };
    api.clearUserDataState();
    const snapshot = JSON.stringify(api.appState);
    resolve({ id: "new" });
    await assert.rejects(task, { name: "StaleSessionError" });
    assert.equal(JSON.stringify(api.appState), snapshot);
  }
  const api = await mockPersistence();
  const token = api.captureSession();
  api.invalidateSession();
  api.appState.currentUser = null;
  api.invalidateSession();
  api.appState.currentUser = { uid: "A" };
  assert.equal(api.isSessionCurrent(token), false);
  const current = api.captureSession();
  api.appState.previewMode = true;
  assert.equal(api.isSessionCurrent(current), false);
});

test("451-row import stops after an old-account committed batch and counts it honestly", async () => {
  let resolve;
  let batches = 0;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const refs = [];
  const api = await mockPersistence({
    writeBatch: () => {
      batches++;
      return {
        set(ref) {
          refs.push(ref);
        },
        commit: () => pending,
      };
    },
  });
  const logs = Array.from({ length: 451 }, (_, index) => ({
    date: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
    weight: 70,
  }));
  const task = api.importDailyLogs(logs);
  api.invalidateSession();
  api.appState.currentUser = { uid: "B" };
  api.clearUserDataState();
  resolve();
  await assert.rejects(
    task,
    (error) => error.name === "StaleSessionError" && error.importProgress.dailyImported === 450,
  );
  assert.equal(batches, 1);
  assert.equal(api.appState.dailyLogs.length, 0);
  assert.ok(refs.every((ref) => ref.startsWith("users/A/")));
});

test("restore rejects stale plans and reports partial writes without rollback claims", async () => {
  let batches = 0;
  const api = await mockPersistence({
    writeBatch: () => ({
      set() {},
      async commit() {
        if (++batches === 2) throw new Error("offline");
      },
    }),
  });
  const payload = {
    dailyLogs: Array.from({ length: 451 }, (_, index) => ({
      date: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
      weight: 70,
    })),
  };
  const plan = api.prepareWorkspaceRestore(payload);
  await assert.rejects(
    api.importWorkspaceBackup(plan),
    (error) => error.importProgress.dailyImported === 450,
  );
  assert.equal(api.appState.dailyLogs.length, 450);
  assert.equal(api.appState.restoreApplying, false);
  await assert.rejects(api.importWorkspaceBackup(plan), /fresh restore preview/);
});

test("restore refuses pending writes and rejects competing writes while applying", async () => {
  let resolveWrite;
  const api = await mockPersistence({
    setDoc: () =>
      new Promise((resolve) => {
        resolveWrite = resolve;
      }),
  });
  const pending = api.saveDailyLog({ date: "2025-01-01", weight: 70 });
  const plan = api.prepareWorkspaceRestore({ dailyLogs: [{ date: "2025-01-02", weight: 72 }] });
  await assert.rejects(api.importWorkspaceBackup(plan), /pending workspace/);
  resolveWrite();
  await pending;
  await assert.rejects(api.importWorkspaceBackup(plan), /fresh restore preview/);
  api.appState.restoreApplying = true;
  await assert.rejects(api.saveUserSettings({ calorieTarget: 1800 }), /already applying/);
  api.appState.restoreApplying = false;
});

test("failed logout cannot change a replacement account's UI", async () => {
  const { readFile } = await import("node:fs/promises");
  const state = await import("../js/state.js");
  const source = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const start = source.indexOf("async function handleLogoutConfirm()");
  const end = source.indexOf("\nasync function sendWelcomeEmailBestEffort", start);
  const calls = [];
  let reject;
  const pending = new Promise((resolve, fail) => {
    reject = fail;
  });
  const deps = {
    ...state,
    dom: { logoutModal: {} },
    closeUtilityModal() {},
    setLoadingState: (...args) => calls.push(args),
    showStatusMessage: (...args) => calls.push(args),
    formatFirebaseError: (error) => error.message,
    performSignOut: () => pending,
    console: { error() {} },
  };
  state.invalidateSession();
  state.appState.currentUser = { uid: "A" };
  state.appState.previewMode = false;
  const names = Object.keys(deps);
  const run = new Function(...names, source.slice(start, end) + "\nreturn handleLogoutConfirm;")(
    ...Object.values(deps),
  );
  const task = run();
  state.invalidateSession();
  state.appState.currentUser = { uid: "B" };
  calls.length = 0;
  reject(new Error("old logout failed"));
  await task;
  assert.deepEqual(calls, []);
  assert.equal(state.appState.currentUser.uid, "B");
});
