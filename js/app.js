"use strict";

/*
  Health Ledger — app.js (application module)
  ---------------------------------------------------------------------------
  This is the only module that binds DOM events and reacts to Firebase
  auth-state changes. Every other module is a dependency of this one; no
  module imports from app.js, so the dependency graph flows strictly inward.

  Responsibilities kept here on purpose:
    - DOM reference caching (delegated to dom.js, called once on load)
    - Event binding for every interactive element
    - The onAuthStateChanged callback and its branching logic
    - Form-submit handlers that combine state.js + db.js + ui.js calls
    - Modal / menu open-close glue
    - Offline preview activation flow
*/

import { dom, cacheDomReferences } from "./dom.js";
import {
  appState,
  getExistingDailyLog,
  clearUserDataState,
  clearPendingGoogleLink,
} from "./state.js";

import {
  watchAuthState,
  initializeEmailService,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  performSignOut,
  reauthenticateUser,
  deleteAuthUser,
  updateUserProfile,
  fetchEmailSignInMethods,
  linkUserWithCredential,
  getGoogleCredentialFromError,
  sendWelcomeEmail,
  sendGoodbyeEmail,
  sendPasswordResetLink,
} from "./auth.js";

import {
  hydrateUserWorkspace,
  saveDailyLog,
  saveWorkoutLog,
  saveUserSettings,
  importWorkspaceBackup,
  importDailyLogs,
  deleteDailyLog,
  deleteWorkoutLog,
  ensureUserProfile,
  deleteUserWorkspace,
  readOfflinePreviewWorkspace,
  persistOfflinePreviewWorkspace,
} from "./db.js";

import {
  setSessionState,
  setLoadingState,
  setAppLocked,
  setAuthFeedback,
  setAuthFieldErrors,
  setAuthPending,
  showStatusMessage,
  clearStatusMessage,
  setButtonLoading,
  setDailyQuote,
  configureOfflinePreviewUi,
  setProfileMenuOpen,
  openUtilityModal,
  closeUtilityModal,
  requestConfirmation,
  settleConfirmation,
  closeTransientUi,
  getActiveViewName,
  handleDialogFocusTrap,
} from "./ui.js";

import { renderDashboard, clearDashboardPanels, setDashboardHydrationState } from "./dashboard.js";
import {
  renderHistoryTables,
  renderStorageStatus,
  handleBackupExport,
  applyHistoryFiltersFromControls,
  clearHistoryFilters,
  loadMoreHistory,
} from "./history.js";
import { destroyAllCharts } from "./charts.js";
import { registerServiceWorker } from "./pwa.js";

import {
  seedFormDates,
  populateDailyFormForDate,
  updateNutritionPreview,
  updateMacroInputMode,
  resetWorkoutForm,
  populateWorkoutForm,
  populateExerciseNameSuggestions,
  addExerciseCard,
  collectExercisesFromForm,
  populateSettingsForm,
  populateAccountForm,
} from "./forms.js";

import {
  toNumberOrNull,
  buildMacroPayloadFromInputs,
  roundToOneDecimal,
  formatFirebaseError,
  formatMaybeNumber,
  createEmptyDailyLog,
  parseLegacyCsv,
  getLocalDateString,
  normalizeEmail,
  getCurrentWeekKey,
  buildOfflinePreviewUser,
  shouldOfferOfflinePreview,
  getFriendlyUserName,
} from "./utils.js";

import {
  OFFLINE_PREVIEW_STORAGE_KEY,
  isFirebaseConfigured,
  isEmailJsConfigured,
} from "./config.js";

let authChangeSequence = 0;

/*
  ---------------------------------------------------------------------------
  Bootstrap
  ---------------------------------------------------------------------------
*/

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeInterface, { once: true });
} else {
  initializeInterface();
}

function initializeInterface() {
  cacheDomReferences();
  registerServiceWorker();
  initializeEmailService();
  bindEvents();
  seedFormDates();
  updateMacroInputMode();
  resetWorkoutForm();
  setDailyQuote();
  configureOfflinePreviewUi();
  setAppLocked(true);
  renderSignedOutState();
  if (!isFirebaseConfigured()) {
    setAuthFeedback(
      "Cloud sign-in is not configured. Add your Firebase web app values to the runtime configuration, or use offline preview.",
      "error",
    );
  }

  watchAuthState(async (user) => {
    const sequence = ++authChangeSequence;
    await handleAuthStateChange(user, sequence);
  });
}

