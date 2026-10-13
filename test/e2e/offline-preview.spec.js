import { readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const previewKey = "healthLedger.offlinePreview.v1";

// Read the shipped version instead of hard-coding it, so this stays a test of
// the footer wiring rather than of the current release number.
const appVersion = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;

const firebaseAppStub = "export function initializeApp(config) { return { config }; }";
const firebaseAuthStub = `
export class GoogleAuthProvider {
  setCustomParameters() {}
  static credentialFromError() { return null; }
}
export const EmailAuthProvider = { credential: () => ({}) };
export function getAuth() { return null; }
export function onAuthStateChanged(_auth, callback) { callback(null); return () => {}; }
export async function signInWithPopup() { throw new Error('Firebase stub'); }
export async function signInWithEmailAndPassword() { throw new Error('Firebase stub'); }
export async function createUserWithEmailAndPassword() { throw new Error('Firebase stub'); }
export async function sendPasswordResetEmail() {}
export async function signOut() {}
export async function reauthenticateWithCredential() {}
export async function reauthenticateWithPopup() {}
export async function deleteUser() {}
export async function updateProfile() {}
export async function fetchSignInMethodsForEmail() { return []; }
export async function linkWithCredential() {}
export function getAdditionalUserInfo() { return { isNewUser: false }; }
`;
const firestoreStub = `
export async function addDoc() { return { id: 'stub-doc' }; }
export function collection() { return {}; }
export async function deleteDoc() {}
export function doc() { return {}; }
export async function getDoc() { return { exists: () => false, data: () => ({}) }; }
export async function getDocs() { return { docs: [] }; }
export function getFirestore() { return null; }
export function initializeFirestore() { return null; }
export function persistentLocalCache() { return {}; }
export function persistentMultipleTabManager() { return {}; }
export async function setDoc() {}
export function writeBatch() { return { set() {}, delete() {}, commit: async () => {} }; }
`;
const chartStub = `
window.Chart = class {
  constructor(canvas) {
    if (canvas.__chartLive) throw new Error('Canvas is already in use');
    this.canvas = canvas;
    canvas.__chartLive = true;
  }
  destroy() { this.canvas.__chartLive = false; }
};
`;

async function stubExternalAssets(page) {
  await page.addInitScript({
    content: chartStub + "\nwindow.emailjs = { init() {}, send: async () => ({}) };",
  });
  await page.route("**/js/runtime-config.local.js*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.route("https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: chartStub }),
  );
  await page.route(
    "https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js",
    (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: "window.emailjs = { init() {}, send: async () => ({}) };",
      }),
  );
  await page.route("https://www.gstatic.com/firebasejs/*/firebase-app.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: firebaseAppStub }),
  );
  await page.route("https://www.gstatic.com/firebasejs/*/firebase-auth.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: firebaseAuthStub }),
  );
  await page.route("https://www.gstatic.com/firebasejs/*/firebase-firestore.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: firestoreStub }),
  );
}

async function openOfflinePreview(page, { seeded = false } = {}) {
  // Pin a midweek noon so the seeded day offsets never depend on the day the suite runs.
  await page.clock.install({ time: new Date("2025-12-10T12:00:00") });
  await stubExternalAssets(page);
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "HEALTH_LEDGER_CONFIG", {
      value: Object.freeze({}),
      writable: false,
      configurable: false,
    });
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  });
  if (seeded) {
    await page.addInitScript((key) => {
      const today = new Date();
      const iso = (offset) => {
        const date = new Date(today);
        date.setDate(today.getDate() + offset);
        return date.toISOString().slice(0, 10);
      };
      localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 2,
          profile: { displayName: "Preview Tester", email: "preview@example.test" },
          dailyLogs: [
            {
              date: iso(-10),
              weight: 72,
              calories: 2200,
              macros: { protein: 150, carbs: 230, fat: 70 },
              steps: 8200,
              waterGlasses: 7,
            },
            {
              date: iso(-3),
              weight: 71.6,
              calories: 2300,
              macros: { protein: 160, carbs: 240, fat: 72 },
              steps: 9100,
              waterGlasses: 8,
            },
            {
              date: iso(-1),
              weight: 71.5,
              calories: 2250,
              macros: { protein: 155, carbs: 235, fat: 70 },
              steps: 9400,
              waterGlasses: 9,
            },
          ],
          workoutLogs: [
            {
              id: "w1",
              date: iso(-2),
              session_type: "Upper Body",
              duration: 45,
              exercises: [
                {
                  name: "Bench Press",
                  muscle_group: "Chest",
                  sets: [{ reps: 8, weight: 60 }],
                },
              ],
            },
          ],
        }),
      );
    }, previewKey);
  }

  await page.goto("/");
  const previewButton = page.getByRole("button", { name: /continue in offline preview/i });
  await expect(previewButton).toBeVisible();
  await page.getByRole("button", { name: /continue in offline preview/i }).click();
  await expect(page.locator("body")).not.toHaveClass(/auth-locked/);
  await expect(page.locator("#session-label")).toContainText(/offline preview is active/i);
}

