"use strict";

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  fetchSignInMethodsForEmail,
  getAuth,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/*
  Health Ledger
  ---------------------------------------------------------------------------
  Firebase Auth and Firestore now back the app so each user's data stays
  scoped to their own account.
*/

const firebaseConfig = {
  apiKey: "AIzaSyAakyAhWSKdvEEGjCoDvXdzDwGxx4_yfm8",
  authDomain: "sps-health-ledger.firebaseapp.com",
  projectId: "sps-health-ledger",
  storageBucket: "sps-health-ledger.firebasestorage.app",
  messagingSenderId: "652885909913",
  appId: "1:652885909913:web:76c9acfd596e9d102c7308",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();
const OFFLINE_PREVIEW_STORAGE_KEY = "healthLedger.offlinePreview.v1";
const MACRO_CALORIE_MARGIN = 15;

googleProvider.setCustomParameters({
  prompt: "select_account",
});

const DEFAULT_SETTINGS = {
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

const DAILY_QUOTES = [
  { text: "Consistency is still progress when the day feels ordinary.", source: "Daily Ledger" },
  { text: "A calm system beats a perfect week.", source: "Daily Ledger" },
  { text: "One honest log is better than a forgotten ideal.", source: "Daily Ledger" },
  { text: "Momentum usually starts as something small repeated on time.", source: "Daily Ledger" },
  { text: "Take care of the boring basics and the big results start behaving.", source: "Daily Ledger" },
  { text: "Your plan does not need drama. It needs another solid day.", source: "Daily Ledger" },
  { text: "Energy follows structure more often than motivation.", source: "Daily Ledger" },
  { text: "The body likes patience more than heroics.", source: "Daily Ledger" },
];

const chartInstances = {
  weight: null,
  calories: null,
  protein: null,
  steps: null,
  water: null,
  macros: null,
  volume: null,
};

const appState = {
  currentUser: null,
  selectedWeekKey: getCurrentWeekKey(),
  dailyLogs: [],
  workoutLogs: [],
  userSettings: cloneDefaultSettings(),
  authPending: false,
  pendingGoogleCredential: null,
  pendingLinkEmail: "",
  previewMode: false,
};

const dom = {};

document.addEventListener("DOMContentLoaded", initializeInterface);

function initializeInterface() {
  cacheDomReferences();
  bindEvents();
  seedFormDates();
  updateMacroInputMode();
  resetWorkoutForm();
  setDailyQuote();
  configureOfflinePreviewUi();
  setAppLocked(true);
  renderSignedOutState();
  setLoadingState(true, "Checking your secure session...");

  onAuthStateChanged(auth, async (user) => {
    await handleAuthStateChange(user);
  });
}

function cacheDomReferences() {
  dom.navButtons = document.querySelectorAll(".nav-button");
  dom.views = document.querySelectorAll(".view");
  dom.statusMessage = document.getElementById("status-message");
  dom.dashboardHeading = document.getElementById("dashboard-heading");
  dom.sessionLabel = document.getElementById("session-label");
  dom.profileShell = document.getElementById("profile-shell");
  dom.profileTrigger = document.getElementById("profile-trigger");
  dom.profileMenu = document.getElementById("profile-menu");
  dom.profileName = document.getElementById("profile-name");
  dom.profileSubtitle = document.getElementById("profile-subtitle");
  dom.profileAvatarImage = document.getElementById("profile-avatar-image");
  dom.profileAvatarFallback = document.getElementById("profile-avatar-fallback");
  dom.accountMenuButton = document.getElementById("account-menu-button");
  dom.preferencesMenuButton = document.getElementById("preferences-menu-button");
  dom.logoutMenuButton = document.getElementById("logout-menu-button");

  dom.dailyQuoteText = document.getElementById("daily-quote-text");
  dom.dailyQuoteSource = document.getElementById("daily-quote-source");

  dom.dashboardSummary = document.getElementById("dashboard-summary");
  dom.dashboardToday = document.getElementById("dashboard-today");
  dom.dashboardWeekTitle = document.getElementById("dashboard-week-title");
  dom.dashboardWeekCaption = document.getElementById("dashboard-week-caption");
  dom.dashboardWeekSelect = document.getElementById("dashboard-week-select");
  dom.quickWaterProgress = document.getElementById("quick-water-progress");
  dom.quickWaterButton = document.getElementById("quick-water-button");
  dom.insightCards = document.getElementById("insight-cards");
  dom.alertCards = document.getElementById("alert-cards");

  dom.dailyForm = document.getElementById("daily-log-form");
  dom.workoutForm = document.getElementById("workout-log-form");
  dom.settingsForm = document.getElementById("settings-form");
  dom.csvImport = document.getElementById("csv-import");
  dom.exportBackupButton = document.getElementById("export-backup-button");
  dom.storageStatus = document.getElementById("storage-status");

  dom.exerciseList = document.getElementById("exercise-list");
  dom.addExerciseButton = document.getElementById("add-exercise-button");
  dom.macroPreview = document.getElementById("macro-preview");
  dom.dailyProteinLabel = document.getElementById("daily-protein-label");
  dom.dailyCarbsLabel = document.getElementById("daily-carbs-label");
  dom.dailyFatLabel = document.getElementById("daily-fat-label");

  dom.dailyHistoryBody = document.getElementById("daily-history-body");
  dom.workoutHistoryBody = document.getElementById("workout-history-body");

  dom.weightChart = document.getElementById("weightChart");
  dom.calorieChart = document.getElementById("calorieChart");
  dom.proteinChart = document.getElementById("proteinChart");
  dom.stepsChart = document.getElementById("stepsChart");
  dom.waterChart = document.getElementById("waterChart");
  dom.macroChart = document.getElementById("macroChart");
  dom.volumeChart = document.getElementById("volumeChart");

  dom.authOverlay = document.getElementById("auth-overlay");
  dom.authForm = document.getElementById("auth-form");
  dom.authEmail = document.getElementById("auth-email");
  dom.authPassword = document.getElementById("auth-password");
  dom.googleSigninButton = document.getElementById("google-signin-button");
  dom.emailSigninButton = document.getElementById("email-signin-button");
  dom.emailSignupButton = document.getElementById("email-signup-button");
  dom.authFeedback = document.getElementById("auth-feedback");
  dom.offlinePreviewBlock = document.getElementById("offline-preview-block");
  dom.offlinePreviewCopy = document.getElementById("offline-preview-copy");
  dom.offlinePreviewButton = document.getElementById("offline-preview-button");

  dom.accountModal = document.getElementById("account-modal");
  dom.accountForm = document.getElementById("account-form");
  dom.accountDisplayName = document.getElementById("account-display-name");
  dom.accountPhotoUrl = document.getElementById("account-photo-url");
  dom.accountModalClose = document.getElementById("account-modal-close");
  dom.accountModalCancel = document.getElementById("account-modal-cancel");
  dom.accountDeletePassword = document.getElementById("account-delete-password");
  dom.accountDeleteButton = document.getElementById("account-delete-button");

  dom.preferencesModal = document.getElementById("preferences-modal");
  dom.preferencesModalClose = document.getElementById("preferences-modal-close");
  dom.preferencesModalCancel = document.getElementById("preferences-modal-cancel");

  dom.logoutModal = document.getElementById("logout-modal");
  dom.logoutModalClose = document.getElementById("logout-modal-close");
  dom.logoutCancelButton = document.getElementById("logout-cancel-button");
  dom.logoutConfirmButton = document.getElementById("logout-confirm-button");

  dom.loadingOverlay = document.getElementById("app-loading");
  dom.loadingLabel = document.getElementById("loading-label");
  dom.loadingCopy = document.getElementById("loading-copy");
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

  dom.logoutModalClose.addEventListener("click", () => closeUtilityModal(dom.logoutModal));
  dom.logoutCancelButton.addEventListener("click", () => closeUtilityModal(dom.logoutModal));
  dom.logoutConfirmButton.addEventListener("click", handleLogoutConfirm);

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleGlobalKeydown);
}

/*
  ---------------------------------------------------------------------------
  Firebase auth and Firestore
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
    setAuthFeedback("Sign in to load your private dashboard and cloud data.");
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
  setLoadingState(true, `Loading ${getFriendlyUserName(user)}'s dashboard...`, `Welcome, ${getFriendlyUserName(user)}`);

  try {
    await ensureUserProfile(user);
    await hydrateUserWorkspace(user.uid);
    dom.authForm.reset();
    showStatusMessage(`Welcome back, ${getFriendlyUserName(user)}.`);
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
    await signInWithPopup(auth, googleProvider);
    setAuthFeedback("Google sign-in worked. Pulling your data now...", "success");
  } catch (error) {
    console.error(error);
    if (error.code === "auth/account-exists-with-different-credential") {
      const pendingCredential = GoogleAuthProvider.credentialFromError(error);
      const email = error.customData?.email || "";

      if (pendingCredential && email) {
        let methods = [];

        try {
          methods = await fetchSignInMethodsForEmail(auth, email);
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
    let userCredential;

    if (mode === "signup") {
      userCredential = await createUserWithEmailAndPassword(auth, email, password);
      setAuthFeedback("Account created. Loading your new workspace...", "success");
    } else {
      userCredential = await signInWithEmailAndPassword(auth, email, password);
      await linkPendingGoogleCredential(userCredential.user);
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
    await signOut(auth);
  } catch (error) {
    console.error(error);
    setLoadingState(false);
    showStatusMessage(formatFirebaseError(error), true);
  }
}

async function hydrateUserWorkspace(uid) {
  const [settingsSnapshot, dailyLogsSnapshot, workoutLogsSnapshot] = await Promise.all([
    getDoc(getUserSettingsDoc(uid)),
    getDocs(getUserDailyLogsCollection(uid)),
    getDocs(getUserWorkoutLogsCollection(uid)),
  ]);

  let settings = cloneDefaultSettings();

  if (settingsSnapshot.exists()) {
    settings = normalizeUserSettings(settingsSnapshot.data());
  } else {
    await setDoc(getUserSettingsDoc(uid), clonePlainData(settings), { merge: true });
  }

  appState.userSettings = settings;
  appState.dailyLogs = dailyLogsSnapshot.docs
    .map((snapshot) => normalizeDailyLog({ id: snapshot.id, ...snapshot.data() }))
    .sort(sortByDateAsc);
  appState.workoutLogs = workoutLogsSnapshot.docs
    .map((snapshot) => normalizeWorkoutLog({ id: snapshot.id, ...snapshot.data() }))
    .sort(sortByDateAsc);

  syncWorkspaceUiFromState();
}

async function ensureUserProfile(user) {
  if (appState.previewMode) {
    persistOfflinePreviewWorkspace();
    return;
  }

  await setDoc(
    getUserProfileDoc(user.uid),
    {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
      lastSeenAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

async function saveDailyLog(dailyLog) {
  const user = requireAuthenticatedUser();
  const existingLog = getExistingDailyLog(dailyLog.date);
  const mergedLog = existingLog
    ? mergeDailyLogs(existingLog, dailyLog)
    : mergeDailyLogs(createEmptyDailyLog(dailyLog.date), dailyLog);
  const normalizedLog = normalizeDailyLog(mergedLog);

  if (appState.previewMode) {
    upsertDailyLogInState(normalizedLog);
    persistOfflinePreviewWorkspace();
    return normalizedLog;
  }

  await setDoc(getUserDailyLogDoc(user.uid, normalizedLog.date), clonePlainData(normalizedLog), {
    merge: true,
  });

  upsertDailyLogInState(normalizedLog);
  return normalizedLog;
}

async function saveWorkoutLog(workoutLog) {
  const user = requireAuthenticatedUser();
  const normalizedLog = normalizeWorkoutLog(workoutLog);

  if (appState.previewMode) {
    const savedLog = {
      ...normalizedLog,
      id: normalizedLog.id || generateOfflineId(),
    };
    upsertWorkoutLogInState(savedLog);
    persistOfflinePreviewWorkspace();
    return savedLog;
  }

  const { id, ...payload } = normalizedLog;
  const docRef = await addDoc(getUserWorkoutLogsCollection(user.uid), clonePlainData(payload));
  const savedLog = { ...normalizedLog, id: docRef.id };
  upsertWorkoutLogInState(savedLog);
  return savedLog;
}

async function saveUserSettings(userSettings) {
  const user = requireAuthenticatedUser();
  const normalizedSettings = normalizeUserSettings(userSettings);

  if (appState.previewMode) {
    appState.userSettings = normalizedSettings;
    persistOfflinePreviewWorkspace();
    return normalizedSettings;
  }

  await setDoc(getUserSettingsDoc(user.uid), clonePlainData(normalizedSettings), { merge: true });

  appState.userSettings = normalizedSettings;
  return normalizedSettings;
}

async function reauthenticateForAccountDeletion(user) {
  const providerIds = user.providerData.map((provider) => provider.providerId);

  if (providerIds.includes("password")) {
    const password = dom.accountDeletePassword.value;

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

async function deleteUserWorkspace(uid) {
  const [dailyLogsSnapshot, workoutLogsSnapshot] = await Promise.all([
    getDocs(getUserDailyLogsCollection(uid)),
    getDocs(getUserWorkoutLogsCollection(uid)),
  ]);

  const docRefs = [
    ...dailyLogsSnapshot.docs.map((snapshot) => snapshot.ref),
    ...workoutLogsSnapshot.docs.map((snapshot) => snapshot.ref),
    getUserSettingsDoc(uid),
    getUserProfileDoc(uid),
  ];

  for (let index = 0; index < docRefs.length; index += 450) {
    const batch = writeBatch(db);
    docRefs.slice(index, index + 450).forEach((docRef) => batch.delete(docRef));
    await batch.commit();
  }
}

function getUserProfileDoc(uid) {
  return doc(db, "users", uid);
}

function getUserSettingsDoc(uid) {
  return doc(db, "users", uid, "meta", "settings");
}

function getUserDailyLogsCollection(uid) {
  return collection(db, "users", uid, "dailyLogs");
}

function getUserDailyLogDoc(uid, logId) {
  return doc(db, "users", uid, "dailyLogs", logId);
}

function getUserWorkoutLogsCollection(uid) {
  return collection(db, "users", uid, "workoutLogs");
}

/*
  ---------------------------------------------------------------------------
  UI actions and handlers
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
    showStatusMessage(`Added 1 glass of water. Today is now ${formatMaybeNumber(savedLog.water.glasses)} / ${formatMaybeNumber(targetGlasses)} glasses.`);
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    dom.quickWaterButton.disabled = false;
  }
}

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

    await updateProfile(auth.currentUser, {
      displayName: displayName || null,
      photoURL: photoURL || null,
    });

    appState.currentUser = auth.currentUser;
    await ensureUserProfile(auth.currentUser);
    setSessionState(auth.currentUser);
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

  setLoadingState(true, "Deleting account data...", "Deleting your account");

  try {
    if (appState.previewMode) {
      localStorage.removeItem(OFFLINE_PREVIEW_STORAGE_KEY);
      appState.previewMode = false;
      appState.currentUser = null;
      clearUserDataState();
      renderSignedOutState();
      setSessionState(null);
      setAppLocked(true);
      closeUtilityModal(dom.accountModal);
      showStatusMessage("Offline preview account data has been deleted.");
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      throw new Error("Your session ended. Sign in again before deleting the account.");
    }

    await reauthenticateForAccountDeletion(user);
    await deleteUserWorkspace(user.uid);
    await deleteUser(user);

    appState.currentUser = null;
    clearUserDataState();
    renderSignedOutState();
    setSessionState(null);
    setAppLocked(true);
    closeUtilityModal(dom.accountModal);
    showStatusMessage("Your Health Ledger account and stored data have been deleted.");
  } catch (error) {
    console.error(error);
    showStatusMessage(formatFirebaseError(error), true);
  } finally {
    setLoadingState(false);
  }
}

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

function handleBackupExport() {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 3,
    user: appState.currentUser
      ? {
          uid: appState.currentUser.uid,
          email: appState.currentUser.email || "",
          displayName: appState.currentUser.displayName || "",
        }
      : null,
    userSettings: appState.userSettings,
    dailyLogs: appState.dailyLogs,
    workoutLogs: appState.workoutLogs,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `health-ledger-backup-${getLocalDateString()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);

  showStatusMessage("Backup exported. You can archive that file to Google Drive anytime.");
}

function populateSettingsForm() {
  const settings = appState.userSettings;
  dom.settingsForm.elements.calorieTarget.value = settings.calorieTarget;
  dom.settingsForm.elements.proteinGramTarget.value = settings.proteinGramTarget;
  dom.settingsForm.elements.proteinTarget.value = settings.macroTarget.protein;
  dom.settingsForm.elements.carbsTarget.value = settings.macroTarget.carbs;
  dom.settingsForm.elements.fatTarget.value = settings.macroTarget.fat;
  dom.settingsForm.elements.waterTargetGlasses.value = settings.waterTargetGlasses;
  dom.settingsForm.elements.waterUnitAmountMl.value = settings.waterUnitAmountMl;
}

function seedFormDates() {
  const today = getLocalDateString();
  dom.dailyForm.elements.date.value = today;
  dom.workoutForm.elements.date.value = today;
}

function populateDailyFormForDate(date) {
  const settings = appState.userSettings;
  const existingLog = getExistingDailyLog(date);
  const log = existingLog || createEmptyDailyLog(date);
  const derivedPercentages = deriveMacroPercentages(log.calories, log.macros);

  dom.dailyForm.elements.macroMode.value = "percentage";
  updateMacroInputMode();
  dom.dailyForm.elements.date.value = date;
  dom.dailyForm.elements.weight.value = valueOrEmpty(log.weight);
  dom.dailyForm.elements.calories.value = valueOrEmpty(log.calories);
  dom.dailyForm.elements.protein.value = valueOrEmpty(
    log.macroPercentages.protein ?? derivedPercentages.protein
  );
  dom.dailyForm.elements.carbPercent.value = valueOrEmpty(
    log.macroPercentages.carbs ?? derivedPercentages.carbs
  );
  dom.dailyForm.elements.fatPercent.value = valueOrEmpty(
    log.macroPercentages.fat ?? derivedPercentages.fat
  );
  dom.dailyForm.elements.steps.value = valueOrEmpty(log.steps);
  dom.dailyForm.elements.sleep.value = valueOrEmpty(log.sleep);
  dom.dailyForm.elements.waterGlasses.value = valueOrEmpty(log.water.glasses);
  dom.dailyForm.elements.waterTargetGlasses.value = valueOrEmpty(
    log.water.targetGlasses ?? settings.waterTargetGlasses
  );
  dom.dailyForm.elements.waterUnitAmountMl.value = valueOrEmpty(
    log.water.unitAmountMl ?? settings.waterUnitAmountMl
  );
  dom.dailyForm.elements.energy.value = valueOrEmpty(log.energy);
  dom.dailyForm.elements.notes.value = log.notes || "";

  updateNutritionPreview();
}

function getExistingDailyLog(date) {
  return appState.dailyLogs.find((log) => log.date === date) || null;
}

function setDailyQuote() {
  const quoteIndex = hashString(getLocalDateString()) % DAILY_QUOTES.length;
  const quote = DAILY_QUOTES[quoteIndex];
  dom.dailyQuoteText.textContent = quote.text;
  dom.dailyQuoteSource.textContent = quote.source;
}

function showStatusMessage(message, isError = false) {
  dom.statusMessage.textContent = message;
  dom.statusMessage.classList.add("visible");
  dom.statusMessage.style.background = isError
    ? "rgba(255, 133, 133, 0.12)"
    : "rgba(104, 228, 255, 0.12)";
  dom.statusMessage.style.borderColor = isError
    ? "rgba(255, 133, 133, 0.22)"
    : "rgba(104, 228, 255, 0.2)";
}

function clearStatusMessage() {
  dom.statusMessage.textContent = "";
  dom.statusMessage.classList.remove("visible");
}

function renderStorageStatus() {
  if (appState.previewMode) {
    const snapshot = JSON.stringify({
      userSettings: appState.userSettings,
      dailyLogs: appState.dailyLogs,
      workoutLogs: appState.workoutLogs,
      profile: {
        displayName: appState.currentUser?.displayName || "",
        photoURL: appState.currentUser?.photoURL || "",
      },
    });

    dom.storageStatus.textContent =
      `Offline preview is active. ${appState.dailyLogs.length} daily logs and ` +
      `${appState.workoutLogs.length} workouts are being stored in this browser only, ` +
      `using about ${formatBytes(new Blob([snapshot]).size)} locally.`;
    return;
  }

  if (!appState.currentUser) {
    dom.storageStatus.textContent =
      "Sign in to sync your daily logs, workouts, and targets to Firestore. " +
      "When connected, all records stay scoped under your authenticated user ID.";
    return;
  }

  const snapshot = JSON.stringify({
    userSettings: appState.userSettings,
    dailyLogs: appState.dailyLogs,
    workoutLogs: appState.workoutLogs,
  });

  dom.storageStatus.textContent =
    `Cloud sync is active for ${appState.currentUser.email || getFriendlyUserName(appState.currentUser)}. ` +
    `${appState.dailyLogs.length} daily logs and ${appState.workoutLogs.length} workouts ` +
    `currently use about ${formatBytes(new Blob([snapshot]).size)} in this export. ` +
    `Firestore reads and writes stay scoped to users/${appState.currentUser.uid}/...`;
}

function updateNutritionPreview() {
  const calories = toNumberOrNull(dom.dailyForm.elements.calories.value);
  const protein = toNumberOrNull(dom.dailyForm.elements.protein.value);
  const carbPercent = toNumberOrNull(dom.dailyForm.elements.carbPercent.value);
  const fatPercent = toNumberOrNull(dom.dailyForm.elements.fatPercent.value);
  const macroMode = dom.dailyForm.elements.macroMode.value;

  const payload = buildMacroPayloadFromInputs(
    calories,
    protein,
    carbPercent,
    fatPercent,
    macroMode,
    true
  );

  if (payload.error) {
    dom.macroPreview.innerHTML = `<strong>Check:</strong> ${escapeHtml(payload.error)}`;
    return;
  }

  if (macroMode === "grams") {
    const calculatedText = isNumber(payload.calculatedCalories)
      ? `${Math.round(payload.calculatedCalories)} calories`
      : "Enter grams";
    const calorieText = isNumber(payload.calories)
      ? `${Math.round(payload.calories)} calories`
      : calculatedText;
    const proteinShare = isNumber(payload.macroPercentages.protein)
      ? `${payload.macroPercentages.protein.toFixed(1)}%`
      : "-";
    const carbsShare = isNumber(payload.macroPercentages.carbs)
      ? `${payload.macroPercentages.carbs.toFixed(1)}%`
      : "-";
    const fatShare = isNumber(payload.macroPercentages.fat)
      ? `${payload.macroPercentages.fat.toFixed(1)}%`
      : "-";

    dom.macroPreview.innerHTML = `
      <strong>Nutrition preview</strong><br />
      Gram math totals <strong>${calculatedText}</strong>. Saved calories will be
      <strong>${calorieText}</strong>.<br />
      Macro split: protein <strong>${proteinShare}</strong>, carbs <strong>${carbsShare}</strong>,
      fat <strong>${fatShare}</strong>.
    `;
    return;
  }

  const proteinText = isNumber(payload.macros.protein) ? `${payload.macros.protein.toFixed(1)} g` : "Enter calories";
  const carbsText = isNumber(payload.macros.carbs) ? `${payload.macros.carbs.toFixed(1)} g` : "Enter calories";
  const fatText = isNumber(payload.macros.fat) ? `${payload.macros.fat.toFixed(1)} g` : "Enter calories";
  const assignedText = isNumber(payload.assignedPercent)
    ? `${payload.assignedPercent.toFixed(1)}%`
    : "Not available";
  const remainingText = isNumber(payload.remainingPercent)
    ? `${payload.remainingPercent.toFixed(1)}%`
    : "Not available";

  dom.macroPreview.innerHTML = `
    <strong>Nutrition preview</strong><br />
    Protein converts to <strong>${proteinText}</strong>, carbs convert to <strong>${carbsText}</strong>,
    and fat converts to <strong>${fatText}</strong>.<br />
    Assigned intake: <strong>${assignedText}</strong>. Remaining unassigned: <strong>${remainingText}</strong>.
  `;
}

function updateMacroInputMode() {
  const isGrams = dom.dailyForm.elements.macroMode.value === "grams";
  const proteinInput = dom.dailyForm.elements.protein;
  const carbsInput = dom.dailyForm.elements.carbPercent;
  const fatInput = dom.dailyForm.elements.fatPercent;

  dom.dailyProteinLabel.textContent = isGrams ? "Protein (g)" : "Protein (%)";
  dom.dailyCarbsLabel.textContent = isGrams ? "Carbs (g)" : "Carbs (%)";
  dom.dailyFatLabel.textContent = isGrams ? "Fat (g)" : "Fat (%)";

  proteinInput.placeholder = isGrams ? "180" : "30";
  carbsInput.placeholder = isGrams ? "220" : "40";
  fatInput.placeholder = isGrams ? "70" : "30";

  [proteinInput, carbsInput, fatInput].forEach((input) => {
    if (isGrams) {
      input.removeAttribute("max");
      input.step = "0.1";
    } else {
      input.max = "100";
      input.step = "0.1";
    }
  });
}

function setSessionState(user) {
  if (!user) {
    dom.sessionLabel.textContent = "Sign in to sync your Health Ledger privately to the cloud.";
    dom.profileShell.hidden = true;
    dom.profileTrigger.setAttribute("aria-expanded", "false");
    dom.profileMenu.hidden = true;
    dom.profileName.textContent = "Health Ledger User";
    dom.profileSubtitle.textContent = "My Profile";
    dom.profileAvatarImage.hidden = true;
    dom.profileAvatarImage.removeAttribute("src");
    dom.profileAvatarFallback.hidden = false;
    return;
  }

  dom.sessionLabel.textContent = appState.previewMode
    ? `Offline preview is active for ${getFriendlyUserName(user)}.`
    : `Signed in as ${getFriendlyUserName(user)}. Cloud sync is live.`;
  dom.profileShell.hidden = false;
  dom.profileTrigger.setAttribute("aria-expanded", "false");
  dom.profileMenu.hidden = true;
  dom.profileName.textContent = getFriendlyUserName(user);
  dom.profileSubtitle.textContent = appState.previewMode
    ? "Stored in this browser"
    : user.email || "My Profile";

  if (user.photoURL) {
    dom.profileAvatarImage.src = user.photoURL;
    dom.profileAvatarImage.hidden = false;
    dom.profileAvatarFallback.hidden = true;
  } else {
    dom.profileAvatarImage.hidden = true;
    dom.profileAvatarImage.removeAttribute("src");
    dom.profileAvatarFallback.hidden = false;
  }
}

function setAppLocked(isLocked) {
  document.body.classList.toggle("auth-locked", isLocked);
  dom.authOverlay.hidden = !isLocked;
  if (isLocked) {
    closeTransientUi();
  }
}

function setLoadingState(isVisible, message = "Working...", title = "Syncing Health Ledger") {
  document.body.classList.toggle("app-busy", isVisible);
  dom.loadingOverlay.hidden = !isVisible;
  dom.loadingLabel.textContent = title;
  dom.loadingCopy.textContent = message;
}

function setAuthFeedback(message, tone = "") {
  dom.authFeedback.textContent = message;
  dom.authFeedback.className = "auth-feedback";

  if (tone) {
    dom.authFeedback.classList.add(tone);
  }
}

function setAuthPending(isPending) {
  appState.authPending = isPending;

  [
    dom.authEmail,
    dom.authPassword,
    dom.googleSigninButton,
    dom.emailSigninButton,
    dom.emailSignupButton,
    dom.offlinePreviewButton,
  ].forEach((element) => {
    element.disabled = isPending;
  });
}

function configureOfflinePreviewUi() {
  const isAvailable = shouldOfferOfflinePreview();
  dom.offlinePreviewBlock.hidden = !isAvailable;

  if (isAvailable) {
    dom.offlinePreviewCopy.textContent =
      "This local file preview cannot complete Firebase sign-in reliably. You can still open Health Ledger in offline preview mode and keep test data in this browser.";
    setAuthFeedback(
      "Use a local server for real Firebase sign-in, or continue in offline preview mode here.",
      "error"
    );
  }
}

function shouldOfferOfflinePreview() {
  return window.location.protocol === "file:" || !navigator.onLine;
}

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

function setProfileMenuOpen(isOpen) {
  dom.profileTrigger.setAttribute("aria-expanded", String(isOpen));
  dom.profileMenu.hidden = !isOpen;
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

function openUtilityModal(modal) {
  closeTransientUi();
  modal.hidden = false;
}

function closeUtilityModal(modal) {
  modal.hidden = true;
}

function closeTransientUi() {
  setProfileMenuOpen(false);
  closeUtilityModal(dom.accountModal);
  closeUtilityModal(dom.preferencesModal);
  closeUtilityModal(dom.logoutModal);
}

function populateAccountForm() {
  const user = appState.currentUser;
  dom.accountDisplayName.value = user?.displayName || "";
  dom.accountPhotoUrl.value = user?.photoURL || "";
  dom.accountDeletePassword.value = "";
}

async function linkPendingGoogleCredential(user) {
  if (!appState.pendingGoogleCredential) {
    return;
  }

  const normalizedPendingEmail = normalizeEmail(appState.pendingLinkEmail);
  if (normalizedPendingEmail && normalizeEmail(user.email) !== normalizedPendingEmail) {
    return;
  }

  try {
    await linkWithCredential(user, appState.pendingGoogleCredential);
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

function clearPendingGoogleLink() {
  appState.pendingGoogleCredential = null;
  appState.pendingLinkEmail = "";
}

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

function clearDashboardPanels(message) {
  destroyAllCharts();
  dom.dashboardHeading.textContent = "Welcome to Health Ledger";
  dom.dashboardSummary.textContent = message;
  dom.dashboardToday.textContent = "Secure sync is paused";
  dom.dashboardWeekTitle.textContent = "Week Overview";
  dom.dashboardWeekCaption.textContent = "Sign in to load your weekly charts.";
  dom.dashboardWeekSelect.innerHTML = `<option value="${getCurrentWeekKey()}">Current week</option>`;
  renderQuickWaterProgress();
  dom.insightCards.innerHTML = "";
  dom.alertCards.innerHTML = `
    <article class="alert-card ok">
      <span>Account Required</span>
      <strong>Sign In</strong>
      <p>Your dashboard and forms unlock after Firebase Authentication confirms your session.</p>
    </article>
  `;
}

function clearUserDataState() {
  appState.dailyLogs = [];
  appState.workoutLogs = [];
  appState.userSettings = cloneDefaultSettings();
  appState.selectedWeekKey = getCurrentWeekKey();
}

/*
  ---------------------------------------------------------------------------
  Workout exercise builder
  ---------------------------------------------------------------------------
*/

function resetWorkoutForm() {
  dom.workoutForm.reset();
  dom.workoutForm.elements.date.value = getLocalDateString();
  dom.exerciseList.innerHTML = "";
  addExerciseCard();
}

function addExerciseCard(exercise = null) {
  const exerciseCard = document.createElement("article");
  exerciseCard.className = "exercise-card";
  exerciseCard.innerHTML = `
    <div class="exercise-top">
      <h4>Exercise</h4>
      <button type="button" class="secondary-button remove-exercise-button">Remove</button>
    </div>
    <div class="exercise-fields">
      <label>
        <span>Name</span>
        <input type="text" class="exercise-name" placeholder="Bench Press" required />
      </label>
      <label>
        <span>Muscle Group</span>
        <input type="text" class="exercise-muscle-group" placeholder="Chest" required />
      </label>
    </div>
    <div class="set-list"></div>
    <button type="button" class="secondary-button add-set-button">Add Set</button>
  `;

  const removeButton = exerciseCard.querySelector(".remove-exercise-button");
  const addSetButton = exerciseCard.querySelector(".add-set-button");
  const setList = exerciseCard.querySelector(".set-list");

  removeButton.addEventListener("click", () => {
    exerciseCard.remove();
  });

  addSetButton.addEventListener("click", () => {
    addSetRow(setList);
  });

  dom.exerciseList.appendChild(exerciseCard);

  exerciseCard.querySelector(".exercise-name").value = exercise?.name || "";
  exerciseCard.querySelector(".exercise-muscle-group").value = exercise?.muscle_group || "";

  if (exercise?.sets?.length) {
    exercise.sets.forEach((set) => addSetRow(setList, set));
  } else {
    addSetRow(setList);
  }
}

function addSetRow(setList, set = null) {
  const setRow = document.createElement("div");
  setRow.className = "set-row";
  setRow.innerHTML = `
    <div class="set-row-head">
      <strong>Set</strong>
      <button type="button" class="secondary-button remove-set-button">Remove</button>
    </div>
    <div class="set-fields">
      <label>
        <span>Reps</span>
        <input type="number" class="set-reps" min="0" placeholder="10" required />
      </label>
      <label>
        <span>Weight</span>
        <input type="number" class="set-weight" min="0" step="0.1" placeholder="60" required />
      </label>
    </div>
  `;

  setRow.querySelector(".remove-set-button").addEventListener("click", () => {
    setRow.remove();
  });

  setList.appendChild(setRow);
  setRow.querySelector(".set-reps").value = set?.reps ?? "";
  setRow.querySelector(".set-weight").value = set?.weight ?? "";
}

function collectExercisesFromForm() {
  return Array.from(dom.exerciseList.querySelectorAll(".exercise-card"))
    .map((exerciseCard) => {
      const sets = Array.from(exerciseCard.querySelectorAll(".set-row"))
        .map((setRow) => ({
          reps: toNumberOrNull(setRow.querySelector(".set-reps").value),
          weight: toNumberOrNull(setRow.querySelector(".set-weight").value),
        }))
        .filter((set) => set.reps !== null || set.weight !== null);

      return {
        name: exerciseCard.querySelector(".exercise-name").value.trim(),
        muscle_group: exerciseCard.querySelector(".exercise-muscle-group").value.trim(),
        sets,
      };
    })
    .filter((exercise) => exercise.name && exercise.muscle_group && exercise.sets.length > 0);
}

/*
  ---------------------------------------------------------------------------
  Dashboard rendering
  ---------------------------------------------------------------------------
*/

function renderDashboard() {
  if (!appState.currentUser) {
    clearDashboardPanels("Sign in to view your private dashboard and Firestore-backed trends.");
    return;
  }

  dom.dashboardHeading.textContent = `Welcome back, ${getFriendlyUserName(appState.currentUser)}!`;

  const dailyLogs = appState.dailyLogs;
  const workoutLogs = appState.workoutLogs;
  const settings = appState.userSettings;
  const weekOptions = getAvailableWeekOptions(dailyLogs, workoutLogs);
  const selectedWeek = syncWeekSelector(weekOptions);
  const dailyLogsThisWeek = filterLogsByWindow(dailyLogs, selectedWeek);
  const workoutsThisWeek = filterLogsByWindow(workoutLogs, selectedWeek);

  const averageWeight = calculateAverage(
    dailyLogsThisWeek.map((log) => log.weight).filter(isNumber)
  );
  const averageCalories = calculateAverage(
    dailyLogsThisWeek.map((log) => log.calories).filter(isNumber)
  );
  const averageProtein = calculateAverage(
    dailyLogsThisWeek.map((log) => log.macros.protein).filter(isNumber)
  );
  const averageSteps = calculateAverage(
    dailyLogsThisWeek.map((log) => log.steps).filter(isNumber)
  );
  const totalWorkouts = workoutsThisWeek.length;

  dom.dashboardSummary.textContent =
    `Reviewing ${selectedWeek.label} with ${dailyLogsThisWeek.length} logs......`;

  renderQuickWaterProgress();
  renderInsightCards(averageWeight, averageCalories, averageProtein, averageSteps, totalWorkouts);
  renderAlertCards(dailyLogs, selectedWeek, settings);
  renderWeightChart(dailyLogs, selectedWeek);
  renderCalorieChart(dailyLogsThisWeek, selectedWeek, settings.calorieTarget);
  renderProteinChart(dailyLogsThisWeek, selectedWeek, settings.proteinGramTarget);
  renderStepsChart(dailyLogsThisWeek, selectedWeek);
  renderWaterChart(dailyLogsThisWeek, selectedWeek, settings);
  renderMacroChart(dailyLogsThisWeek, settings.macroTarget);
  renderVolumeChart(workoutsThisWeek);
}

function syncWeekSelector(weekOptions) {
  const selected =
    weekOptions.find((option) => option.key === appState.selectedWeekKey) || weekOptions[0];

  appState.selectedWeekKey = selected.key;

  dom.dashboardWeekSelect.innerHTML = weekOptions
    .map(
      (option) =>
        `<option value="${option.key}" ${option.key === selected.key ? "selected" : ""}>${escapeHtml(option.label)}</option>`
    )
    .join("");

  dom.dashboardToday.textContent = `Today - ${formatLongDate(new Date())}`;
  dom.dashboardWeekTitle.textContent = `Week ${selected.week}, ${selected.year}`;
  dom.dashboardWeekCaption.textContent = `${selected.start} to ${selected.end}`;

  return selected;
}

function renderQuickWaterProgress() {
  const todayLog = getExistingDailyLog(getLocalDateString());
  const settings = appState.userSettings;
  const glasses = toNumberOrNull(todayLog?.water?.glasses) ?? 0;
  const targetGlasses =
    toNumberOrNull(todayLog?.water?.targetGlasses) ?? settings.waterTargetGlasses;

  dom.quickWaterProgress.textContent =
    `${formatNumberForDisplay(glasses)} / ${formatNumberForDisplay(targetGlasses)} Glasses`;
  dom.quickWaterButton.disabled = !appState.currentUser;
}

function renderInsightCards(averageWeight, averageCalories, averageProtein, averageSteps, totalWorkouts) {
  const cards = [
    {
      label: "Average Weight",
      value: isNumber(averageWeight) ? `${averageWeight.toFixed(1)} kg` : "No data",
      detail: "Only logged days are counted.",
    },
    {
      label: "Average Calories",
      value: isNumber(averageCalories) ? `${Math.round(averageCalories)} kcal` : "No data",
      detail: "Empty days stay out of the math.",
    },
    {
      label: "Average Protein",
      value: isNumber(averageProtein) ? `${Math.round(averageProtein)} g` : "No data",
      detail: "Based on logged protein only.",
    },
    {
      label: "Average Steps",
      value: isNumber(averageSteps) ? `${Math.round(averageSteps)}` : "No data",
      detail: "Daily step average for the selected week.",
    },
    {
      label: "Total Workouts",
      value: `${totalWorkouts}`,
      detail: "Sessions inside the selected week.",
    },
  ];

  dom.insightCards.innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <p>${escapeHtml(card.detail)}</p>
        </article>
      `
    )
    .join("");
}

function renderAlertCards(dailyLogs, selectedWeek, settings) {
  const previousWeek = getPreviousWeekInfo(selectedWeek);
  const currentCalories = calculateAverage(
    filterLogsByWindow(dailyLogs, selectedWeek)
      .map((log) => log.calories)
      .filter(isNumber)
  );
  const currentWeightAverage = calculateAverage(
    filterLogsByWindow(dailyLogs, selectedWeek)
      .map((log) => log.weight)
      .filter(isNumber)
  );
  const previousWeightAverage = calculateAverage(
    filterLogsByWindow(dailyLogs, previousWeek)
      .map((log) => log.weight)
      .filter(isNumber)
  );
  const currentProtein = calculateAverage(
    filterLogsByWindow(dailyLogs, selectedWeek)
      .map((log) => log.macros.protein)
      .filter(isNumber)
  );

  const weightLossPercent =
    isNumber(currentWeightAverage) && isNumber(previousWeightAverage)
      ? ((previousWeightAverage - currentWeightAverage) / previousWeightAverage) * 100
      : null;

  const alerts = [
    isNumber(currentCalories) && currentCalories < 1750
      ? {
          tone: "warning",
          title: "Low Average Calories",
          value: `${Math.round(currentCalories)} kcal`,
          detail: "Average intake for the selected week is below 1750 kcal.",
        }
      : {
          tone: "ok",
          title: "Calorie Intake",
          value: isNumber(currentCalories) ? `${Math.round(currentCalories)} kcal` : "No data",
          detail: "No low-calorie warning is active for this week.",
        },
    isNumber(weightLossPercent) && weightLossPercent > 1
      ? {
          tone: "danger",
          title: "Rapid Weight Loss",
          value: `${weightLossPercent.toFixed(2)}%`,
          detail: "Weekly average weight dropped by more than 1% versus the previous week.",
        }
      : {
          tone: "ok",
          title: "Weight Change",
          value: isNumber(weightLossPercent) ? `${weightLossPercent.toFixed(2)}%` : "No data",
          detail: "No rapid weekly drop is being flagged.",
        },
    isNumber(currentProtein) && currentProtein < settings.proteinGramTarget
      ? {
          tone: "warning",
          title: "Protein Below Target",
          value: `${Math.round(currentProtein)} g`,
          detail: `This week is trending below your ${settings.proteinGramTarget} g target.`,
        }
      : {
          tone: "ok",
          title: "Protein Intake",
          value: isNumber(currentProtein) ? `${Math.round(currentProtein)} g` : "No data",
          detail: "Protein is at or above the selected target trend.",
        },
  ];

  dom.alertCards.innerHTML = alerts
    .map(
      (alert) => `
        <article class="alert-card ${escapeHtml(alert.tone)}">
          <span>${escapeHtml(alert.title)}</span>
          <strong>${escapeHtml(alert.value)}</strong>
          <p>${escapeHtml(alert.detail)}</p>
        </article>
      `
    )
    .join("");
}

function renderWeightChart(allDailyLogs, selectedWeek) {
  const ChartConstructor = getChartConstructor();
  const weekDates = getDateStringsInRange(selectedWeek.start, selectedWeek.end);
  const logMap = buildDailyLogMap(allDailyLogs);
  const weights = weekDates.map((date) => logMap[date]?.weight ?? null);
  const rollingAverage = weekDates.map((date, index) => {
    if (!isNumber(weights[index])) {
      return null;
    }

    const windowStart = shiftDateString(date, -6);
    const weightsInWindow = allDailyLogs
      .filter((log) => log.date >= windowStart && log.date <= date && isNumber(log.weight))
      .map((log) => log.weight);

    return calculateAverage(weightsInWindow);
  });

  chartInstances.weight = new ChartConstructor(dom.weightChart, {
    type: "line",
    data: {
      labels: weekDates.map(formatShortDateLabel),
      datasets: [
        {
          label: "Weight",
          data: weights,
          borderColor: "#68e4ff",
          backgroundColor: "rgba(104, 228, 255, 0.16)",
          tension: 0.35,
          fill: false,
          spanGaps: true,
        },
        {
          label: "7-Day Rolling Avg",
          data: rollingAverage,
          borderColor: "#f5fbff",
          backgroundColor: "rgba(245, 251, 255, 0.12)",
          tension: 0.35,
          borderDash: [8, 5],
          fill: false,
          spanGaps: true,
        },
      ],
    },
    options: buildSharedChartOptions("Weight (kg)"),
  });
}

function renderCalorieChart(dailyLogsThisWeek, selectedWeek, calorieTarget) {
  const ChartConstructor = getChartConstructor();
  const weekDates = getDateStringsInRange(selectedWeek.start, selectedWeek.end);
  const logMap = buildDailyLogMap(dailyLogsThisWeek);

  chartInstances.calories = new ChartConstructor(dom.calorieChart, {
    type: "bar",
    data: {
      labels: weekDates.map(formatShortDateLabel),
      datasets: [
        {
          type: "bar",
          label: "Calories",
          data: weekDates.map((date) => logMap[date]?.calories ?? null),
          backgroundColor: "rgba(104, 228, 255, 0.72)",
          borderRadius: 10,
        },
        {
          type: "line",
          label: "Target",
          data: weekDates.map(() => calorieTarget),
          borderColor: "#f5fbff",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: buildSharedChartOptions("Calories"),
  });
}

function renderProteinChart(dailyLogsThisWeek, selectedWeek, proteinTarget) {
  const ChartConstructor = getChartConstructor();
  const weekDates = getDateStringsInRange(selectedWeek.start, selectedWeek.end);
  const logMap = buildDailyLogMap(dailyLogsThisWeek);

  chartInstances.protein = new ChartConstructor(dom.proteinChart, {
    type: "bar",
    data: {
      labels: weekDates.map(formatShortDateLabel),
      datasets: [
        {
          type: "bar",
          label: "Protein",
          data: weekDates.map((date) => logMap[date]?.macros.protein ?? null),
          backgroundColor: "rgba(214, 247, 255, 0.78)",
          borderRadius: 10,
        },
        {
          type: "line",
          label: "Target",
          data: weekDates.map(() => proteinTarget),
          borderColor: "#68e4ff",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: buildSharedChartOptions("Protein (g)"),
  });
}

function renderStepsChart(dailyLogsThisWeek, selectedWeek) {
  const ChartConstructor = getChartConstructor();
  const weekDates = getDateStringsInRange(selectedWeek.start, selectedWeek.end);
  const logMap = buildDailyLogMap(dailyLogsThisWeek);
  const stepValues = weekDates.map((date) => logMap[date]?.steps ?? null);
  const averageSteps = calculateAverage(stepValues.filter(isNumber));

  chartInstances.steps = new ChartConstructor(dom.stepsChart, {
    type: "bar",
    data: {
      labels: weekDates.map(formatShortDateLabel),
      datasets: [
        {
          type: "bar",
          label: "Steps",
          data: stepValues,
          backgroundColor: "rgba(141, 160, 179, 0.72)",
          borderRadius: 10,
        },
        {
          type: "line",
          label: "Weekly Avg",
          data: weekDates.map(() => averageSteps),
          borderColor: "#f5fbff",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: buildSharedChartOptions("Steps"),
  });
}

function renderWaterChart(dailyLogsThisWeek, selectedWeek, settings) {
  const ChartConstructor = getChartConstructor();
  const weekDates = getDateStringsInRange(selectedWeek.start, selectedWeek.end);
  const logMap = buildDailyLogMap(dailyLogsThisWeek);

  chartInstances.water = new ChartConstructor(dom.waterChart, {
    type: "bar",
    data: {
      labels: weekDates.map(formatShortDateLabel),
      datasets: [
        {
          type: "bar",
          label: "Water Intake",
          data: weekDates.map((date) =>
            getWaterLitersFromLog(logMap[date] || createEmptyDailyLog(date), settings)
          ),
          backgroundColor: "rgba(104, 228, 255, 0.5)",
          borderRadius: 10,
        },
        {
          type: "line",
          label: "Target",
          data: weekDates.map((date) =>
            getWaterTargetLiters(logMap[date] || createEmptyDailyLog(date), settings)
          ),
          borderColor: "#f5fbff",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: buildSharedChartOptions("Water (L)"),
  });
}

function renderMacroChart(logsThisWeek, macroTarget) {
  const ChartConstructor = getChartConstructor();
  const totals = logsThisWeek.reduce(
    (accumulator, log) => {
      const macroCalories = getMacroCaloriesBreakdown(log);
      accumulator.protein += macroCalories.protein;
      accumulator.carbs += macroCalories.carbs;
      accumulator.fat += macroCalories.fat;
      return accumulator;
    },
    { protein: 0, carbs: 0, fat: 0 }
  );

  const totalMacroCalories = totals.protein + totals.carbs + totals.fat;
  const actualSplit =
    totalMacroCalories > 0
      ? [
          roundToOneDecimal((totals.protein / totalMacroCalories) * 100),
          roundToOneDecimal((totals.carbs / totalMacroCalories) * 100),
          roundToOneDecimal((totals.fat / totalMacroCalories) * 100),
        ]
      : [0, 0, 0];

  chartInstances.macros = new ChartConstructor(dom.macroChart, {
    type: "doughnut",
    data: {
      labels: ["Protein", "Carbs", "Fat"],
      datasets: [
        {
          label: "Actual Weekly Avg %",
          data: actualSplit,
          backgroundColor: ["#68e4ff", "#f5fbff", "#8da0b3"],
          borderWidth: 0,
        },
        {
          label: "Target %",
          data: [macroTarget.protein, macroTarget.carbs, macroTarget.fat],
          backgroundColor: [
            "rgba(104, 228, 255, 0.22)",
            "rgba(245, 251, 255, 0.18)",
            "rgba(141, 160, 179, 0.22)",
          ],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "52%",
      plugins: {
        legend: {
          labels: { color: "#f5fbff" },
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${context.formattedValue}%`;
            },
          },
        },
      },
    },
  });
}