function bindEvents() {
  dom.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      refreshCurrentView(button.dataset.view);
    });
  });

  dom.dashboardWeekSelect.addEventListener("change", (event) => {
    appState.selectedWeekKey = event.target.value;
    renderDashboard();
  });

  dom.dailyForm.addEventListener("submit", handleDailyLogSubmit);
  dom.dailyForm.addEventListener("input", updateNutritionPreview);
  dom.dailyForm.elements.macroMode.addEventListener("change", () => {
    updateMacroInputMode();
    updateNutritionPreview();
  });
  dom.dailyForm.elements.date.addEventListener("change", () => {
    populateDailyFormForDate(dom.dailyForm.elements.date.value);
  });
  dom.quickWaterButton.addEventListener("click", handleQuickWaterAdd);

  dom.workoutForm.addEventListener("submit", handleWorkoutLogSubmit);
  dom.settingsForm.addEventListener("submit", handleSettingsSubmit);
  dom.csvImport.addEventListener("change", handleCsvImport);
  dom.importBackupButton.addEventListener("click", () => dom.backupImport.click());
  dom.backupImport.addEventListener("change", handleBackupImport);
  dom.exportBackupButton.addEventListener("click", handleBackupExport);
  dom.addExerciseButton.addEventListener("click", () => addExerciseCard());
  dom.repeatLastWorkoutButton.addEventListener("click", handleRepeatLastWorkout);
  [dom.historyDateFrom, dom.historyDateTo].forEach((input) => {
    input.addEventListener("change", applyHistoryFiltersFromControls);
  });
  dom.historySearch.addEventListener("input", applyHistoryFiltersFromControls);
  dom.clearHistoryFiltersButton.addEventListener("click", clearHistoryFilters);
  dom.dailyHistoryLoadMore.addEventListener("click", () => loadMoreHistory("daily"));
  dom.workoutHistoryLoadMore.addEventListener("click", () => loadMoreHistory("workout"));

  dom.googleSigninButton.addEventListener("click", handleGoogleSignIn);
  dom.authForm.addEventListener("submit", handleEmailSignIn);
  dom.emailSignupButton.addEventListener("click", handleEmailSignUp);
  dom.passwordResetButton.addEventListener("click", handlePasswordReset);
  dom.passwordVisibilityButton.addEventListener("click", togglePasswordVisibility);
  dom.offlinePreviewButton.addEventListener("click", handleOfflinePreviewStart);
  dom.profileAvatarImage.addEventListener("error", () => {
    dom.profileAvatarImage.hidden = true;
    dom.profileAvatarImage.removeAttribute("src");
    dom.profileAvatarFallback.hidden = false;
  });

  dom.profileTrigger.addEventListener("click", handleProfileTriggerClick);
  dom.accountMenuButton.addEventListener("click", openAccountModal);
  dom.preferencesMenuButton.addEventListener("click", openPreferencesModal);
  dom.logoutMenuButton.addEventListener("click", openLogoutModal);

  dom.accountForm.addEventListener("submit", handleAccountSubmit);
  dom.accountModalClose.addEventListener("click", () => closeUtilityModal(dom.accountModal));
  dom.accountModalCancel.addEventListener("click", () => closeUtilityModal(dom.accountModal));
  dom.accountDeleteButton.addEventListener("click", handleAccountDelete);

  dom.preferencesModalClose.addEventListener("click", () =>
    closeUtilityModal(dom.preferencesModal),
  );
  dom.preferencesModalCancel.addEventListener("click", () =>
    closeUtilityModal(dom.preferencesModal),
  );

  dom.logoutCancelButton.addEventListener("click", () => closeUtilityModal(dom.logoutModal));
  dom.logoutConfirmButton.addEventListener("click", handleLogoutConfirm);

  dom.confirmationCancelButton.addEventListener("click", () => settleConfirmation(false));
  dom.confirmationConfirmButton.addEventListener("click", () => settleConfirmation(true));

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDialogFocusTrap);
  document.addEventListener("keydown", handleGlobalKeydown);
}

/*
  ---------------------------------------------------------------------------
  Firebase auth-state callback
  ---------------------------------------------------------------------------
*/

async function handleAuthStateChange(user, sequence) {
  if (appState.previewMode) return;

  const hadUser = Boolean(appState.currentUser);
  clearStatusMessage();
  setAuthPending(false);

  if (!user) {
    setDashboardHydrationState(false);
    appState.currentUser = null;
    clearPendingGoogleLink();
    clearUserDataState();
    renderSignedOutState();
    setSessionState(null);
    setLoadingState(false);
    setAppLocked(true);
    if (isFirebaseConfigured()) {
      setAuthFeedback("Sign in to load your private dashboard and cloud data.");
    } else {
      setAuthFeedback(
        "Cloud sign-in is not configured. Add your Firebase web app values to the runtime configuration, or use offline preview.",
        "error",
      );
    }
    dom.authForm.reset();
    setAuthFieldErrors();
    dom.authPassword.type = "password";
    dom.passwordVisibilityButton.textContent = "Show";
    dom.passwordVisibilityButton.setAttribute("aria-pressed", "false");
    dom.passwordVisibilityButton.setAttribute("aria-label", "Show password");
    if (hadUser) {
      showStatusMessage("You signed out of Health Ledger.");
    }
    return;
  }

  appState.currentUser = user;
  clearPendingGoogleLink();
  setSessionState(user);
  setAppLocked(false);
  setAuthFeedback("");
  setLoadingState(
    true,
    `Loading ${getFriendlyUserName(user)}'s dashboard...`,
    `Welcome, ${getFriendlyUserName(user)}`,
  );
  setDashboardHydrationState(true);

  try {
    await ensureUserProfile(user);
    const applied = await hydrateUserWorkspace(user.uid, {
      shouldApply: () => sequence === authChangeSequence && !appState.previewMode,
    });
    if (!applied) return;
    dom.authForm.reset();
    syncWorkspaceUiFromState();
  } catch (error) {
    if (sequence !== authChangeSequence || appState.previewMode) return;
    console.error(error);

    // Sign out so a retry actually re-fires onAuthStateChanged. Without this,
    // signing back in as the same user is a no-op and the app stays locked
    // until a manual reload. The signOut recursion clears local state as a
    // side effect; the calls after it override the default null-user copy.
    if (isFirebaseConfigured()) {
      try {
        await performSignOut();
      } catch (signOutError) {
        console.error(signOutError);
      }
    }

    appState.currentUser = null;
    clearUserDataState();
    renderSignedOutState();
    setSessionState(null);
    setAppLocked(true);
    setAuthFeedback("We couldn't load your data right now. Please try signing in again.", "error");
    showStatusMessage(
      "Unable to load your Firestore data. Check Firebase Auth, Firestore, and security rules.",
      true,
    );
  } finally {
    setDashboardHydrationState(false);
    setLoadingState(false);
  }
}

