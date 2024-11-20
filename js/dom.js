/*
  dom.js — central DOM reference cache
  ---------------------------------------------------------------------------
  `dom` starts as an empty object and is populated by cacheDomReferences(),
  which app.js calls on DOMContentLoaded before any render function runs.
  All other modules import the same object reference, so they always see the
  populated version.
*/

export const dom = {};

export function cacheDomReferences() {
  dom.navButtons   = document.querySelectorAll(".nav-button");
  dom.views        = document.querySelectorAll(".view");
  dom.toastRegion   = document.getElementById("toast-region");

  // ── Topbar ──────────────────────────────────────────────────────────────
  dom.dashboardHeading      = document.getElementById("dashboard-heading");
  dom.sessionLabel          = document.getElementById("session-label");
  dom.profileShell          = document.getElementById("profile-shell");
  dom.profileTrigger        = document.getElementById("profile-trigger");
  dom.profileMenu           = document.getElementById("profile-menu");
  dom.profileName           = document.getElementById("profile-name");
  dom.profileSubtitle       = document.getElementById("profile-subtitle");
  dom.profileAvatarImage    = document.getElementById("profile-avatar-image");
  dom.profileAvatarFallback = document.getElementById("profile-avatar-fallback");
  dom.accountMenuButton     = document.getElementById("account-menu-button");
  dom.preferencesMenuButton = document.getElementById("preferences-menu-button");
  dom.logoutMenuButton      = document.getElementById("logout-menu-button");
  dom.dailyQuoteText        = document.getElementById("daily-quote-text");
  dom.dailyQuoteSource      = document.getElementById("daily-quote-source");

  // ── Dashboard ────────────────────────────────────────────────────────────
  dom.dashboardSummary    = document.getElementById("dashboard-summary");
  dom.dashboardToday      = document.getElementById("dashboard-today");
  dom.dashboardWeekTitle  = document.getElementById("dashboard-week-title");
  dom.dashboardWeekCaption = document.getElementById("dashboard-week-caption");
  dom.dashboardWeekSelect = document.getElementById("dashboard-week-select");
  dom.quickWaterProgress  = document.getElementById("quick-water-progress");
  dom.quickWaterButton    = document.getElementById("quick-water-button");
  dom.quickWaterMeter     = document.getElementById("quick-water-meter");
  dom.quickWaterMeterLabel = document.getElementById("quick-water-meter-label");
  dom.insightCards        = document.getElementById("insight-cards");
  dom.alertCards          = document.getElementById("alert-cards");
  dom.dashboardHydrationSkeleton = document.getElementById("dashboard-hydration-skeleton");
  dom.dashboardView       = document.getElementById("dashboard-view");
  dom.weeklyInsightNarrative = document.getElementById("weekly-insight-narrative");
  dom.loggingStreakCount  = document.getElementById("logging-streak-count");
  dom.consistencyCaption  = document.getElementById("consistency-caption");
  dom.consistencyHeatmap  = document.getElementById("consistency-heatmap");

  // ── Charts ───────────────────────────────────────────────────────────────
  dom.weightChart  = document.getElementById("weightChart");
  dom.calorieChart = document.getElementById("calorieChart");
  dom.proteinChart = document.getElementById("proteinChart");
  dom.stepsChart   = document.getElementById("stepsChart");
  dom.waterChart   = document.getElementById("waterChart");
  dom.macroChart   = document.getElementById("macroChart");
  dom.volumeChart  = document.getElementById("volumeChart");

  // ── Forms ────────────────────────────────────────────────────────────────
  dom.dailyForm           = document.getElementById("daily-log-form");
  dom.workoutForm         = document.getElementById("workout-log-form");
  dom.workoutSaveButton   = document.getElementById("workout-save-button");
  dom.settingsForm        = document.getElementById("settings-form");
  dom.csvImport           = document.getElementById("csv-import");
  dom.backupImport        = document.getElementById("backup-import");
  dom.importBackupButton  = document.getElementById("import-backup-button");
  dom.exportBackupButton  = document.getElementById("export-backup-button");
  dom.storageStatus       = document.getElementById("storage-status");
  dom.exerciseList        = document.getElementById("exercise-list");
  dom.addExerciseButton   = document.getElementById("add-exercise-button");
  dom.repeatLastWorkoutButton = document.getElementById("repeat-last-workout-button");
  dom.exerciseNameOptions = document.getElementById("exercise-name-options");
  dom.macroPreview        = document.getElementById("macro-preview");
  dom.dailyProteinLabel   = document.getElementById("daily-protein-label");
  dom.dailyCarbsLabel     = document.getElementById("daily-carbs-label");
  dom.dailyFatLabel       = document.getElementById("daily-fat-label");

  // ── History tables ────────────────────────────────────────────────────────
  dom.dailyHistoryBody   = document.getElementById("daily-history-body");
  dom.workoutHistoryBody = document.getElementById("workout-history-body");
  dom.historyDateFrom    = document.getElementById("history-date-from");
  dom.historyDateTo      = document.getElementById("history-date-to");
  dom.historySearch      = document.getElementById("history-search");
  dom.clearHistoryFiltersButton = document.getElementById("clear-history-filters-button");
  dom.historyFilterStatus = document.getElementById("history-filter-status");
  dom.dailyHistorySummary = document.getElementById("daily-history-summary");
  dom.workoutHistorySummary = document.getElementById("workout-history-summary");
  dom.dailyHistoryLoadMore = document.getElementById("daily-history-load-more");
  dom.workoutHistoryLoadMore = document.getElementById("workout-history-load-more");

  // ── Auth overlay ──────────────────────────────────────────────────────────
  dom.authOverlay         = document.getElementById("auth-overlay");
  dom.authForm            = document.getElementById("auth-form");
  dom.authEmail           = document.getElementById("auth-email");
  dom.authPassword        = document.getElementById("auth-password");
  dom.passwordVisibilityButton = document.getElementById("password-visibility-button");
  dom.googleSigninButton  = document.getElementById("google-signin-button");
  dom.emailSigninButton   = document.getElementById("email-signin-button");
  dom.emailSignupButton   = document.getElementById("email-signup-button");
  dom.passwordResetButton = document.getElementById("password-reset-button");
  dom.authFeedback        = document.getElementById("auth-feedback");
  dom.authEmailError      = document.getElementById("auth-email-error");
  dom.authPasswordError   = document.getElementById("auth-password-error");
  dom.offlinePreviewBlock = document.getElementById("offline-preview-block");
  dom.offlinePreviewCopy  = document.getElementById("offline-preview-copy");
  dom.offlinePreviewButton = document.getElementById("offline-preview-button");

  // ── Modals ────────────────────────────────────────────────────────────────
  dom.accountModal          = document.getElementById("account-modal");
  dom.accountForm           = document.getElementById("account-form");
  dom.accountDisplayName    = document.getElementById("account-display-name");
  dom.accountPhotoUrl       = document.getElementById("account-photo-url");
  dom.accountModalClose     = document.getElementById("account-modal-close");
  dom.accountModalCancel    = document.getElementById("account-modal-cancel");
  dom.accountDeletePassword = document.getElementById("account-delete-password");
  dom.accountDeleteButton   = document.getElementById("account-delete-button");

  dom.preferencesModal       = document.getElementById("preferences-modal");
  dom.preferencesModalClose  = document.getElementById("preferences-modal-close");
  dom.preferencesModalCancel = document.getElementById("preferences-modal-cancel");

  dom.logoutModal         = document.getElementById("logout-modal");
  dom.logoutCancelButton  = document.getElementById("logout-cancel-button");
  dom.logoutConfirmButton = document.getElementById("logout-confirm-button");

  dom.confirmationModal         = document.getElementById("confirmation-modal");
  dom.confirmationEyebrow       = document.getElementById("confirmation-eyebrow");
  dom.confirmationTitle         = document.getElementById("confirmation-title");
  dom.confirmationMessage       = document.getElementById("confirmation-message");
  dom.confirmationCancelButton  = document.getElementById("confirmation-cancel-button");
  dom.confirmationConfirmButton = document.getElementById("confirmation-confirm-button");

  // ── Loading overlay ───────────────────────────────────────────────────────
  dom.loadingOverlay = document.getElementById("app-loading");
  dom.loadingLabel   = document.getElementById("loading-label");
  dom.loadingCopy    = document.getElementById("loading-copy");
}