function renderVolumeChart(workoutsThisWeek) {
  const ChartConstructor = getChartConstructor();
  const volumeByMuscleGroup = {};

  workoutsThisWeek.forEach((workout) => {
    workout.exercises.forEach((exercise) => {
      const key = exercise.muscle_group || "Unspecified";
      volumeByMuscleGroup[key] = (volumeByMuscleGroup[key] || 0) + exercise.sets.length;
    });
  });

  const labels = Object.keys(volumeByMuscleGroup);
  const values = Object.values(volumeByMuscleGroup);

  chartInstances.volume = new ChartConstructor(dom.volumeChart, {
    type: "bar",
    data: {
      labels: labels.length ? labels : ["No workouts"],
      datasets: [
        {
          label: "Total Sets",
          data: values.length ? values : [0],
          backgroundColor: ["#68e4ff", "#d6f7ff", "#8da0b3", "#9ee9ff", "#c6fbff", "#eafcff"],
          borderRadius: 12,
        },
      ],
    },
    options: buildSharedChartOptions("Sets"),
  });
}

function destroyAllCharts() {
  Object.keys(chartInstances).forEach((chartKey) => {
    if (chartInstances[chartKey]) {
      chartInstances[chartKey].destroy();
      chartInstances[chartKey] = null;
    }
  });
}