/*
  ---------------------------------------------------------------------------
  Sign-in / sign-up handlers
  ---------------------------------------------------------------------------
*/

async function handleGoogleSignIn() {
  if (shouldOfferOfflinePreview()) {
    setAuthFeedback(
      "Firebase sign-in is unavailable from a local file or while offline. Serve the app and reconnect, or continue in offline preview mode.",
      "error",
    );
    return;
  }

  setAuthFeedback("");
  setAuthPending(true);

  try {
    const { user, isNewUser } = await signInWithGoogle();

    if (isNewUser) {
      await sendWelcomeEmailBestEffort(user);
    }

    setAuthFeedback("Google sign-in worked. Pulling your data now...", "success");
  } catch (error) {
    console.error(error);
    if (error.code === "auth/account-exists-with-different-credential") {
      const pendingCredential = getGoogleCredentialFromError(error);
      const email = error.customData?.email || "";

      if (pendingCredential && email) {
        let methods = [];

        try {
          methods = await fetchEmailSignInMethods(email);
        } catch (linkingLookupError) {
          console.error(linkingLookupError);
        }

        appState.pendingGoogleCredential = pendingCredential;
        appState.pendingLinkEmail = email;
        dom.authEmail.value = email;

        if (methods.includes("password")) {
          setAuthFeedback(
            "This email already uses a password login. Sign in below once to link Google to the same Health Ledger account.",
            "error",
          );
          return;
        }

        setAuthFeedback(
          "This email already exists with another sign-in method. Use that method first, then Google can be linked to the same profile.",
          "error",
        );
        return;
      }
    }

    setAuthFeedback(formatFirebaseError(error), "error");
  } finally {
    setAuthPending(false);
  }
}

async function handleEmailSignIn(event) {
  event.preventDefault();
  await submitEmailAuth("signin");
}

async function handleEmailSignUp() {
  await submitEmailAuth("signup");
}

async function submitEmailAuth(mode) {
  if (shouldOfferOfflinePreview()) {
    setAuthFeedback(
      "Email sign-in is unavailable from a local file or while offline. Serve the app and reconnect, or continue in offline preview mode.",
      "error",
    );
    return;
  }

  const email = normalizeEmail(dom.authEmail.value);
  const password = dom.authPassword.value;

  const fieldErrors = {
    email: !email
      ? "Enter an email address."
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ? "Enter a valid email address."
        : "",
    password: !password
      ? "Enter your password."
      : password.length < 6
        ? "Passwords must be at least 6 characters."
        : "",
  };
  setAuthFieldErrors(fieldErrors);
  if (fieldErrors.email || fieldErrors.password) {
    setAuthFeedback("Check the highlighted email and password fields.", "error");
    return;
  }

  setAuthFeedback("");
  setAuthPending(true);

  try {
    if (mode === "signup") {
      const user = await signUpWithEmail(email, password);
      await sendWelcomeEmailBestEffort(user);
      setAuthFeedback("Account created. Loading your new workspace...", "success");
    } else {
      const user = await signInWithEmail(email, password);
      await linkPendingGoogleCredential(user);
      setAuthFeedback("Signed in. Loading your workspace...", "success");
    }
  } catch (error) {
    console.error(error);
    setAuthFeedback(formatFirebaseError(error), "error");
  } finally {
    setAuthPending(false);
  }
}

async function handlePasswordReset() {
  if (shouldOfferOfflinePreview() || !isFirebaseConfigured()) {
    setAuthFeedback(
      "Password reset needs a configured Firebase app on a served HTTPS or localhost origin.",
      "error",
    );
    return;
  }

  const email = normalizeEmail(dom.authEmail.value);
  const emailError = !email
    ? "Enter the email address for the account you want to reset."
    : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? "Enter a valid email address."
      : "";
  setAuthFieldErrors({ email: emailError });
  if (emailError) {
    setAuthFeedback("Enter your account email to request a reset link.", "error");
    dom.authEmail.focus();
    return;
  }

  setAuthFeedback("");
  setButtonLoading(dom.passwordResetButton, true);
  try {
    await sendPasswordResetLink(email);
    setAuthFeedback(
      "If an account exists for that address, Firebase has sent a password-reset link.",
      "success",
    );
  } catch (error) {
    console.error(error);
    setAuthFeedback(formatFirebaseError(error), "error");
  } finally {
    setButtonLoading(dom.passwordResetButton, false);
  }
}