test("offline-preview boot reaches the dashboard without cloud configuration", async ({ page }) => {
  await openOfflinePreview(page);

  await expect(page.getByRole("heading", { name: /welcome back, offline preview/i })).toBeVisible();
  await expect(page.locator("#session-label")).toContainText(/offline preview is active/i);
  await expect(page.locator(".site-footer-center")).toHaveText(`Version v${appVersion}`);
});

test("dashboard week switches do not reuse live chart canvases", async ({ page }) => {
  const chartErrors = [];
  page.on("pageerror", (error) => {
    if (/Canvas is already in use/.test(error.message)) chartErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (/Canvas is already in use/.test(message.text())) chartErrors.push(message.text());
  });

  await openOfflinePreview(page, { seeded: true });
  await expect(page.locator("#waterChart")).toBeVisible();
  const weekSelect = page.getByLabel("Select a week to review");
  const options = await weekSelect
    .locator("option")
    .evaluateAll((nodes) => nodes.map((node) => node.value));
  expect(options.length).toBeGreaterThanOrEqual(2);

  await weekSelect.selectOption(options[1]);
  await weekSelect.selectOption(options[0]);
  expect(chartErrors).toEqual([]);
});

test("backup import gives source workout IDs fresh local identities", async ({ page }) => {
  await openOfflinePreview(page, { seeded: true });
  await page.getByRole("button", { name: "History" }).click();

  const backup = {
    version: 4,
    workoutLogs: [
      {
        id: "w1",
        date: "2026-07-20",
        session_type: "Lower Body",
        duration: 50,
        exercises: [
          {
            name: "Squat",
            muscle_group: "Legs",
            sets: [{ reps: 5, weight: 80 }],
          },
        ],
      },
    ],
  };

  await page.locator("#backup-import").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.locator("#confirmation-confirm-button").click();
  await expect(page.locator("#toast-region")).toContainText("1 workout(s)");

  const storedWorkouts = await page.evaluate((key) => {
    return JSON.parse(localStorage.getItem(key)).workoutLogs;
  }, previewKey);
  expect(storedWorkouts).toHaveLength(2);
  expect(new Set(storedWorkouts.map((workout) => workout.id)).size).toBe(2);
  expect(storedWorkouts.map((workout) => workout.session_type).sort()).toEqual([
    "Lower Body",
    "Upper Body",
  ]);
});

test("account modal delete control is reachable on a 375px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openOfflinePreview(page);

  await page.getByRole("button", { name: /offline preview/i }).click();
  await page.getByRole("menuitem", { name: /my account/i }).click();
  const deleteButton = page.getByRole("button", { name: "Delete My Account" });
  await deleteButton.scrollIntoViewIfNeeded();
  await expect(deleteButton).toBeVisible();

  const box = await deleteButton.boundingBox();
  expect(box).not.toBeNull();
  expect(box.y + box.height).toBeLessThanOrEqual(667);
});

test("offline-preview dashboard has no automated WCAG A/AA violations", async ({ page }) => {
  await openOfflinePreview(page, { seeded: true });

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});
