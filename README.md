# Health Ledger

A Firebase-backed vanilla JavaScript health tracker with daily logging, workout history, charts, cloud sync and an offline preview mode. There is no build step — the browser loads the ES modules directly.

## Two ways to use it

- **Signed in.** With Firebase configured, your data lives in Cloud Firestore under your own account and syncs across devices.
- **Offline preview.** Without Firebase — or when the browser is offline, or the page was opened from a local file — the app still runs against a local workspace held in `localStorage`. Nothing syncs, and nothing leaves the device. This is separate from the Firestore browser cache described below.

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript (ES modules)
- Chart.js
- Firebase Authentication
- Cloud Firestore
- EmailJS
- Progressive Web App shell (manifest + service worker)

## Local Setup

Requires Node `>=20.10` only if you want to run the tests; the app itself needs nothing but a web server. `.nvmrc` pins `20.20.0`, and `engine-strict` makes `npm ci` fail outright on a version outside the declared range rather than warning.

1. Serve the repository over HTTP. ES modules will not load from `file://`, so open it through a server:

   ```bash
   python3 -m http.server 8000
   ```

   or

   ```bash
   npx serve .
   ```

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
4. Deploy [`firestore.rules`](firestore.rules) to the same Firebase project before
   allowing real accounts. The rules restrict every `users/{uid}` workspace path
   to its authenticated owner.
5. Open the served app URL in your browser.

If Firebase is not configured yet, the app still loads and explains that cloud sign-in is unavailable, and offers offline preview instead.

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

### Firestore offline cache

The app can use Firestore's persistent browser cache for instant warm starts
and queued writes during short network interruptions. It is intentionally
**off by default** because this is health data and the cache survives browser
sessions. Set `firebase.enableOfflinePersistence: true` only for a trusted
personal device; supported browsers coordinate multiple tabs automatically.
This cloud cache is separate from Offline Preview mode, which remains a local,
explicit preview workspace.

## Verify

Unit tests run on Node's built-in test runner, so they need nothing installed:

```bash
npm test
```

Formatting is checked by Prettier, the repository's only devDependency:

```bash
npm ci
npm run format:check
```

Manual smoke test after a change:

- Auth overlay appears on load
- Offline preview still opens when local-file auth is unavailable
- Daily log entry saves and re-renders
- Workout entry saves and appears in history
- Settings update dashboard targets
- JSON backup export and import both work
- Charts render without module import errors
- If explicitly enabled on a trusted device, a reload can hydrate the Firestore cache offline
- Profile, preferences, and logout flows still open and close correctly

## Data and backups

- Firestore layout: `users/{uid}/dailyLogs/{YYYY-MM-DD}` (one document per date), `users/{uid}/workoutLogs/{autoId}`, `users/{uid}/meta/settings`, and the `users/{uid}` profile document. Offline preview mirrors the same shapes in `localStorage`.
- The full daily form saves with **replace** semantics — cleared fields become null. Quick-water, CSV import and backup import use **merge** semantics, so omitted fields keep their existing values.
- Backup export and import use a versioned JSON schema. Imports are validated: a backup must be a JSON object carrying at least one of `userSettings`, `dailyLogs` or `workoutLogs`, with correct types and calendar-valid `YYYY-MM-DD` dates. A newer, unsupported schema version is left untouched and reported rather than partially applied.

## Project Structure

```text
health-ledger/
├── css/
│   └── style.css
├── fonts/
│   ├── InterVariable.woff2
│   └── OFL.txt
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
│   ├── pwa.js
│   ├── runtime-config.js
│   ├── runtime-config.local.example.js
│   ├── state.js
│   ├── ui.js
│   └── utils.js
├── test/
│   └── utils.test.js
├── favicon.svg
├── manifest.webmanifest
├── package.json
├── service-worker.js
├── index.html
└── README.md
```

## Module conventions

- `index.html` loads Chart.js, EmailJS, and runtime configuration before its `js/app.js` entry module
- `js/app.js` orchestrates the app and binds events — it is the only module that coordinates across subsystems
- `js/config.js` owns deploy-time configuration and shared constants
- `js/firebase.js` owns Firebase initialization
- `js/auth.js` handles auth and EmailJS helpers; it stays free of DOM manipulation
- `js/db.js` owns Firestore and offline-preview persistence; it stays free of DOM manipulation
- `js/ui.js` owns visible UI state updates
- `js/forms.js`, `js/dashboard.js`, and `js/history.js` own view-specific behavior
- `js/utils.js` contains pure helpers and stays side-effect-free
- `js/dom.js` caches DOM references
- `js/state.js` owns in-memory application state

If a new feature spans views, add a behavior-specific module rather than growing `app.js` back into a monolith.

## Before publishing your own copy

- Firebase web config and EmailJS public identifiers are deploy-time app configuration, not server secrets — but rotate any live values before publishing a copy that contains them.
- Tighten Firebase Authentication, Firestore rules, and EmailJS/domain restrictions in the provider dashboards.
- Deploy the versioned [`firestore.rules`](firestore.rules), and review it alongside any data-model change.

## License

MIT © Sidakpreet Singh — see [LICENSE](LICENSE).

---

**Version:** v2.7.0