function buildSharedChartOptions(yAxisLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        labels: {
          color: "#f5fbff",
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: "#98acbc",
        },
        grid: {
          color: "rgba(255, 255, 255, 0.04)",
        },
      },
      y: {
        ticks: {
          color: "#98acbc",
        },
        grid: {
          color: "rgba(255, 255, 255, 0.04)",
        },
        title: {
          display: true,
          text: yAxisLabel,
          color: "#98acbc",
        },
      },
    },
  };
}

/*
  ---------------------------------------------------------------------------
  History tables
  ---------------------------------------------------------------------------
*/

function renderHistoryTables() {
  const dailyLogs = [...appState.dailyLogs].sort(sortByDateDesc);
  const workoutLogs = [...appState.workoutLogs].sort(sortByDateDesc);

  if (!appState.currentUser) {
    dom.dailyHistoryBody.innerHTML =
      `<tr><td colspan="10" class="empty-state">Sign in to load daily history.</td></tr>`;
    dom.workoutHistoryBody.innerHTML =
      `<tr><td colspan="5" class="empty-state">Sign in to load workout history.</td></tr>`;
    return;
  }

  dom.dailyHistoryBody.innerHTML = dailyLogs.length
    ? dailyLogs
        .map(
          (log) => `
            <tr>
              <td>${escapeHtml(log.date)}</td>
              <td>${formatMaybeNumber(log.weight)}</td>
              <td>${formatMaybeNumber(log.calories)}</td>
              <td>${formatMaybeNumber(log.macros.protein)}</td>
              <td>${escapeHtml(formatMacroHistory(log))}</td>
              <td>${formatMaybeNumber(log.steps)}</td>
              <td>${escapeHtml(formatWaterHistory(log))}</td>
              <td>${formatMaybeNumber(log.sleep)}</td>
              <td>${formatMaybeNumber(log.energy)}</td>
              <td>${escapeHtml(log.notes || "-")}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="10" class="empty-state">No daily logs saved yet.</td></tr>`;

  dom.workoutHistoryBody.innerHTML = workoutLogs.length
    ? workoutLogs
        .map((log) => {
          const totalSets = log.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
          return `
            <tr>
              <td>${escapeHtml(log.date)}</td>
              <td>${escapeHtml(log.session_type || "-")}</td>
              <td>${formatMaybeNumber(log.duration)} min</td>
              <td>${escapeHtml(String(log.exercises.length))}</td>
              <td>${escapeHtml(String(totalSets))}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5" class="empty-state">No workout logs saved yet.</td></tr>`;
}

/*
  ---------------------------------------------------------------------------
  Legacy CSV import
  ---------------------------------------------------------------------------
*/

function parseLegacyCsv(csvText) {
  const rows = csvText
    .trim()
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);

  if (rows.length < 2) {
    throw new Error("The CSV file must include a header row and at least one data row.");
  }

  const headers = splitCsvRow(rows[0]).map((header) => header.trim().toLowerCase());
  const requiredHeaders = ["date", "weight", "calories", "protein", "carbs", "fat"];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    throw new Error(`Missing CSV columns: ${missingHeaders.join(", ")}.`);
  }

  return rows.slice(1).map((row, index) => {
    const values = splitCsvRow(row);
    const rowObject = Object.fromEntries(
      headers.map((header, position) => [header, values[position] ?? ""])
    );
    const normalizedDate = normalizeCsvDate(rowObject.date);

    if (!normalizedDate) {
      throw new Error(`Invalid date in CSV row ${index + 2}. Use YYYY-MM-DD or a parseable date value.`);
    }

    const macros = {
      protein: toNumberOrNull(rowObject.protein),
      carbs: toNumberOrNull(rowObject.carbs),
      fat: toNumberOrNull(rowObject.fat),
    };

    return {
      date: normalizedDate,
      weight: toNumberOrNull(rowObject.weight),
      calories: toNumberOrNull(rowObject.calories),
      macros,
      macroPercentages: deriveMacroPercentages(toNumberOrNull(rowObject.calories), macros),
      steps: null,
      sleep: null,
      water: {
        glasses: null,
        targetGlasses: null,
        unitAmountMl: null,
      },
      energy: null,
      notes: "",
    };
  });
}

function splitCsvRow(row) {
  const values = [];
  let currentValue = "";
  let insideQuotes = false;

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    const nextCharacter = row[index + 1];

    if (character === '"' && insideQuotes && nextCharacter === '"') {
      currentValue += '"';
      index += 1;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === "," && !insideQuotes) {
      values.push(currentValue.trim());
      currentValue = "";
    } else {
      currentValue += character;
    }
  }

  values.push(currentValue.trim());
  return values;
}

