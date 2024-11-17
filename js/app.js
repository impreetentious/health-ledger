"use strict";

/*
  Health Ledger — app.js (entry point)
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
import { appState, getExistingDailyLog, clearUserDataState, clearPendingGoogleLink } from "./state.js";

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
} from "./auth.js";

import {
  hydrateUserWorkspace,
  saveDailyLog,
  saveWorkoutLog,
  saveUserSettings,
  importWorkspaceBackup,
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
  setAuthPending,
  showStatusMessage,
  clearStatusMessage,
  setDailyQuote,
  configureOfflinePreviewUi,
  setProfileMenuOpen,
  openUtilityModal,
  closeUtilityModal,
  closeTransientUi,
  getActiveViewName,
} from "./ui.js";

import { renderDashboard, clearDashboardPanels } from "./dashboard.js";
import { renderHistoryTables, renderStorageStatus, handleBackupExport } from "./history.js";
import { destroyAllCharts } from "./charts.js";

import {
  seedFormDates,
  populateDailyFormForDate,
  updateNutritionPreview,
  updateMacroInputMode,
  resetWorkoutForm,
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
  normalizeUserSettings,
  normalizeDailyLog,
  normalizeWorkoutLog,
  sortByDateAsc,
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

/*
  ---------------------------------------------------------------------------
  Bootstrap
  ---------------------------------------------------------------------------
*/

document.addEventListener("DOMContentLoaded", initializeInterface);

