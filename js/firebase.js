/*
  firebase.js — single initialisation point for the Firebase SDK
  ---------------------------------------------------------------------------
  All other modules that need `auth`, `db`, or `googleProvider` import from
  here. The Firebase app is only initialised once.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import {
  firebaseConfig,
  isFirebaseConfigured,
  FIRESTORE_OFFLINE_PERSISTENCE_ENABLED,
} from "./config.js";

const firebaseApp = isFirebaseConfigured() ? initializeApp(firebaseConfig) : null;

export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export const db = initializeDatabase(firebaseApp);

export const googleProvider = firebaseApp ? new GoogleAuthProvider() : null;

if (googleProvider) {
  googleProvider.setCustomParameters({ prompt: "select_account" });
}

function initializeDatabase(app) {
  if (!app) return null;

  // Firestore's browser cache survives sessions, so keep it a deliberate
  // deploy-time choice for a trusted device. Multi-tab coordination avoids the
  // old single-tab persistence failure mode. Unsupported browser storage falls
  // back to Firestore's normal memory cache without blocking sign-in.
  if (!FIRESTORE_OFFLINE_PERSISTENCE_ENABLED || typeof indexedDB === "undefined") {
    return getFirestore(app);
  }

  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    return getFirestore(app);
  }
}

export function assertFirebaseConfigured() {
  if (!firebaseApp || !auth || !db || !googleProvider) {
    throw new Error(
      "Firebase is not configured yet. Add your Firebase web app values in js/config.js before using cloud sign-in and sync.",
    );
  }
}