/*
  ---------------------------------------------------------------------------
  Helpers
  ---------------------------------------------------------------------------
*/

function normalizeDailyLog(log) {
  const normalized = mergeDailyLogs(createEmptyDailyLog(log.date || getLocalDateString()), log);
  const derivedPercentages = deriveMacroPercentages(normalized.calories, normalized.macros);

  normalized.macroPercentages = {
    protein: normalized.macroPercentages.protein ?? derivedPercentages.protein,
    carbs: normalized.macroPercentages.carbs ?? derivedPercentages.carbs,
    fat: normalized.macroPercentages.fat ?? derivedPercentages.fat,
  };

  return normalized;
}

function normalizeWorkoutLog(log) {
  return {
    id: log.id || "",
    date: log.date || getLocalDateString(),
    session_type: (log.session_type || "").trim(),
    duration: toNumberOrNull(log.duration),
    exercises: Array.isArray(log.exercises) ? log.exercises.map(normalizeExercise).filter(Boolean) : [],
  };
}

function normalizeExercise(exercise) {
  if (!exercise) {
    return null;
  }

  const sets = Array.isArray(exercise.sets)
    ? exercise.sets
        .map((set) => ({
          reps: toNumberOrNull(set?.reps),
          weight: toNumberOrNull(set?.weight),
        }))
        .filter((set) => set.reps !== null || set.weight !== null)
    : [];

  return {
    name: (exercise.name || "").trim(),
    muscle_group: (exercise.muscle_group || "").trim(),
    sets,
  };
}