function togglePasswordVisibility() {
  const isHidden = dom.authPassword.type === "password";
  dom.authPassword.type = isHidden ? "text" : "password";
  dom.passwordVisibilityButton.textContent = isHidden ? "Hide" : "Show";
  dom.passwordVisibilityButton.setAttribute("aria-pressed", String(isHidden));
  dom.passwordVisibilityButton.setAttribute(
    "aria-label",
    isHidden ? "Hide password" : "Show password",
  );
  dom.authPassword.focus();
}

async function handleLogoutConfirm() {
  closeUtilityModal(dom.logoutModal);

  if (appState.previewMode) {
    appState.previewMode = false;
    appState.currentUser = null;
    clearUserDataState();
    renderSignedOutState();
    setSessionState(null);
    setAppLocked(true);
    showStatusMessage("Offline preview closed.");
    return;
  }

  setLoadingState(true, "Signing you out...");

  try {
    await performSignOut();
  } catch (error) {
    console.error(error);
    setLoadingState(false);
    showStatusMessage(formatFirebaseError(error), true);
  }
}

async function sendWelcomeEmailBestEffort(user) {
  if (!isEmailJsConfigured()) return;

  try {
    await sendWelcomeEmail(user);
  } catch (error) {
    console.error(error);
    showStatusMessage(
      "Your account is ready, but the welcome email could not be sent. Check the EmailJS runtime configuration.",
      true,
    );
  }
}

/*
  ---------------------------------------------------------------------------
  View management
  ---------------------------------------------------------------------------
*/

function refreshCurrentView(viewName = "dashboard") {
  dom.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
    if (button.dataset.view === viewName) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  dom.views.forEach((view) => {
    view.classList.toggle("active", view.id === `${viewName}-view`);
  });

  destroyAllCharts();

  if (viewName === "dashboard") {
    renderDashboard();
  } else if (viewName === "history") {
    populateSettingsForm();
    renderHistoryTables();
    renderStorageStatus();
  }
}

/*
  ---------------------------------------------------------------------------
  Daily log + quick water
  ---------------------------------------------------------------------------
*/

async function handleDailyLogSubmit(event) {
  event.preventDefault();

  if (!appState.currentUser) {
    showStatusMessage("Sign in before saving a daily log.", true);
    setAppLocked(true);
    return;
  }

  const enteredCalories = toNumberOrNull(dom.dailyForm.elements.calories.value);
  const protein = toNumberOrNull(dom.dailyForm.elements.protein.value);
  const carbPercent = toNumberOrNull(dom.dailyForm.elements.carbPercent.value);
  const fatPercent = toNumberOrNull(dom.dailyForm.elements.fatPercent.value);
  const macroMode = dom.dailyForm.elements.macroMode.value;

  const macroPayload = buildMacroPayloadFromInputs(
    enteredCalories,
    protein,
    carbPercent,
    fatPercent,
    macroMode,
  );
  if (macroPayload.error) {
    showStatusMessage(macroPayload.error, true);
    return;
  }

  const calories = macroPayload.calories;
  if (macroPayload.autoCalculatedCalories) {
    dom.dailyForm.elements.calories.value = Math.round(calories);
  }

  const dailyLog = {
    date: dom.dailyForm.elements.date.value,
    weight: toNumberOrNull(dom.dailyForm.elements.weight.value),
    calories,
    macros: macroPayload.macros,
    macroPercentages: macroPayload.macroPercentages,
    steps: toNumberOrNull(dom.dailyForm.elements.steps.value),
    sleep: toNumberOrNull(dom.dailyForm.elements.sleep.value),
    water: {
      glasses: toNumberOrNull(dom.dailyForm.elements.waterGlasses.value),
      targetGlasses: toNumberOrNull(dom.dailyForm.elements.waterTargetGlasses.value),
      unitAmountMl: toNumberOrNull(dom.dailyForm.elements.waterUnitAmountMl.value),
    },
    energy: toNumberOrNull(dom.dailyForm.elements.energy.value),
    notes: dom.dailyForm.elements.notes.value.trim(),
  };

  const saveButton = event.submitter || dom.dailyForm.querySelector('button[type="submit"]');
  setButtonLoading(saveButton, true);

  try {
    // The form is fully populated from the existing log, so it is the
    // complete record for this date — replace so cleared fields actually clear.
    await saveDailyLog(dailyLog, { replace: true });
    renderHistoryTables();
    renderStorageStatus();
    showStatusMessage(`Saved daily log for ${dailyLog.date}.`);
    refreshCurrentView(getActiveViewName());
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    setButtonLoading(saveButton, false);
  }
}

