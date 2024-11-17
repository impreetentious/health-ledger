/*
  auth.js — Firebase Auth primitives and EmailJS helpers
  ---------------------------------------------------------------------------
  Every function here either returns a plain value / resolved promise, or
  throws an error. No DOM reads, no DOM writes, no appState mutations.

  App-level handlers in app.js call these functions and react to their
  results by updating the UI and state. Keeping that boundary clean means
  auth logic can be tested or swapped without touching any render code.
*/

import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  fetchSignInMethodsForEmail,
  getAdditionalUserInfo,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import { auth, googleProvider, assertFirebaseConfigured } from "./firebase.js";
import { getFriendlyUserName } from "./utils.js";
import {
  EMAILJS_PUBLIC_KEY,
  EMAILJS_SERVICE_ID,
  EMAILJS_WELCOME_TEMPLATE_ID,
  EMAILJS_LEAVING_TEMPLATE_ID,
  isEmailJsConfigured,
} from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Auth state listener
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subscribes to Firebase Auth state changes.
 * Wraps onAuthStateChanged so callers don't need to import the Firebase SDK.
 * Returns the unsubscribe function.
 */
export function watchAuthState(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export function initializeEmailService() {
  const emailClient = globalThis.emailjs;
  if (!emailClient?.init || !isEmailJsConfigured()) return false;
  emailClient.init({ publicKey: EMAILJS_PUBLIC_KEY });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign-in / sign-up
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the Google sign-in popup.
 * Returns { user, isNewUser } so the caller can decide whether to send a
 * welcome email.
 * Throws on any Firebase error (including account-exists-with-different-
 * credential, which the caller inspects via getGoogleCredentialFromError).
 */
export async function signInWithGoogle() {
  assertFirebaseConfigured();
  const userCredential = await signInWithPopup(auth, googleProvider);
  const additionalInfo = getAdditionalUserInfo(userCredential);
  return {
    user:      userCredential.user,
    isNewUser: additionalInfo?.isNewUser ?? false,
  };
}

/**
 * Signs in with email and password.
 * Returns the Firebase user on success; throws on failure.
 */
export async function signInWithEmail(email, password) {
  assertFirebaseConfigured();
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

/**
 * Creates a new account with email and password.
 * Returns the Firebase user on success; throws on failure.
 */
export async function signUpWithEmail(email, password) {
  assertFirebaseConfigured();
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

/** Signs the current user out. */
export async function performSignOut() {
  assertFirebaseConfigured();
  await signOut(auth);
}

// ─────────────────────────────────────────────────────────────────────────────
// Account management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-authenticates the user before a sensitive operation (account deletion).
 * Handles both email/password and Google providers automatically.
 * `password` is only used when the account uses email/password auth.
 */
export async function reauthenticateUser(user, password) {
  assertFirebaseConfigured();
  const providerIds = user.providerData.map((p) => p.providerId);

  if (providerIds.includes("password")) {
    if (!password) {
      throw new Error("Enter your current password before deleting this email/password account.");
    }
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
    return;
  }

  if (providerIds.includes("google.com")) {
    await reauthenticateWithPopup(user, googleProvider);
  }
}

/** Permanently deletes the Firebase Auth account for the given user. */
export async function deleteAuthUser(user) {
  assertFirebaseConfigured();
  await deleteUser(user);
}

/**
 * Updates the display name and / or photo URL on the current user's Firebase
 * Auth profile. Pass empty strings to clear a field.
 * Returns the refreshed auth.currentUser object.
 */
export async function updateUserProfile(displayName, photoURL) {
  assertFirebaseConfigured();
  await updateProfile(auth.currentUser, {
    displayName: displayName || null,
    photoURL:    photoURL    || null,
  });
  return auth.currentUser;
}

// ─────────────────────────────────────────────────────────────────────────────
// Account linking helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the list of sign-in methods registered for an email address.
 * Used to decide how to handle auth/account-exists-with-different-credential.
 */
export async function fetchEmailSignInMethods(email) {
  assertFirebaseConfigured();
  return fetchSignInMethodsForEmail(auth, email);
}

/**
 * Links a pending Google credential to the currently signed-in user.
 * Throws if the link fails (caller handles auth/provider-already-linked etc.).
 */
export async function linkUserWithCredential(user, credential) {
  assertFirebaseConfigured();
  await linkWithCredential(user, credential);
}

/**
 * Extracts the Google OAuth credential embedded in a
 * auth/account-exists-with-different-credential error.
 * Returns null if the error is not of that type.
 */
export function getGoogleCredentialFromError(error) {
  return GoogleAuthProvider.credentialFromError(error);
}

// ─────────────────────────────────────────────────────────────────────────────
// EmailJS helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Sends the welcome email to a newly registered user via EmailJS. */
export async function sendWelcomeEmail(user) {
  await sendEmailJsTemplate(EMAILJS_WELCOME_TEMPLATE_ID, {
    user_name: getFriendlyUserName(user),
    to_email:  user.email || "",
  });
}

/** Sends the account-deletion goodbye email via EmailJS. */
export async function sendGoodbyeEmail(user) {
  await sendEmailJsTemplate(EMAILJS_LEAVING_TEMPLATE_ID, {
    name:     getFriendlyUserName(user),
    to_email: user.email || "",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Private
// ─────────────────────────────────────────────────────────────────────────────

async function sendEmailJsTemplate(templateId, templateParams) {
  if (!isEmailJsConfigured()) {
    throw new Error(
      "EmailJS is not configured yet. Add your EmailJS public key, service ID, and template IDs in js/config.js."
    );
  }

  const emailClient = globalThis.emailjs;

  if (!emailClient?.send) {
    throw new Error(
      "Email service is unavailable. Please try again once EmailJS has loaded.",
    );
  }

  await emailClient.send(EMAILJS_SERVICE_ID, templateId, templateParams);
}