function initializeInterface() {
  cacheDomReferences();
  initializeEmailService();
  bindEvents();
  seedFormDates();
  updateMacroInputMode();
  resetWorkoutForm();
  setDailyQuote();
  configureOfflinePreviewUi();
  setAppLocked(true);
  renderSignedOutState();
  setLoadingState(true, "Checking your secure session...");

  if (!isFirebaseConfigured()) {
    setAuthFeedback(
      "Cloud sign-in is not configured in this public copy yet. Add your Firebase web app values in js/config.js, or use offline preview for local testing.",
      "error"
    );
  }

  watchAuthState(async (user) => {
    await handleAuthStateChange(user);
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

  dom.googleSigninButton.addEventListener("click", handleGoogleSignIn);
  dom.authForm.addEventListener("submit", handleEmailSignIn);
  dom.emailSignupButton.addEventListener("click", handleEmailSignUp);
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

  dom.preferencesModalClose.addEventListener("click", () => closeUtilityModal(dom.preferencesModal));
  dom.preferencesModalCancel.addEventListener("click", () => closeUtilityModal(dom.preferencesModal));

  dom.logoutCancelButton.addEventListener("click", () => closeUtilityModal(dom.logoutModal));
  dom.logoutConfirmButton.addEventListener("click", handleLogoutConfirm);

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleGlobalKeydown);
}

/*
  ---------------------------------------------------------------------------
  Firebase auth-state callback
  ---------------------------------------------------------------------------
*/

async function handleAuthStateChange(user) {
  if (appState.previewMode && !user) {
    setLoadingState(false);
    return;
  }

  const hadUser = Boolean(appState.currentUser);
  clearStatusMessage();
  setAuthPending(false);

  if (!user) {
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
        "Cloud sign-in is not configured in this public copy yet. Add your Firebase web app values in js/config.js, or use offline preview for local testing.",
        "error"
      );
    }
    dom.authForm.reset();
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
    `Welcome, ${getFriendlyUserName(user)}`
  );

  try {
    await ensureUserProfile(user);
    await hydrateUserWorkspace(user.uid);
    dom.authForm.reset();
    syncWorkspaceUiFromState();
  } catch (error) {
    console.error(error);
    clearUserDataState();
    renderSignedOutState();
    setAppLocked(true);
    setAuthFeedback("We couldn't load your data right now. Please try signing in again.", "error");
    showStatusMessage(
      "Unable to load your Firestore data. Check Firebase Auth, Firestore, and security rules.",
      true
    );
  } finally {
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
      "This local preview cannot reliably complete Firebase sign-in. Use a local server or continue in offline preview mode.",
      "error"
    );
    return;
  }

  setAuthFeedback("");
  setAuthPending(true);

  try {
    const { user, isNewUser } = await signInWithGoogle();

    if (isNewUser) {
      await sendWelcomeEmailWithLoader(user);
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
            "error"
          );
          return;
        }

        setAuthFeedback(
          "This email already exists with another sign-in method. Use that method first, then Google can be linked to the same profile.",
          "error"
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
      "Email sign-in needs a served web app. Use a local server or continue in offline preview mode here.",
      "error"
    );
    return;
  }

  const email = dom.authEmail.value.trim();
  const password = dom.authPassword.value;

  if (!email || !password) {
    setAuthFeedback("Enter both an email address and password.", "error");
    return;
  }

  setAuthFeedback("");
  setAuthPending(true);

  try {
    if (mode === "signup") {
      const user = await signUpWithEmail(email, password);
      await sendWelcomeEmailWithLoader(user);
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

async function sendWelcomeEmailWithLoader(user) {
  if (!isEmailJsConfigured()) return;

  setLoadingState(true, "Sending your welcome email...", "Creating your workspace");

  try {
    await sendWelcomeEmail(user);
  } catch (error) {
    console.error(error);
    showStatusMessage(
      "Your account is ready, but the welcome email could not be sent. Check EmailJS setup in js/config.js.",
      true
    );
  } finally {
    setLoadingState(false);
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
    macroMode
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

  setLoadingState(true, `Saving daily log for ${dailyLog.date}...`);

  try {
    await saveDailyLog(dailyLog);
    renderHistoryTables();
    renderStorageStatus();
    showStatusMessage(`Saved daily log for ${dailyLog.date}.`);
    refreshCurrentView(getActiveViewName());
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    setLoadingState(false);
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

  dom.quickWaterButton.disabled = true;

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
      `Added 1 glass of water. Today is now ${formatMaybeNumber(savedLog.water.glasses)} / ${formatMaybeNumber(targetGlasses)} glasses.`
    );
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    dom.quickWaterButton.disabled = false;
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
    date: dom.workoutForm.elements.date.value,
    session_type: dom.workoutForm.elements.session_type.value.trim(),
    duration: toNumberOrNull(dom.workoutForm.elements.duration.value),
    exercises,
  };

  setLoadingState(true, `Saving workout for ${workoutLog.date}...`);

  try {
    const savedWorkout = await saveWorkoutLog(workoutLog);
    renderHistoryTables();
    renderStorageStatus();
    showStatusMessage(`Saved workout log for ${savedWorkout.date}.`);
    resetWorkoutForm();
    refreshCurrentView(getActiveViewName());
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    setLoadingState(false);
  }
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

  setLoadingState(true, "Saving your targets...");

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
    setLoadingState(false);
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

  setLoadingState(true, "Saving account details...", "Updating your profile");

  try {
    if (appState.previewMode) {
      appState.currentUser = {
        ...appState.currentUser,
        displayName: displayName || "Offline Preview",
        photoURL: photoURL || "",
      };
      persistOfflinePreviewWorkspace();
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
    setLoadingState(false);
  }
}

async function handleAccountDelete() {
  if (!appState.currentUser) {
    showStatusMessage("Sign in before deleting your account.", true);
    setAppLocked(true);
    return;
  }

  const confirmed = window.confirm(
    "Delete your Health Ledger account and all stored logs? This cannot be undone."
  );

  if (!confirmed) {
    return;
  }

  closeUtilityModal(dom.accountModal);
  setLoadingState(
    true,
    "Permanently wiping your cloud data and finalizing profile changes...",
    "Deleting your account"
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
          "Account deletion will continue, but the goodbye email could not be sent. Check EmailJS setup in js/config.js.",
          true
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
    setAuthFeedback("Your Health Ledger account was deleted. You can sign in again with another account.");
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
    setLoadingState(true, `Importing ${file.name}...`);
    const csvText = await file.text();
    const importedLogs = parseLegacyCsv(csvText);
    await Promise.all(importedLogs.map((log) => saveDailyLog(log)));

    renderHistoryTables();
    renderStorageStatus();
    refreshCurrentView(getActiveViewName());
    showStatusMessage(`Imported ${importedLogs.length} legacy row(s) from ${file.name}.`);
  } catch (error) {
    console.error(error);
    showStatusMessage(error.message || "Unable to import that CSV file.", true);
  } finally {
    setLoadingState(false);
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

  const confirmed = window.confirm(
    "Import this backup into the current workspace? Daily logs will merge by date, duplicate workouts will be skipped, and saved targets will be restored."
  );

  if (!confirmed) {
    event.target.value = "";
    return;
  }

  try {
    setLoadingState(true, `Importing ${file.name}...`, "Restoring your backup");
    const backupText = await file.text();
    const backupPayload = JSON.parse(backupText);
    const result = await importWorkspaceBackup(backupPayload);

    renderHistoryTables();
    renderStorageStatus();
    refreshCurrentView(getActiveViewName());
    showStatusMessage(
      `Backup import complete. Added ${result.dailyImported} daily log(s), ${result.workoutImported} workout(s), and skipped ${result.workoutSkipped} duplicate workout(s).`
    );
  } catch (error) {
    console.error(error);
    showStatusMessage(error.message || "Unable to import that backup file.", true);
  } finally {
    setLoadingState(false);
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
  if (
    !dom.profileShell.hidden &&
    !dom.profileShell.contains(event.target) &&
    dom.profileTrigger.getAttribute("aria-expanded") === "true"
  ) {
    setProfileMenuOpen(false);
  }
}

function handleGlobalKeydown(event) {
  if (event.key !== "Escape") {
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
      "success"
    );
  } catch (error) {
    if (
      error.code === "auth/provider-already-linked" ||
      error.code === "auth/credential-already-in-use"
    ) {
      clearPendingGoogleLink();
      setAuthFeedback(
        "Google is already linked to this account. You can use either sign-in method.",
        "success"
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
  resetWorkoutForm();
  populateDailyFormForDate(getLocalDateString());
  renderHistoryTables();
  renderStorageStatus();
  refreshCurrentView(getActiveViewName());
}

function renderSignedOutState() {
  closeTransientUi();
  clearDashboardPanels(
    shouldOfferOfflinePreview()
      ? "Use a local server for Firebase sign-in, or continue with offline preview mode."
      : "Sign in to view your private dashboard and Firestore-backed trends."
  );
  renderHistoryTables();
  renderStorageStatus();
  populateSettingsForm();
  seedFormDates();
  resetWorkoutForm();
  populateDailyFormForDate(getLocalDateString());
}

/*
  ---------------------------------------------------------------------------
  Offline preview
  ---------------------------------------------------------------------------
*/

async function handleOfflinePreviewStart() {
  setAuthFeedback("");
  setLoadingState(true, "Opening offline preview...", "Local Preview Mode");

  try {
    const previewState = readOfflinePreviewWorkspace();
    appState.previewMode = true;
    appState.currentUser = buildOfflinePreviewUser(previewState.profile);
    appState.userSettings = normalizeUserSettings(previewState.userSettings);
    appState.dailyLogs = (previewState.dailyLogs || [])
      .map((log) => normalizeDailyLog(log))
      .sort(sortByDateAsc);
    appState.workoutLogs = (previewState.workoutLogs || [])
      .map((log) => normalizeWorkoutLog(log))
      .sort(sortByDateAsc);
    appState.selectedWeekKey = getCurrentWeekKey();

    setSessionState(appState.currentUser);
    setAppLocked(false);
    syncWorkspaceUiFromState();
    showStatusMessage("Offline preview is active. Data will stay in this browser.");
  } catch (error) {
    console.error(error);
    showStatusMessage("Unable to start offline preview in this browser.", true);
  } finally {
    setLoadingState(false);
  }
}