async function handleQuickWaterAdd() {
  if (!appState.currentUser) {
    showStatusMessage("Sign in before adding water.", true);
    setAppLocked(true);
    return;
  }

  const today = getLocalDateString();
  const existingLog = getExistingDailyLog(today) || createEmptyDailyLog(today);
  const settings = appState.userSettings;
  const currentGlasses = toNumberOrNull(existingLog.water?.glasses) ?? 0;
  const targetGlasses =
    toNumberOrNull(existingLog.water?.targetGlasses) ?? settings.waterTargetGlasses;
  const unitAmountMl =
    toNumberOrNull(existingLog.water?.unitAmountMl) ?? settings.waterUnitAmountMl;

  setButtonLoading(dom.quickWaterButton, true);

  try {
    const savedLog = await saveDailyLog({
      date: today,
      water: {
        glasses: roundToOneDecimal(currentGlasses + 1),
        targetGlasses,
        unitAmountMl,
      },
    });

    if (dom.dailyForm.elements.date.value === today) {
      populateDailyFormForDate(today);
    }

    renderHistoryTables();
    renderStorageStatus();
    renderDashboard();
    showStatusMessage(
      `Added 1 glass of water. Today is now ${formatMaybeNumber(savedLog.water.glasses)} / ${formatMaybeNumber(targetGlasses)} glasses.`,
    );
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    setButtonLoading(dom.quickWaterButton, false);
  }
}

/*
  ---------------------------------------------------------------------------
  Workout log
  ---------------------------------------------------------------------------
*/

async function handleWorkoutLogSubmit(event) {
  event.preventDefault();

  if (!appState.currentUser) {
    showStatusMessage("Sign in before saving a workout.", true);
    setAppLocked(true);
    return;
  }

  const exercises = collectExercisesFromForm();
  if (exercises.length === 0) {
    showStatusMessage("Add at least one exercise before saving a workout.", true);
    return;
  }

  const workoutLog = {
    id: dom.workoutForm.dataset.editingWorkoutId || "",
    date: dom.workoutForm.elements.date.value,
    session_type: dom.workoutForm.elements.session_type.value.trim(),
    duration: toNumberOrNull(dom.workoutForm.elements.duration.value),
    exercises,
  };

  const saveButton = event.submitter || dom.workoutForm.querySelector('button[type="submit"]');
  setButtonLoading(saveButton, true);

  try {
    const savedWorkout = await saveWorkoutLog(workoutLog);
    populateExerciseNameSuggestions(appState.workoutLogs);
    dom.repeatLastWorkoutButton.disabled = false;
    renderHistoryTables();
    renderStorageStatus();
    showStatusMessage(
      workoutLog.id
        ? `Updated workout log for ${savedWorkout.date}.`
        : `Saved workout log for ${savedWorkout.date}.`,
    );
    resetWorkoutForm();
    refreshCurrentView(getActiveViewName());
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    setButtonLoading(saveButton, false);
  }
}

function handleRepeatLastWorkout() {
  if (!appState.currentUser) {
    showStatusMessage("Sign in before repeating a workout.", true);
    setAppLocked(true);
    return;
  }

  const lastWorkout = appState.workoutLogs.at(-1);
  if (!lastWorkout) {
    showStatusMessage("Save a workout first, then you can repeat it here.", true);
    return;
  }

  refreshCurrentView("entry");
  populateWorkoutForm(lastWorkout, { isRepeat: true });
  requestAnimationFrame(() => dom.workoutForm.elements.session_type.focus());
  showStatusMessage(`Loaded your ${lastWorkout.date} session as a new workout for today.`);
}

/*
  ---------------------------------------------------------------------------
  Settings
  ---------------------------------------------------------------------------
*/

async function handleSettingsSubmit(event) {
  event.preventDefault();

  if (!appState.currentUser) {
    showStatusMessage("Sign in before saving settings.", true);
    setAppLocked(true);
    return;
  }

  const calorieTarget = Number(dom.settingsForm.elements.calorieTarget.value);
  const proteinGramTarget = Number(dom.settingsForm.elements.proteinGramTarget.value);
  const protein = Number(dom.settingsForm.elements.proteinTarget.value);
  const carbs = Number(dom.settingsForm.elements.carbsTarget.value);
  const fat = Number(dom.settingsForm.elements.fatTarget.value);
  const waterTargetGlasses = Number(dom.settingsForm.elements.waterTargetGlasses.value);
  const waterUnitAmountMl = Number(dom.settingsForm.elements.waterUnitAmountMl.value);

  if (protein + carbs + fat !== 100) {
    showStatusMessage("Macro targets must add up to exactly 100%.", true);
    return;
  }

  const saveButton = event.submitter || dom.settingsForm.querySelector('button[type="submit"]');
  setButtonLoading(saveButton, true);

  try {
    await saveUserSettings({
      calorieTarget,
      proteinGramTarget,
      macroTarget: { protein, carbs, fat },
      waterTargetGlasses,
      waterUnitAmountMl,
    });

    if (!getExistingDailyLog(dom.dailyForm.elements.date.value)) {
      populateDailyFormForDate(dom.dailyForm.elements.date.value);
    }

    renderStorageStatus();
    showStatusMessage("Saved settings and refreshed your weekly targets.");
    closeUtilityModal(dom.preferencesModal);
    refreshCurrentView(getActiveViewName());
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    setButtonLoading(saveButton, false);
  }
}

