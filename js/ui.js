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

let activeBlockingLoads = 0;
let confirmationResolver = null;
let activeDialog = null;
let dialogRestoreTarget = null;
const buttonStates = new WeakMap();
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

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
  activeBlockingLoads = isVisible
    ? activeBlockingLoads + 1
    : Math.max(0, activeBlockingLoads - 1);

  if (isVisible) {
    dom.loadingLabel.textContent = title;
    dom.loadingCopy.textContent  = message;
  }

  dom.loadingOverlay.hidden = activeBlockingLoads === 0;
}

/**
 * Marks a local action control busy without freezing the entire application.
 * Its original disabled state is restored exactly when the action settles.
 */
export function setButtonLoading(button, isLoading) {
  if (!button) return;

  if (isLoading) {
    if (!buttonStates.has(button)) {
      buttonStates.set(button, { disabled: button.disabled });
    }
    button.disabled = true;
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    return;
  }

  const originalState = buttonStates.get(button);
  button.disabled = originalState?.disabled ?? false;
  button.classList.remove("is-loading");
  button.removeAttribute("aria-busy");
  buttonStates.delete(button);
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
  if (isLocked) {
    closeTransientUi();
    focusDialog(dom.authOverlay);
  }
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

/** Writes field-level auth validation errors without relying on native bubbles. */
export function setAuthFieldErrors({ email = "", password = "" } = {}) {
  dom.authEmailError.textContent = email;
  dom.authPasswordError.textContent = password;
  dom.authEmail.setAttribute("aria-invalid", String(Boolean(email)));
  dom.authPassword.setAttribute("aria-invalid", String(Boolean(password)));
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
    dom.passwordResetButton,
    dom.passwordVisibilityButton,
    dom.offlinePreviewButton,
  ].forEach((el) => { el.disabled = isPending; });
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast notifications
// ─────────────────────────────────────────────────────────────────────────────

/** Shows an auto-dismissing notification. Hovering or focusing pins it for manual dismissal. */
export function showStatusMessage(message, isError = false) {
  const toast = document.createElement("div");
  const text = document.createElement("span");
  const dismiss = document.createElement("button");
  let timeoutId = null;

  toast.className = `toast ${isError ? "toast--error" : "toast--info"}`;
  toast.setAttribute("role", isError ? "alert" : "status");
  text.className = "toast__message";
  text.textContent = message;
  dismiss.type = "button";
  dismiss.className = "toast__dismiss";
  dismiss.setAttribute("aria-label", "Dismiss notification");
  dismiss.textContent = "Dismiss";

  const removeToast = () => {
    if (timeoutId) clearTimeout(timeoutId);
    toast.remove();
  };
  const scheduleDismissal = () => {
    timeoutId = window.setTimeout(removeToast, 4000);
  };

  toast.addEventListener("mouseenter", () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
  });
  toast.addEventListener("focusin", () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
  });
  dismiss.addEventListener("click", removeToast);
  toast.append(text, dismiss);
  dom.toastRegion.appendChild(toast);
  scheduleDismissal();
}

/** Hides and clears all pending notifications. */
export function clearStatusMessage() {
  dom.toastRegion.replaceChildren();
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
  const returnTarget = getDialogReturnTarget();
  closeTransientUi();
  showDialog(modal, returnTarget);
}

/** Closes a utility modal by hiding it. */
export function closeUtilityModal(modal) {
  hideDialog(modal);
}

/** Opens the shared in-app confirmation dialog and resolves with the user's choice. */
export function requestConfirmation({
  eyebrow = "Confirm action",
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
}) {
  const returnTarget = getDialogReturnTarget();
  closeTransientUi();
  dom.confirmationEyebrow.textContent = eyebrow;
  dom.confirmationTitle.textContent = title;
  dom.confirmationMessage.textContent = message;
  dom.confirmationConfirmButton.textContent = confirmLabel;
  dom.confirmationConfirmButton.classList.toggle("danger-button", danger);

  return new Promise((resolve) => {
    confirmationResolver = resolve;
    showDialog(dom.confirmationModal, returnTarget, dom.confirmationConfirmButton);
  });
}

/** Settles the currently open shared confirmation dialog, if any. */
export function settleConfirmation(isConfirmed) {
  const resolve = confirmationResolver;
  confirmationResolver = null;
  hideDialog(dom.confirmationModal);
  resolve?.(isConfirmed);
}

/**
 * Collapses every piece of transient UI simultaneously:
 * profile menu + all utility and confirmation modals.
 */
export function closeTransientUi() {
  setProfileMenuOpen(false);
  hideDialog(dom.accountModal, { restoreFocus: false });
  hideDialog(dom.preferencesModal, { restoreFocus: false });
  hideDialog(dom.logoutModal, { restoreFocus: false });
  if (!dom.confirmationModal.hidden || confirmationResolver) {
    const resolve = confirmationResolver;
    confirmationResolver = null;
    hideDialog(dom.confirmationModal, { restoreFocus: false });
    resolve?.(false);
  }
}

/** Keeps keyboard focus inside the currently visible dialog. */
export function handleDialogFocusTrap(event) {
  if (event.key !== "Tab") return;

  const dialog = getCurrentDialog();
  if (!dialog) return;

  const focusable = getFocusableElements(dialog);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function showDialog(modal, returnTarget, preferredFocus = null) {
  activeDialog = modal;
  dialogRestoreTarget = returnTarget;
  modal.hidden = false;
  focusDialog(modal, preferredFocus);
}

function hideDialog(modal, { restoreFocus = true } = {}) {
  const wasActiveDialog = activeDialog === modal;
  modal.hidden = true;

  if (!wasActiveDialog) return;

  activeDialog = null;
  const restoreTarget = dialogRestoreTarget;
  dialogRestoreTarget = null;
  if (restoreFocus) restoreDialogFocus(restoreTarget);
}

function getCurrentDialog() {
  if (activeDialog && !activeDialog.hidden) return activeDialog;
  return dom.authOverlay.hidden ? null : dom.authOverlay;
}

function getDialogReturnTarget() {
  if (activeDialog && dialogRestoreTarget) return dialogRestoreTarget;
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !focused.isConnected) return null;
  return dom.profileMenu.contains(focused) ? dom.profileTrigger : focused;
}

function focusDialog(dialog, preferredFocus = null) {
  window.requestAnimationFrame(() => {
    if (dialog.hidden) return;
    const focusTarget = preferredFocus || getFocusableElements(dialog)[0] || dialog;
    focusTarget.focus({ preventScroll: true });
  });
}

function restoreDialogFocus(target) {
  if (!(target instanceof HTMLElement) || !target.isConnected || target.closest("[hidden]")) return;
  target.focus({ preventScroll: true });
}

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    return element instanceof HTMLElement && !element.closest("[hidden]");
  });
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
