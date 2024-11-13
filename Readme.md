---
> **AI Agent Protocol: Version Control**
> *Instructions for AI:* Every time you modify this repository, you MUST update the timestamp and version number below before committing your changes.
>
> **Last Commit Date:** 13-11-2024
> **Last Commit Time:** 21:05:31 IST (+05:30)
> **Base Version:** 1.0.X
> **Version:** v1.0.0
---
# Health Ledger

A Firebase-backed, vanilla JavaScript single-page application for tracking daily health metrics and workouts.

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- Chart.js
- Firebase Authentication
- Cloud Firestore

## Run Locally

1. Clone or download the repository.
2. Serve the project folder with any simple static server so browser module imports and Firebase Auth can load correctly.
3. Open the served local URL in your browser.

## Project Structure

```text
health-ledger/
├── assets/
├── css/
│   └── style.css
├── js/
│   └── app.js
├── index.html
└── README.md
```

## Notes

- The app stores user data in Firebase Auth + Cloud Firestore, scoped to the authenticated user.
- `index.html` remains in the project root to stay compatible with simple static hosting setups such as Vercel.
- The current structure leaves room for future modules such as reusable UI scripts, richer analytics, and design assets.