/*
  ---------------------------------------------------------------------------
  Account: edit + delete
  ---------------------------------------------------------------------------
*/

async function handleAccountSubmit(event) {
  event.preventDefault();

  if (!appState.currentUser) {
    showStatusMessage("Sign in before editing your account.", true);
    setAppLocked(true);
    return;
  }

  const displayName = dom.accountForm.elements.displayName.value.trim();
  const photoURL = dom.accountForm.elements.photoURL.value.trim();

  const saveButton = event.submitter || dom.accountForm.querySelector('button[type="submit"]');
  setButtonLoading(saveButton, true);

  try {
    if (appState.previewMode) {
      const previousUser = appState.currentUser;
      appState.currentUser = {
        ...appState.currentUser,
        displayName: displayName || "Offline Preview",
        photoURL: photoURL || "",
      };
      try {
        persistOfflinePreviewWorkspace();
      } catch (persistError) {
        appState.currentUser = previousUser;
        throw persistError;
      }
      setSessionState(appState.currentUser);
      refreshCurrentView(getActiveViewName());
      closeUtilityModal(dom.accountModal);
      showStatusMessage("Your offline preview profile has been updated.");
      return;
    }

    const updatedUser = await updateUserProfile(displayName, photoURL);

    appState.currentUser = updatedUser;
    await ensureUserProfile(updatedUser);
    setSessionState(updatedUser);
    refreshCurrentView(getActiveViewName());
    closeUtilityModal(dom.accountModal);
    showStatusMessage("Your account profile has been updated.");
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    setButtonLoading(saveButton, false);
  }
}

async function handleAccountDelete() {
  if (!appState.currentUser) {
    showStatusMessage("Sign in before deleting your account.", true);
    setAppLocked(true);
    return;
  }

  const confirmed = await requestConfirmation({
    eyebrow: "Delete account",
    title: "Delete your Health Ledger account?",
    message:
      "This permanently removes your profile, daily logs, workouts, and saved targets. This cannot be undone.",
    confirmLabel: "Delete account",
    danger: true,
  });

  if (!confirmed) {
    return;
  }

  setLoadingState(
    true,
    "Permanently wiping your cloud data and finalizing profile changes...",
    "Deleting your account",
  );

  try {
    if (appState.previewMode) {
      localStorage.removeItem(OFFLINE_PREVIEW_STORAGE_KEY);
      appState.previewMode = false;
      appState.currentUser = null;
      clearUserDataState();
      renderSignedOutState();
      setSessionState(null);
      setAppLocked(true);
      showStatusMessage("Offline preview account data has been deleted.");
      return;
    }

    const user = appState.currentUser;
    if (!user) {
      throw new Error("Your session ended. Sign in again before deleting the account.");
    }

    await reauthenticateUser(user, dom.accountDeletePassword.value);

    if (isEmailJsConfigured()) {
      try {
        await sendGoodbyeEmail(user);
      } catch (emailError) {
        console.error(emailError);
        showStatusMessage(
          "Account deletion will continue, but the goodbye email could not be sent. Check the EmailJS runtime configuration.",
          true,
        );
      }
    }

    await deleteUserWorkspace(user.uid);
    await deleteAuthUser(user);

    appState.currentUser = null;
    clearUserDataState();
    renderSignedOutState();
    setSessionState(null);
    setAppLocked(true);
    setAuthFeedback(
      "Your Health Ledger account was deleted. You can sign in again with another account.",
    );
    showStatusMessage("Your Health Ledger account and stored data have been deleted.");
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    setLoadingState(false);
  }
}

/*
  ---------------------------------------------------------------------------
  CSV import
  ---------------------------------------------------------------------------
*/

async function handleCsvImport(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  if (!appState.currentUser) {
    showStatusMessage("Sign in before importing legacy data.", true);
    event.target.value = "";
    setAppLocked(true);
    return;
  }

  try {
    setButtonLoading(dom.csvImport, true);
    const csvText = await file.text();
    const importedLogs = parseLegacyCsv(csvText);
    const result = await importDailyLogs(importedLogs);

    renderHistoryTables();
    renderStorageStatus();
    refreshCurrentView(getActiveViewName());
    const duplicateNote = result.duplicateRows
      ? ` Consolidated ${result.duplicateRows} duplicate date row(s) in source order.`
      : "";
    showStatusMessage(
      `Imported ${result.dailyImported} daily log(s) from ${file.name}.${duplicateNote}`,
    );
  } catch (error) {
    console.error(error);
    showStatusMessage(describeImportFailure(error, "Unable to import that CSV file."), true);
  } finally {
    setButtonLoading(dom.csvImport, false);
    event.target.value = "";
  }
}

