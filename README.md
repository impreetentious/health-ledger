# Health Ledger

A Firebase-backed Vanilla JS health tracker with daily logging, workout history, charts, cloud sync and an offline preview mode. There is no build step; the browser loads the ES modules directly.

## How to Use

- **Signed in.** With Firebase configured, your data lives in Cloud Firestore under your own account and syncs across devices.
- **Offline preview.** Without Firebase — or when the browser is offline, or the page was opened from a local file — the app still runs against a local workspace held in `localStorage`. Nothing syncs and nothing leaves the device. This is separate from the Firestore browser cache described below.

## Stack

- HTML
- CSS
- Vanilla JavaScript (ES modules)
- Chart.js
- Firebase Authentication
- Cloud Firestore
- EmailJS
- Progressive Web App shell (manifest + service worker)

## Local Setup

The app itself needs only a web server. Repository checks use Node `24.21.0` and npm `11.19.0`; `.nvmrc` and `packageManager` record those versions, while `engine-strict` rejects Node versions outside the supported `>=22.13.0` range during installation.

1. Serve the repository over HTTP. ES modules will not load from `file://`, so open it through a server:

   ```bash
   python3 -m http.server 8000
   ```

   or

   ```bash
   npx serve .
   ```

2. Set your deploy-time configuration. The recommended local workflow uses the gitignored override
   so deployment values do not land in a tracked file:
   - copy the template: `cp js/runtime-config.local.example.js js/runtime-config.local.js`
   - edit `js/runtime-config.local.js`, using
     [`js/runtime-config.local.example.js`](js/runtime-config.local.example.js) as the reference

   Alternatively, edit the git-tracked [`js/runtime-config.js`](js/runtime-config.js) or the
   placeholders in [`js/config.js`](js/config.js) directly — but avoid committing real values if you do.

3. Provide:
   - Firebase web app config
   - EmailJS public key
   - EmailJS service and template IDs
4. Deploy [`firestore.rules`](firestore.rules) to the same Firebase project before
   allowing real accounts. The rules restrict every `users/{uid}` workspace path
   to its authenticated owner.
5. Open the served app URL in your browser.

If Firebase is not configured yet, the app still loads and explains that cloud sign-in is unavailable and offers offline preview instead.

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
    // Optional and intentionally off by default: only enable on a trusted
    // personal device because Firestore's browser cache survives sessions.
    enableOfflinePersistence: false,
  },
  emailjs: {
    publicKey: "...",
    serviceId: "...",
    welcomeTemplateId: "...",
    leavingTemplateId: "...",
  },
};
```

### Firestore Offline Cache

The app can use Firestore's persistent browser cache for instant warm starts
and queued writes during short network interruptions. It is intentionally
**off by default** because this is health data and the cache survives browser
sessions. Set `firebase.enableOfflinePersistence: true` only for a trusted
personal device; supported browsers coordinate multiple tabs automatically.
This cloud cache is separate from Offline Preview mode, which remains a local,
explicit preview workspace.

## Verify

Install exactly what the lockfile declares, then run the repository checks and a full dependency
audit:

```bash
npm ci
npm audit --audit-level=high
npm run check:version
npm run format:check
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
```

The end-to-end suite uses Chromium and includes an axe accessibility check. There is no production
build step: the browser consumes the tracked HTML, CSS and ES modules directly.

Manual smoke test after a change:

- Auth overlay appears on load
- Offline preview still opens when local-file auth is unavailable
- Daily log entry saves and re-renders
- Workout entry saves and appears in history
- Settings update dashboard targets
- JSON backup export and import both work
- Charts render without module import errors
- If explicitly enabled on a trusted device, a reload can hydrate the Firestore cache offline
- Profile, preferences and logout flows still open and close correctly

## Data and Backups

- Firestore layout: `users/{uid}/dailyLogs/{YYYY-MM-DD}` (one document per date), `users/{uid}/workoutLogs/{autoId}`, `users/{uid}/meta/settings` and the `users/{uid}` profile document. Offline preview mirrors the same shapes in `localStorage`.
- The full daily form saves with **replace** semantics — cleared fields become null. Quick-water, CSV import and backup import use **merge** semantics, so omitted fields keep their existing values.
- Backup export and import use a versioned JSON schema. Imports are validated: a backup must be a JSON object carrying at least one of `userSettings`, `dailyLogs` or `workoutLogs`, with correct types and calendar-valid `YYYY-MM-DD` dates. A newer, unsupported schema version is left untouched and reported rather than partially applied.

## Privacy and Security

- Firestore rules scope each workspace to its authenticated user, but the data is not end-to-end encrypted by this application. Firebase project owners and the configured Firebase services retain their normal administrative capabilities.
- When EmailJS is configured, welcome and account-deletion emails send the account's display name and email address to EmailJS; health logs are not included.
- Offline preview uses unencrypted `localStorage`. Anyone with access to the same browser profile and scripts running on the same origin, may be able to read it.
- Optional Firestore persistence uses the browser's IndexedDB storage and can remain after sign-out. Enable it only on a trusted personal device.
- Exported JSON backups are unencrypted and contain account metadata and health records. Store and share them as sensitive files.
- Dashboard trend flags are informational summaries of entered data, not medical advice or a diagnosis.

## Module Conventions

- `index.html` loads Chart.js, EmailJS and `js/bootstrap.js`; the bootstrap loads optional runtime configuration before the application module
- `js/app.js` orchestrates the app and binds events — it is the only module that coordinates across subsystems
- `js/config.js` owns deploy-time configuration and shared constants
- `js/firebase.js` owns Firebase initialization
- `js/auth.js` handles auth and EmailJS helpers; it stays free of DOM manipulation
- `js/db.js` owns Firestore and offline-preview persistence; it stays free of DOM manipulation
- `js/ui.js` owns visible UI state updates
- `js/forms.js`, `js/dashboard.js` and `js/history.js` own view-specific behavior
- `js/utils.js` contains pure helpers and stays side-effect-free
- `js/dom.js` caches DOM references
- `js/state.js` owns in-memory application state

If a new feature spans views, add a behavior-specific module rather than growing `app.js` back into a monolith.

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/impreetentious/health-ledger). Open an issue before anything substantial, keep changes focused and leave the checks under [Verify](#verify) green.

## License

Apache-2.0 © 2024-2026 Sidakpreet Singh — see [LICENSE](LICENSE).

---

**Version:** v2.9.3