function normalizeUserSettings(settings) {
  return {
    calorieTarget: toNumberOrNull(settings?.calorieTarget) ?? DEFAULT_SETTINGS.calorieTarget,
    proteinGramTarget:
      toNumberOrNull(settings?.proteinGramTarget) ?? DEFAULT_SETTINGS.proteinGramTarget,
    macroTarget: {
      protein:
        toNumberOrNull(settings?.macroTarget?.protein) ?? DEFAULT_SETTINGS.macroTarget.protein,
      carbs: toNumberOrNull(settings?.macroTarget?.carbs) ?? DEFAULT_SETTINGS.macroTarget.carbs,
      fat: toNumberOrNull(settings?.macroTarget?.fat) ?? DEFAULT_SETTINGS.macroTarget.fat,
    },
    waterTargetGlasses:
      toNumberOrNull(settings?.waterTargetGlasses) ?? DEFAULT_SETTINGS.waterTargetGlasses,
    waterUnitAmountMl:
      toNumberOrNull(settings?.waterUnitAmountMl) ?? DEFAULT_SETTINGS.waterUnitAmountMl,
  };
}

function cloneDefaultSettings() {
  return clonePlainData(DEFAULT_SETTINGS);
}

function buildMacroPayloadFromInputs(
  calories,
  proteinInput,
  carbInput,
  fatInput,
  macroMode = "percentage",
  isPreview = false
) {
  const hasCalories = isNumber(calories) && calories > 0;
  const hasProtein = isNumber(proteinInput);
  const hasCarbs = isNumber(carbInput);
  const hasFat = isNumber(fatInput);
  const hasAnyMacro = hasProtein || hasCarbs || hasFat;
  const hasAllMacros = hasProtein && hasCarbs && hasFat;

  if (!hasAnyMacro) {
    return {
      calories: hasCalories ? calories : null,
      macros: { protein: null, carbs: null, fat: null },
      macroPercentages: { protein: null, carbs: null, fat: null },
      assignedPercent: null,
      remainingPercent: null,
    };
  }

  if (!hasAllMacros) {
    return {
      error: isPreview
        ? "Enter protein, carbs, and fat to validate macro math."
        : "Please enter protein, carbs, and fat before saving macros.",
    };
  }

  if ([proteinInput, carbInput, fatInput].some((value) => value < 0)) {
    return {
      error: "Macro values cannot be negative.",
    };
  }

  if (macroMode === "grams") {
    const calculatedCalories = calculateMacroCaloriesFromGrams({
      protein: proteinInput,
      carbs: carbInput,
      fat: fatInput,
    });
    const resolvedCalories = hasCalories ? calories : Math.round(calculatedCalories);

    if (hasCalories && Math.abs(calories - calculatedCalories) > MACRO_CALORIE_MARGIN) {
      return {
        error:
          `Macro grams calculate to ${Math.round(calculatedCalories)} calories ` +
          `(protein ${proteinInput}g x 4 + carbs ${carbInput}g x 4 + fat ${fatInput}g x 9), ` +
          `but Total Calories is ${Math.round(calories)}. Adjust calories or macros before saving.`,
      };
    }

    return {
      calories: resolvedCalories,
      macros: {
        protein: proteinInput,
        carbs: carbInput,
        fat: fatInput,
      },
      macroPercentages: deriveMacroPercentages(resolvedCalories, {
        protein: proteinInput,
        carbs: carbInput,
        fat: fatInput,
      }),
      assignedPercent: hasCalories ? roundToOneDecimal((calculatedCalories / calories) * 100) : 100,
      remainingPercent: hasCalories ? roundToOneDecimal(100 - (calculatedCalories / calories) * 100) : 0,
      calculatedCalories,
      autoCalculatedCalories: !hasCalories,
    };
  }

  const assignedPercent = proteinInput + carbInput + fatInput;

  if (Math.abs(assignedPercent - 100) > 0.01) {
    return {
      error: `Macro percentages must add up to exactly 100%. Current total: ${roundToOneDecimal(assignedPercent)}%.`,
    };
  }

  if (!hasCalories) {
    return {
      error: isPreview
        ? "Enter calories to convert macro percentages."
        : "Please enter total calories before saving percentage-based macros.",
    };
  }

  const macros = {
    protein: roundToOneDecimal(((calories * proteinInput) / 100) / 4),
    carbs: roundToOneDecimal(((calories * carbInput) / 100) / 4),
    fat: roundToOneDecimal(((calories * fatInput) / 100) / 9),
  };

  const macroPercentages = {
    protein: proteinInput,
    carbs: carbInput,
    fat: fatInput,
  };

  return {
    calories,
    macros,
    macroPercentages,
    assignedPercent: roundToOneDecimal(assignedPercent),
    remainingPercent: roundToOneDecimal(100 - assignedPercent),
  };
}

