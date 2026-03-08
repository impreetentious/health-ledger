/*
  runtime-config.local.example.js — template for your local runtime config.

  Copy this file to js/runtime-config.local.js (which is gitignored) and fill in
  your real values, so deploy-time config never lands in a git-tracked file:

      cp js/runtime-config.local.example.js js/runtime-config.local.js

  runtime-config.js runs first and guarantees globalThis.HEALTH_LEDGER_CONFIG
  exists; this file only populates it. Values still starting with the
  REPLACE_WITH_ prefix are treated as "not configured" (see js/config.js), so an
  unfilled copy leaves the app in its safe offline-preview state instead of
  trying to initialize Firebase with junk.
*/
globalThis.HEALTH_LEDGER_CONFIG ||= {};

globalThis.HEALTH_LEDGER_CONFIG.firebase = {
  apiKey: "REPLACE_WITH_FIREBASE_API_KEY",
  authDomain: "REPLACE_WITH_FIREBASE_AUTH_DOMAIN",
  projectId: "REPLACE_WITH_FIREBASE_PROJECT_ID",
  storageBucket: "REPLACE_WITH_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_WITH_FIREBASE_MESSAGING_SENDER_ID",
  appId: "REPLACE_WITH_FIREBASE_APP_ID",
  // Set true only on a trusted personal device. This leaves a local Firestore
  // cache on the browser after sign-out so warm starts and offline writes work.
  enableOfflinePersistence: false,
};

globalThis.HEALTH_LEDGER_CONFIG.emailjs = {
  publicKey: "REPLACE_WITH_EMAILJS_PUBLIC_KEY",
  serviceId: "REPLACE_WITH_EMAILJS_SERVICE_ID",
  welcomeTemplateId: "REPLACE_WITH_EMAILJS_WELCOME_TEMPLATE_ID",
  leavingTemplateId: "REPLACE_WITH_EMAILJS_LEAVING_TEMPLATE_ID",
};
