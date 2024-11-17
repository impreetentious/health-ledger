const PLACEHOLDER_PREFIX = "REPLACE_WITH_";
const runtimeConfig = globalThis.HEALTH_LEDGER_CONFIG || {};

function resolveConfigValue(runtimeValue, fallbackValue) {
  return typeof runtimeValue === "string" && runtimeValue.trim() !== ""
    ? runtimeValue.trim()
    : fallbackValue;
}

export const firebaseConfig = {
  apiKey: resolveConfigValue(runtimeConfig.firebase?.apiKey, "REPLACE_WITH_FIREBASE_API_KEY"),
  authDomain: resolveConfigValue(runtimeConfig.firebase?.authDomain, "REPLACE_WITH_FIREBASE_AUTH_DOMAIN"),
  projectId: resolveConfigValue(runtimeConfig.firebase?.projectId, "REPLACE_WITH_FIREBASE_PROJECT_ID"),
  storageBucket: resolveConfigValue(runtimeConfig.firebase?.storageBucket, "REPLACE_WITH_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: resolveConfigValue(
    runtimeConfig.firebase?.messagingSenderId,
    "REPLACE_WITH_FIREBASE_MESSAGING_SENDER_ID"
  ),
  appId: resolveConfigValue(runtimeConfig.firebase?.appId, "REPLACE_WITH_FIREBASE_APP_ID"),
};

export const OFFLINE_PREVIEW_STORAGE_KEY = "healthLedger.offlinePreview.v1";
export const MACRO_CALORIE_MARGIN = 15;
export const LOCAL_WORKSPACE_SCHEMA_VERSION = 2;
export const BACKUP_SCHEMA_VERSION = 4;
export const EMAILJS_PUBLIC_KEY = resolveConfigValue(
  runtimeConfig.emailjs?.publicKey,
  "REPLACE_WITH_EMAILJS_PUBLIC_KEY"
);
export const EMAILJS_SERVICE_ID = resolveConfigValue(
  runtimeConfig.emailjs?.serviceId,
  "REPLACE_WITH_EMAILJS_SERVICE_ID"
);
export const EMAILJS_WELCOME_TEMPLATE_ID = resolveConfigValue(
  runtimeConfig.emailjs?.welcomeTemplateId,
  "REPLACE_WITH_EMAILJS_WELCOME_TEMPLATE_ID"
);
export const EMAILJS_LEAVING_TEMPLATE_ID = resolveConfigValue(
  runtimeConfig.emailjs?.leavingTemplateId,
  "REPLACE_WITH_EMAILJS_LEAVING_TEMPLATE_ID"
);

export const DEFAULT_SETTINGS = {
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

export const DAILY_QUOTES = [
  { text: "Consistency is still progress when the day feels ordinary.", source: "Daily Ledger" },
  { text: "A calm system beats a perfect week.", source: "Daily Ledger" },
  { text: "One honest log is better than a forgotten ideal.", source: "Daily Ledger" },
  { text: "Momentum usually starts as something small repeated on time.", source: "Daily Ledger" },
  { text: "Take care of the boring basics and the big results start behaving.", source: "Daily Ledger" },
  { text: "Your plan does not need drama. It needs another solid day.", source: "Daily Ledger" },
  { text: "Energy follows structure more often than motivation.", source: "Daily Ledger" },
  { text: "The body likes patience more than heroics.", source: "Daily Ledger" },
];

function hasRealConfigValue(value) {
  return typeof value === "string"
    && value.trim() !== ""
    && !value.startsWith(PLACEHOLDER_PREFIX);
}

export function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every(hasRealConfigValue);
}

export function isEmailJsConfigured() {
  return [
    EMAILJS_PUBLIC_KEY,
    EMAILJS_SERVICE_ID,
    EMAILJS_WELCOME_TEMPLATE_ID,
    EMAILJS_LEAVING_TEMPLATE_ID,
  ].every(hasRealConfigValue);
}