function calculateMacroCaloriesFromGrams(macros) {
  return (macros.protein * 4) + (macros.carbs * 4) + (macros.fat * 9);
}

function deriveMacroPercentages(calories, macros) {
  if (!isNumber(calories) || calories <= 0) {
    return {
      protein: null,
      carbs: null,
      fat: null,
    };
  }

  return {
    protein: isNumber(macros?.protein) ? roundToOneDecimal(((macros.protein * 4) / calories) * 100) : null,
    carbs: isNumber(macros?.carbs) ? roundToOneDecimal(((macros.carbs * 4) / calories) * 100) : null,
    fat: isNumber(macros?.fat) ? roundToOneDecimal(((macros.fat * 9) / calories) * 100) : null,
  };
}

function mergeDailyLogs(baseLog, incomingLog) {
  return {
    date: incomingLog.date || baseLog.date,
    weight: toNumberOrNull(incomingLog.weight) ?? baseLog.weight ?? null,
    calories: toNumberOrNull(incomingLog.calories) ?? baseLog.calories ?? null,
    macros: {
      protein: toNumberOrNull(incomingLog.macros?.protein) ?? baseLog.macros.protein ?? null,
      carbs: toNumberOrNull(incomingLog.macros?.carbs) ?? baseLog.macros.carbs ?? null,
      fat: toNumberOrNull(incomingLog.macros?.fat) ?? baseLog.macros.fat ?? null,
    },
    macroPercentages: {
      protein:
        toNumberOrNull(incomingLog.macroPercentages?.protein) ??
        baseLog.macroPercentages.protein ??
        null,
      carbs:
        toNumberOrNull(incomingLog.macroPercentages?.carbs) ??
        baseLog.macroPercentages.carbs ??
        null,
      fat:
        toNumberOrNull(incomingLog.macroPercentages?.fat) ??
        baseLog.macroPercentages.fat ??
        null,
    },
    steps: toNumberOrNull(incomingLog.steps) ?? baseLog.steps ?? null,
    sleep: toNumberOrNull(incomingLog.sleep) ?? baseLog.sleep ?? null,
    water: {
      glasses: toNumberOrNull(incomingLog.water?.glasses) ?? baseLog.water.glasses ?? null,
      targetGlasses:
        toNumberOrNull(incomingLog.water?.targetGlasses) ?? baseLog.water.targetGlasses ?? null,
      unitAmountMl:
        toNumberOrNull(incomingLog.water?.unitAmountMl) ?? baseLog.water.unitAmountMl ?? null,
    },
    energy: toNumberOrNull(incomingLog.energy) ?? baseLog.energy ?? null,
    notes:
      typeof incomingLog.notes === "string"
        ? incomingLog.notes.trim()
        : typeof baseLog.notes === "string"
          ? baseLog.notes
          : "",
  };
}

