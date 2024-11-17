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
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { firebaseConfig, isFirebaseConfigured } from "./config.js";

const firebaseApp = isFirebaseConfigured() ? initializeApp(firebaseConfig) : null;

export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export const db   = firebaseApp ? getFirestore(firebaseApp) : null;

export const googleProvider = firebaseApp ? new GoogleAuthProvider() : null;

if (googleProvider) {
  googleProvider.setCustomParameters({ prompt: "select_account" });
}

export function assertFirebaseConfigured() {
  if (!firebaseApp || !auth || !db || !googleProvider) {
    throw new Error(
      "Firebase is not configured yet. Add your Firebase web app values in js/config.js before using cloud sign-in and sync."
    );
  }
}
