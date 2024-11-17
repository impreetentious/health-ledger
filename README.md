# Health Ledger

A Firebase-backed vanilla JavaScript health tracker with daily logging, workout history, charts, cloud sync and an offline preview mode.

- `index.html` loads Chart.js, EmailJS, and runtime configuration before its `js/app.js` entry module
- `js/app.js` orchestrates the app and binds events
- `js/config.js` owns deploy-time configuration and shared constants
- `js/firebase.js` owns Firebase initialization
- `js/auth.js` handles auth and EmailJS helpers
- `js/db.js` owns Firestore and offline-preview persistence
- `js/ui.js` owns visible UI state updates
- `js/forms.js`, `js/dashboard.js`, and `js/history.js` own view-specific behavior
- `js/utils.js` contains pure helpers
- `js/dom.js` caches DOM references
- `js/state.js` owns in-memory application state

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript (ES modules)
- Chart.js
- Firebase Authentication
- Cloud Firestore
- EmailJS

## Local Setup

1. Serve the repository with a simple local web server.
2. Set your deploy-time configuration. Recommended — use the gitignored local
   override so real values never land in a git-tracked file:
   - copy the template: `cp js/runtime-config.local.example.js js/runtime-config.local.js`
   - edit [`js/runtime-config.local.js`](js/runtime-config.local.js) and fill in your real values
   Alternatively, edit the git-tracked [`js/runtime-config.js`](js/runtime-config.js) or the
   placeholders in [`js/config.js`](js/config.js) directly — but avoid committing real values if you do.
3. Provide:
   - Firebase web app config
   - EmailJS public key
   - EmailJS service and template IDs
4. Open the served app URL in your browser.

If Firebase is not configured yet, the app still loads and explains that cloud sign-in is unavailable. Offline preview mode remains available when the browser is opened from a local file or when the device is offline.

Example `js/runtime-config.local.js` (or `js/runtime-config.js`):

```js
globalThis.HEALTH_LEDGER_CONFIG = {
  firebase: {
    apiKey: "...",
    authDomain: "...",
    projectId: "...",
    storageBucket: "...",
    messagingSenderId: "...",
    appId: "...",
  },
  emailjs: {
    publicKey: "...",
    serviceId: "...",
    welcomeTemplateId: "...",
    leavingTemplateId: "...",
  },
};
```

## Project Structure

```text
health-ledger/
├── css/
│   └── style.css
├── js/
│   ├── app.js
│   ├── auth.js
│   ├── charts.js
│   ├── config.js
│   ├── dashboard.js
│   ├── db.js
│   ├── dom.js
│   ├── firebase.js
│   ├── forms.js
│   ├── history.js
│   ├── runtime-config.js
│   ├── runtime-config.local.example.js
│   ├── state.js
│   ├── ui.js
│   └── utils.js
├── index.html
└── README.md
```

## Public Repo Notes

- This repository is designed to be safe to publish after replacing any live provider settings with your own values.
- Firebase web config and EmailJS public identifiers are deploy-time app configuration, not server secrets, but you should still rotate old live values before publishing.
- Tighten Firebase Authentication, Firestore rules, and EmailJS/domain restrictions in the provider dashboards before making the repo public.
- If you rewrite history before publishing, keep the same author email if you want GitHub contribution attribution to continue linking to your account.

## Smoke-Test Checklist

- Auth overlay appears on load
- Offline preview still opens when local-file auth is unavailable
- Daily log entry saves and re-renders
- Workout entry saves and appears in history
- Settings update dashboard targets
- JSON backup export and import both work
- Charts render without module import errors
- Profile, preferences, and logout flows still open and close correctly

## Notes For Future Work

- `js/app.js` is the only module that should coordinate across subsystems.
- `js/auth.js` and `js/db.js` should stay free of DOM manipulation.
- `js/utils.js` should remain side-effect-free.
- If new features span views, add behavior-specific modules rather than growing `app.js` back into a monolith.

## AI Agent Instructions

Before making any new commits, update the Version Control string in this file with the current IST time of commit (`Asia/Kolkata`).

This IST timestamp rule is permanent for all future workflows, commits, and AI agents working in this repository.

Follow this format for version control:

* **Base Format Version:** 2.2.0
* **Version:** `v2.2.0_2024-11-18_01:55:45` (IST)