function createEmptyDailyLog(date) {
  return {
    date,
    weight: null,
    calories: null,
    macros: {
      protein: null,
      carbs: null,
      fat: null,
    },
    macroPercentages: {
      protein: null,
      carbs: null,
      fat: null,
    },
    steps: null,
    sleep: null,
    water: {
      glasses: null,
      targetGlasses: null,
      unitAmountMl: null,
    },
    energy: null,
    notes: "",
  };
}

function upsertDailyLogInState(dailyLog) {
  const nextLogs = [...appState.dailyLogs];
  const existingIndex = nextLogs.findIndex((log) => log.date === dailyLog.date);

  if (existingIndex >= 0) {
    nextLogs[existingIndex] = dailyLog;
  } else {
    nextLogs.push(dailyLog);
  }

  appState.dailyLogs = nextLogs.sort(sortByDateAsc);
}

function upsertWorkoutLogInState(workoutLog) {
  appState.workoutLogs = [...appState.workoutLogs, workoutLog].sort(sortByDateAsc);
}

function buildDailyLogMap(logs) {
  return Object.fromEntries(logs.map((log) => [log.date, log]));
}

function getAvailableWeekOptions(dailyLogs, workoutLogs) {
  const uniqueWeeks = new Map();
  const allDates = [
    ...dailyLogs.map((log) => log.date),
    ...workoutLogs.map((log) => log.date),
    getLocalDateString(),
  ];

  allDates.forEach((dateString) => {
    const weekInfo = getWeekInfoForDate(dateString);
    uniqueWeeks.set(weekInfo.key, weekInfo);
  });

  return Array.from(uniqueWeeks.values()).sort((left, right) =>
    right.start.localeCompare(left.start)
  );
}