async function handleBackupImport(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  if (!appState.currentUser) {
    showStatusMessage("Sign in before importing a backup.", true);
    event.target.value = "";
    setAppLocked(true);
    return;
  }

  const confirmed = await requestConfirmation({
    eyebrow: "Restore backup",
    title: "Import this backup into this workspace?",
    message:
      "Daily logs will merge by date, duplicate workouts will be skipped, and saved targets will be restored.",
    confirmLabel: "Import backup",
  });

  if (!confirmed) {
    event.target.value = "";
    return;
  }

  try {
    setButtonLoading(dom.importBackupButton, true);
    const backupText = await file.text();
    const backupPayload = JSON.parse(backupText);
    const result = await importWorkspaceBackup(backupPayload);

    renderHistoryTables();
    renderStorageStatus();
    refreshCurrentView(getActiveViewName());
    showStatusMessage(
      `Backup import complete. Added ${result.dailyImported} daily log(s), ${result.workoutImported} workout(s), and skipped ${result.workoutSkipped} duplicate workout(s).`,
    );
  } catch (error) {
    console.error(error);
    showStatusMessage(describeImportFailure(error, "Unable to import that backup file."), true);
  } finally {
    setButtonLoading(dom.importBackupButton, false);
    event.target.value = "";
  }
}

/*
  ---------------------------------------------------------------------------
  Profile menu + modal glue
  ---------------------------------------------------------------------------
*/

function handleProfileTriggerClick(event) {
  event.stopPropagation();
  const isOpen = dom.profileTrigger.getAttribute("aria-expanded") === "true";
  setProfileMenuOpen(!isOpen);
}

function handleDocumentClick(event) {
  const historyAction = event.target.closest?.("[data-history-action]");
  if (historyAction) {
    void handleHistoryAction(historyAction);
    return;
  }

  const dashboardAction = event.target.closest("[data-open-dashboard-view]");
  if (dashboardAction) {
    refreshCurrentView(dashboardAction.dataset.openDashboardView);
    return;
  }

  if (
    !dom.profileShell.hidden &&
    !dom.profileShell.contains(event.target) &&
    dom.profileTrigger.getAttribute("aria-expanded") === "true"
  ) {
    setProfileMenuOpen(false);
  }
}

async function handleHistoryAction(button) {
  if (!appState.currentUser) {
    showStatusMessage("Sign in before changing history.", true);
    setAppLocked(true);
    return;
  }

  const action = button.dataset.historyAction;
  const date = button.dataset.logDate;
  const workoutId = button.dataset.logId;

  if (action === "edit-daily" && date) {
    refreshCurrentView("entry");
    populateDailyFormForDate(date);
    requestAnimationFrame(() => dom.dailyForm.elements.weight.focus());
    showStatusMessage(`Loaded ${date} into Data Entry. Save to keep your changes.`);
    return;
  }

  if (action === "edit-workout" && workoutId) {
    const workout = appState.workoutLogs.find((log) => log.id === workoutId);
    if (!workout) {
      showStatusMessage(
        "That workout is no longer in the current workspace. Reload history and try again.",
        true,
      );
      return;
    }
    refreshCurrentView("entry");
    populateWorkoutForm(workout);
    requestAnimationFrame(() => dom.workoutForm.elements.session_type.focus());
    showStatusMessage(`Loaded the ${workout.date} workout. Save changes to update that session.`);
    return;
  }

  const isDailyDelete = action === "delete-daily" && date;
  const isWorkoutDelete = action === "delete-workout" && workoutId;
  if (!isDailyDelete && !isWorkoutDelete) return;

  const confirmed = await requestConfirmation({
    eyebrow: "Delete entry",
    title: isDailyDelete ? `Delete the daily log for ${date}?` : "Delete this workout log?",
    message: isDailyDelete
      ? "This removes the selected day from your history and charts. This cannot be undone."
      : "This removes the selected workout session from your history and charts. This cannot be undone.",
    confirmLabel: "Delete entry",
    danger: true,
  });
  if (!confirmed) return;

  setButtonLoading(button, true);
  try {
    const deleted = isDailyDelete ? await deleteDailyLog(date) : await deleteWorkoutLog(workoutId);
    if (!deleted) {
      showStatusMessage("That entry was already removed.");
      return;
    }

    if (isDailyDelete && dom.dailyForm.elements.date.value === date) {
      populateDailyFormForDate(date);
    }
    if (isWorkoutDelete && dom.workoutForm.dataset.editingWorkoutId === workoutId) {
      resetWorkoutForm();
    }
    if (isWorkoutDelete) {
      populateExerciseNameSuggestions(appState.workoutLogs);
      dom.repeatLastWorkoutButton.disabled = appState.workoutLogs.length === 0;
    }

    renderHistoryTables();
    renderStorageStatus();
    refreshCurrentView(getActiveViewName());
    showStatusMessage(
      isDailyDelete ? `Deleted the daily log for ${date}.` : "Deleted the workout log.",
    );
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    setButtonLoading(button, false);
  }
}

