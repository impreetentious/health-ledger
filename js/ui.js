/*
  ui.js — DOM state setters and UI helpers
  ---------------------------------------------------------------------------
  Every function that reads or writes the visible UI state lives here, with
  the exception of form population (forms.js), dashboard rendering
  (dashboard.js), and history tables (history.js).

  No Firebase calls. No appState mutations beyond authPending (which is a
  UI-coupled flag that belongs alongside the elements it disables).
*/

import { dom } from "./dom.js";
import { appState } from "./state.js";
import {
  getFriendlyUserName,
  hashString,
  getLocalDateString,
  shouldOfferOfflinePreview,
} from "./utils.js";
import { DAILY_QUOTES, isFirebaseConfigured } from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Session / profile strip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updates the profile strip and session label to reflect the signed-in user.
 * Pass null to render the signed-out state.
 */
export function setSessionState(user) {
  if (!user) {
    dom.sessionLabel.textContent = "Sign in to sync your Health Ledger privately to the cloud.";
    dom.profileShell.hidden      = true;
    dom.profileTrigger.setAttribute("aria-expanded", "false");
    dom.profileMenu.hidden       = true;
    dom.profileName.textContent    = "Health Ledger User";
    dom.profileSubtitle.textContent = "My Profile";
    dom.profileAvatarImage.hidden  = true;
    dom.profileAvatarImage.removeAttribute("src");
    dom.profileAvatarFallback.hidden = false;
    return;
  }

  dom.sessionLabel.textContent = appState.previewMode
    ? `Offline preview is active for ${getFriendlyUserName(user)}.`
    : `Signed in as ${getFriendlyUserName(user)}. Cloud sync is live.`;

  dom.profileShell.hidden = false;
  dom.profileTrigger.setAttribute("aria-expanded", "false");
  dom.profileMenu.hidden  = true;

  dom.profileName.textContent     = getFriendlyUserName(user);
  dom.profileSubtitle.textContent = appState.previewMode
    ? "Stored in this browser"
    : user.email || "My Profile";

  if (user.photoURL) {
    dom.profileAvatarImage.src    = user.photoURL;
    dom.profileAvatarImage.hidden = false;
    dom.profileAvatarFallback.hidden = true;
  } else {
    dom.profileAvatarImage.hidden = true;
    dom.profileAvatarImage.removeAttribute("src");
    dom.profileAvatarFallback.hidden = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading overlay
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shows or hides the full-screen loading overlay.
 * `title` appears as the large label; `message` as the sub-copy.
 */
export function setLoadingState(
  isVisible,
  message = "Working...",
  title   = "Syncing Health Ledger",
) {
  document.body.classList.toggle("app-busy", isVisible);
  dom.loadingOverlay.hidden  = !isVisible;
  dom.loadingLabel.textContent = title;
  dom.loadingCopy.textContent  = message;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth overlay
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locks or unlocks the app shell behind the auth overlay.
 * Locking also collapses any open transient UI (menus, modals).
 */
export function setAppLocked(isLocked) {
  document.body.classList.toggle("auth-locked", isLocked);
  dom.authOverlay.hidden = !isLocked;
  if (isLocked) closeTransientUi();
}

/**
 * Updates the auth feedback paragraph.
 * `tone` is an optional CSS class name: "error" | "success" | "".
 */
export function setAuthFeedback(message, tone = "") {
  dom.authFeedback.textContent = message;
  dom.authFeedback.className   = "auth-feedback";
  if (tone) dom.authFeedback.classList.add(tone);
}

/**
 * Disables / re-enables every interactive element in the auth overlay while
 * a sign-in request is in flight, and updates the authPending flag.
 */
export function setAuthPending(isPending) {
  appState.authPending = isPending;

  [
    dom.authEmail,
    dom.authPassword,
    dom.googleSigninButton,
    dom.emailSigninButton,
    dom.emailSignupButton,
    dom.offlinePreviewButton,
  ].forEach((el) => { el.disabled = isPending; });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status message bar
// ─────────────────────────────────────────────────────────────────────────────

/** Shows the status bar with either an info (accent) or error (danger) style. */
export function showStatusMessage(message, isError = false) {
  dom.statusMessage.textContent = message;
  dom.statusMessage.classList.add("visible");
  dom.statusMessage.style.background   = isError
    ? "rgba(255, 133, 133, 0.12)"
    : "rgba(104, 228, 255, 0.12)";
  dom.statusMessage.style.borderColor  = isError
    ? "rgba(255, 133, 133, 0.22)"
    : "rgba(104, 228, 255, 0.2)";
}

/** Hides and clears the status bar. */
export function clearStatusMessage() {
  dom.statusMessage.textContent = "";
  dom.statusMessage.classList.remove("visible");
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile menu
// ─────────────────────────────────────────────────────────────────────────────

/** Opens or closes the profile dropdown menu and syncs the aria-expanded state. */
export function setProfileMenuOpen(isOpen) {
  dom.profileTrigger.setAttribute("aria-expanded", String(isOpen));
  dom.profileMenu.hidden = !isOpen;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility modals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a utility modal (account, preferences, logout).
 * Collapses any other open transient UI first so only one is ever visible.
 */
export function openUtilityModal(modal) {
  closeTransientUi();
  modal.hidden = false;
}

/** Closes a utility modal by hiding it. */
export function closeUtilityModal(modal) {
  modal.hidden = true;
}

/**
 * Collapses every piece of transient UI simultaneously:
 * profile menu + all three modals.
 */
export function closeTransientUi() {
  setProfileMenuOpen(false);
  dom.accountModal.hidden     = true;
  dom.preferencesModal.hidden = true;
  dom.logoutModal.hidden      = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc UI helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the view name ("dashboard" | "entry" | "history") currently
 * reflected by the active nav button.
 */
export function getActiveViewName() {
  return document.querySelector(".nav-button.active")?.dataset.view || "dashboard";
}

/**
 * Picks a daily quote from the DAILY_QUOTES array using a stable hash of
 * today's date string, then writes it into the quote card.
 */
export function setDailyQuote() {
  const index  = hashString(getLocalDateString()) % DAILY_QUOTES.length;
  const quote  = DAILY_QUOTES[index];
  dom.dailyQuoteText.textContent   = quote.text;
  dom.dailyQuoteSource.textContent = quote.source;
}

/**
 * Shows or hides the offline preview block in the auth overlay.
 * Preview is offered when the app runs from a local file, the device is
 * offline, or Firebase is not configured — in that last case the auth copy
 * already points users at preview, so the button must actually be there.
 * Also sets the initial auth feedback message for the local-context case.
 */
export function configureOfflinePreviewUi() {
  const isLocalContext = shouldOfferOfflinePreview();
  const isAvailable = isLocalContext || !isFirebaseConfigured();
  dom.offlinePreviewBlock.hidden = !isAvailable;

  if (isLocalContext) {
    dom.offlinePreviewCopy.textContent =
      "This local file preview cannot complete Firebase sign-in reliably. " +
      "You can still open Health Ledger in offline preview mode and keep test data in this browser.";
    setAuthFeedback(
      "Use a local server for real Firebase sign-in, or continue in offline preview mode here.",
      "error",
    );
  } else if (isAvailable) {
    dom.offlinePreviewCopy.textContent =
      "Cloud sign-in is unavailable because Firebase is not configured in this copy. " +
      "You can open Health Ledger in offline preview mode and keep test data in this browser.";
  }
}