function getCurrentWeekKey() {
  return getWeekInfoForDate(getLocalDateString()).key;
}

function getWeekInfoForDate(dateInput) {
  const date = toDateAtNoon(dateInput);
  const day = date.getDay();
  const distanceFromMonday = (day + 6) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - distanceFromMonday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const isoInfo = getIsoWeekInfo(weekStart);

  return {
    key: `${isoInfo.year}-W${String(isoInfo.week).padStart(2, "0")}`,
    label: `Week ${isoInfo.week}, ${isoInfo.year}`,
    start: getLocalDateString(weekStart),
    end: getLocalDateString(weekEnd),
    week: isoInfo.week,
    year: isoInfo.year,
  };
}

function getPreviousWeekInfo(weekInfo) {
  return getWeekInfoForDate(shiftDateString(weekInfo.start, -7));
}

function getIsoWeekInfo(dateInput) {
  const date = toDateAtNoon(dateInput);
  const thursday = new Date(date);
  thursday.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));

  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const diffInDays = Math.round((thursday - firstThursday) / 86400000);
  const week = 1 + Math.floor((diffInDays + ((firstThursday.getDay() + 6) % 7)) / 7);

  return {
    year: thursday.getFullYear(),
    week,
  };
}

function filterLogsByWindow(logs, weekInfo) {
  return logs.filter((log) => log.date >= weekInfo.start && log.date <= weekInfo.end);
}

function getDateStringsInRange(startDate, endDate) {
  const dates = [];
  const cursor = toDateAtNoon(startDate);
  const end = toDateAtNoon(endDate);

  while (cursor <= end) {
    dates.push(getLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function shiftDateString(dateString, offsetDays) {
  const date = toDateAtNoon(dateString);
  date.setDate(date.getDate() + offsetDays);
  return getLocalDateString(date);
}

function formatLongDate(dateInput) {
  const date = dateInput instanceof Date ? dateInput : toDateAtNoon(dateInput);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatShortDateLabel(dateInput) {
  const date = toDateAtNoon(dateInput);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function getLocalDateString(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : toDateAtNoon(dateInput);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeCsvDate(value) {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return getLocalDateString(parsed);
}

function getWaterLitersFromLog(log, settings) {
  const glasses = toNumberOrNull(log?.water?.glasses);
  const unitAmountMl =
    toNumberOrNull(log?.water?.unitAmountMl) ?? toNumberOrNull(settings?.waterUnitAmountMl);

  if (!isNumber(glasses) || !isNumber(unitAmountMl)) {
    return null;
  }

  return roundToOneDecimal((glasses * unitAmountMl) / 1000);
}

function getWaterTargetLiters(log, settings) {
  const targetGlasses =
    toNumberOrNull(log?.water?.targetGlasses) ?? toNumberOrNull(settings?.waterTargetGlasses);
  const unitAmountMl =
    toNumberOrNull(log?.water?.unitAmountMl) ?? toNumberOrNull(settings?.waterUnitAmountMl);

  if (!isNumber(targetGlasses) || !isNumber(unitAmountMl)) {
    return null;
  }

  return roundToOneDecimal((targetGlasses * unitAmountMl) / 1000);
}

function getMacroCaloriesBreakdown(log) {
  return {
    protein: isNumber(log.macros.protein) ? log.macros.protein * 4 : 0,
    carbs: isNumber(log.macros.carbs) ? log.macros.carbs * 4 : 0,
    fat: isNumber(log.macros.fat) ? log.macros.fat * 9 : 0,
  };
}

function buildOfflinePreviewUser(profile = {}) {
  return {
    uid: "offline-preview",
    displayName: profile.displayName?.trim() || "Offline Preview",
    email: profile.email || "preview@health-ledger.local",
    photoURL: profile.photoURL || "",
  };
}

function readOfflinePreviewWorkspace() {
  try {
    const rawValue = localStorage.getItem(OFFLINE_PREVIEW_STORAGE_KEY);
    const parsed = rawValue ? JSON.parse(rawValue) : {};
    return {
      userSettings: normalizeUserSettings(parsed.userSettings || DEFAULT_SETTINGS),
      dailyLogs: Array.isArray(parsed.dailyLogs) ? parsed.dailyLogs : [],
      workoutLogs: Array.isArray(parsed.workoutLogs) ? parsed.workoutLogs : [],
      profile: parsed.profile || {},
    };
  } catch (error) {
    console.error(error);
    return {
      userSettings: cloneDefaultSettings(),
      dailyLogs: [],
      workoutLogs: [],
      profile: {},
    };
  }
}

function persistOfflinePreviewWorkspace() {
  if (!appState.previewMode) {
    return;
  }

  try {
    localStorage.setItem(
      OFFLINE_PREVIEW_STORAGE_KEY,
      JSON.stringify({
        userSettings: appState.userSettings,
        dailyLogs: appState.dailyLogs,
        workoutLogs: appState.workoutLogs,
        profile: {
          displayName: appState.currentUser?.displayName || "Offline Preview",
          email: appState.currentUser?.email || "preview@health-ledger.local",
          photoURL: appState.currentUser?.photoURL || "",
        },
      })
    );
  } catch (error) {
    console.error(error);
  }
}

function generateOfflineId() {
  return globalThis.crypto?.randomUUID?.() || `offline-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function getFriendlyUserName(user) {
  return user.displayName?.trim() || user.email?.split("@")[0] || "there";
}

function normalizeEmail(value) {
  return (value || "").trim().toLowerCase();
}

function getChartConstructor() {
  const ChartConstructor = globalThis.Chart;

  if (!ChartConstructor) {
    throw new Error("Chart.js failed to load. Check the CDN script in index.html.");
  }

  return ChartConstructor;
}

function getActiveViewName() {
  return document.querySelector(".nav-button.active")?.dataset.view || "dashboard";
}

function requireAuthenticatedUser() {
  if (!appState.currentUser) {
    throw new Error("You must be signed in to save data.");
  }

  return appState.currentUser;
}

function toDateAtNoon(dateInput) {
  if (dateInput instanceof Date) {
    const clone = new Date(dateInput);
    clone.setHours(12, 0, 0, 0);
    return clone;
  }

  const date = new Date(`${dateInput}T12:00:00`);
  date.setHours(12, 0, 0, 0);
  return date;
}

function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value));
}

function calculateAverage(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function sortByDateAsc(left, right) {
  return left.date.localeCompare(right.date);
}

function sortByDateDesc(left, right) {
  return right.date.localeCompare(left.date);
}

function valueOrEmpty(value) {
  return value ?? "";
}

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatMaybeNumber(value) {
  return isNumber(value) ? escapeHtml(String(value)) : "-";
}

function formatNumberForDisplay(value) {
  if (!isNumber(value)) {
    return "0";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatMacroHistory(log) {
  return [
    `P ${isNumber(log.macros.protein) ? `${log.macros.protein} g` : "-"}`,
    `C ${isNumber(log.macros.carbs) ? `${log.macros.carbs} g` : "-"}`,
    `F ${isNumber(log.macros.fat) ? `${log.macros.fat} g` : "-"}`,
  ].join(" / ");
}

function formatWaterHistory(log) {
  const intake = getWaterLitersFromLog(log, appState.userSettings);
  const target = getWaterTargetLiters(log, appState.userSettings);
  const intakeText = isNumber(intake) ? `${intake.toFixed(1)} L` : "-";
  const targetText = isNumber(target) ? `${target.toFixed(1)} L` : "-";
  return `${intakeText} / ${targetText}`;
}

function formatBytes(bytes) {
  if (!isNumber(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function hashString(value) {
  return Array.from(value).reduce((hash, character) => {
    return (hash << 5) - hash + character.charCodeAt(0);
  }, 0) >>> 0;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatFirebaseError(error) {
  if (!error) {
    return "Something went wrong.";
  }

  const code = typeof error.code === "string" ? error.code.replace("auth/", "").replace("firestore/", "") : "";
  if (!code) {
    return error.message || "Something went wrong.";
  }

  return code
    .split(/[-_/]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