function handleGlobalKeydown(event) {
  if (event.key !== "Escape") {
    return;
  }

  if (!dom.confirmationModal.hidden) {
    settleConfirmation(false);
    return;
  }

  if (!dom.logoutModal.hidden) {
    closeUtilityModal(dom.logoutModal);
    return;
  }

  if (!dom.preferencesModal.hidden) {
    closeUtilityModal(dom.preferencesModal);
    return;
  }

  if (!dom.accountModal.hidden) {
    closeUtilityModal(dom.accountModal);
    return;
  }

  if (dom.profileTrigger.getAttribute("aria-expanded") === "true") {
    setProfileMenuOpen(false);
  }
}

function openAccountModal() {
  populateAccountForm();
  openUtilityModal(dom.accountModal);
}

function openPreferencesModal() {
  populateSettingsForm();
  openUtilityModal(dom.preferencesModal);
}

function openLogoutModal() {
  openUtilityModal(dom.logoutModal);
}

/*
  ---------------------------------------------------------------------------
  Google ⇄ email account linking
  ---------------------------------------------------------------------------
*/

async function linkPendingGoogleCredential(user) {
  if (!appState.pendingGoogleCredential) {
    return;
  }

  const normalizedPendingEmail = normalizeEmail(appState.pendingLinkEmail);
  if (normalizedPendingEmail && normalizeEmail(user.email) !== normalizedPendingEmail) {
    return;
  }

  try {
    await linkUserWithCredential(user, appState.pendingGoogleCredential);
    clearPendingGoogleLink();
    setAuthFeedback(
      "Google has been linked to this account. You can now use either sign-in method.",
      "success",
    );
  } catch (error) {
    if (
      error.code === "auth/provider-already-linked" ||
      error.code === "auth/credential-already-in-use"
    ) {
      clearPendingGoogleLink();
      setAuthFeedback(
        "Google is already linked to this account. You can use either sign-in method.",
        "success",
      );
      return;
    }

    throw error;
  }
}

/*
  ---------------------------------------------------------------------------
  Workspace sync helpers
  ---------------------------------------------------------------------------
*/

function syncWorkspaceUiFromState() {
  populateSettingsForm();
  populateExerciseNameSuggestions(appState.workoutLogs);
  dom.repeatLastWorkoutButton.disabled = appState.workoutLogs.length === 0;
  resetWorkoutForm();
  populateDailyFormForDate(getLocalDateString());
  renderHistoryTables();
  renderStorageStatus();
  refreshCurrentView(getActiveViewName());
}

function renderSignedOutState() {
  closeTransientUi();
  clearHistoryFilters();
  clearDashboardPanels(
    !isFirebaseConfigured()
      ? "Configure Firebase for cloud sync, or continue with offline preview mode."
      : shouldOfferOfflinePreview()
        ? "Serve the app and reconnect for Firebase sign-in, or continue with offline preview mode."
        : "Sign in to view your private dashboard and Firestore-backed trends.",
  );
  renderHistoryTables();
  renderStorageStatus();
  populateSettingsForm();
  seedFormDates();
  resetWorkoutForm();
  populateExerciseNameSuggestions([]);
  dom.repeatLastWorkoutButton.disabled = true;
  populateDailyFormForDate(getLocalDateString());
}

/*
  ---------------------------------------------------------------------------
  Offline preview
  ---------------------------------------------------------------------------
*/

async function handleOfflinePreviewStart() {
  // An in-flight cloud hydration must not overwrite the separate local workspace.
  authChangeSequence += 1;
  setAuthFeedback("");
  setLoadingState(true, "Opening offline preview...", "Local Preview Mode");
  setDashboardHydrationState(true);

  try {
    const previewState = readOfflinePreviewWorkspace();
    appState.previewMode = true;
    appState.currentUser = buildOfflinePreviewUser(previewState.profile);
    // readOfflinePreviewWorkspace already validates, normalizes, and sorts
    // this payload. Reusing it preserves the one canonical load contract.
    appState.userSettings = previewState.userSettings;
    appState.dailyLogs = previewState.dailyLogs;
    appState.workoutLogs = previewState.workoutLogs;
    appState.selectedWeekKey = getCurrentWeekKey();

    setSessionState(appState.currentUser);
    setAppLocked(false);
    syncWorkspaceUiFromState();
    showStatusMessage("Offline preview is active. Data will stay in this browser.");
  } catch (error) {
    console.error(error);
    showStatusMessage(error.message || "Unable to start offline preview in this browser.", true);
  } finally {
    setDashboardHydrationState(false);
    setLoadingState(false);
  }
}

function describeImportFailure(error, fallbackMessage) {
  if (!error?.importProgress) {
    return error?.message || fallbackMessage;
  }

  const { dailyImported = 0, workoutImported = 0, workoutSkipped = 0 } = error.importProgress;
  const savedParts = [`${dailyImported} daily log(s)`, `${workoutImported} workout(s)`];
  if (workoutSkipped) savedParts.push(`${workoutSkipped} duplicate workout(s) skipped`);
  return `${error.message} Saved before the failure: ${savedParts.join(", ")}.`;
}
