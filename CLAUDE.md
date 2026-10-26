# ChordsApp — instructions for Claude (read fully before touching anything)

This repo (`talbus96-pixel/chords-app`) IS the app. Its root is served as-is by GitHub Pages:
**https://talbus96-pixel.github.io/chords-app/**. A commit to `main` goes live in ~1-2 minutes.
The owner uses it on the phone as an app installed from Chrome (PWA). The old Android APK
(Capacitor) is abandoned — do not work on it.

---

## 0. How to work with the owner (most important)

The owner (Tal) has ~0% programming knowledge and often works from the phone.

1. **Language: Hebrew.** Code, file names and commands stay in English.
2. **Hebrew style: imperative instructions** ("לחץ", "פתח", "העלה"), never present-tense
   narration ("אני עכשיו בודק..."). The owner explicitly asked for this.
3. **Micro-steps** for anything the owner must do. Never assume they know what a branch,
   a commit, a PR or a terminal is.
4. **No building before a green light ("אור ירוק").** Explain options simply, recommend one,
   wait. Do NOT add unrequested features/refactors. Fixing a bug the owner reported is fine.
   (Once Claude built an unrequested auto-scroll and the owner was upset.)
5. **Be honest about what was and was not tested** (stubbed Firebase vs. real phone).
6. **Going live:** after the owner approves a change, commit it to `main` (or open a PR and
   tell the owner exactly which button to press to merge). Then tell them: wait 2 minutes,
   reopen the app (on the phone: ⋮ → refresh). Always say what to check.

---

## 1. What the app is

Personal chord-sheet app (Hebrew + English songs), UI in Hebrew/RTL:
- Search a song -> server scrapes chords from Tab4U / E-Chords.
- Personal library: tree of folders and songs, separate Hebrew and English libraries
  (English library flips the sidebar to the left/LTR).
- Transposition, font size, Google login, cloud sync (Firestore), offline copies, PWA offline.
- Design: "Irish souvenir" theme (parchment, Irish green, gold). Fonts: Amatic SC (titles),
  Rubik (UI) from Google Fonts. Theme variables in the "מזכרת אירית" block of `style.css`.

## 2. Files and services

```
repo root (= website):
  index.html, style.css
  app.js            <- all UI/library logic (classic script)
  firebase-sync.js  <- Google login + Firestore sync (type="module")
  sw.js             <- service worker: network-first for own files, cache-first for
                       gstatic firebasejs + Google Fonts. Bump CACHE ("chords-vN") when
                       changing it. Each file is cached separately (a 404 must not break install).
  manifest.webmanifest, icons/icon-192.png, icons/icon-512.png
  CLAUDE.md (this file)

Other repo: talbus96-pixel/chords-scraper (private) -> scraper.js, deployed by Render.com
  "chords-scraper" (https://chords-scraper.onrender.com), auto-deploy on commit to main.
  UptimeRobot pings /health every 5 min so it does not sleep.
Firebase project "chordsapp-e4a85": Auth (Google) + Firestore.
  Authorized domain: talbus96-pixel.github.io.
```

- Firebase Web SDK 10.8.1 from `https://www.gstatic.com/firebasejs/10.8.1/...` (ES modules;
  must be served over http(s)).
- Web OAuth clientId: `678717011887-3gh7chfl1fc8j3d10g0fma01h4qltnfb.apps.googleusercontent.com`.
- Firestore uses `initializeFirestore(app, { experimentalForceLongPolling: true })` — needed:
  on the owner's phone the default transport failed ("client is offline" / endless ⏳).
- The repo must stay **public** (GitHub Pages on a free plan). It once became private and the
  site returned 404.

## 3. Data model and storage

Library tree: `{ id, type: "folder"|"file", name (folder) / title (song), color, isExpanded,
content, source, children: [...] }`. Root `id: "root"`. Two libraries `libs.he`, `libs.en`;
`myLibrary` = active one (`activeLang`, localStorage `activeLibLang`). Song language =
Hebrew-letter regex on title+content (`songLang`). Folder colors: `PRESET_COLORS` (Irish
palette), `DEFAULT_FOLDER_COLOR` = `#1f6b3a`.

localStorage (per origin):
- `chordLibraryData` / `_en` — guest libraries = the active offline copy.
- `chordLibraryData_<uid>` / `_en` — local mirror of the logged-in user.
- `offlineCopies` (max 5), `offlineActiveId` (set + not logged in => read-only mode).
- `pendingSync_<uid>` — timestamp of a local change not yet acknowledged by the cloud.
- `cloudBase_<uid>` — last library known to be in the cloud (base for 3-way merge).
- `songFontSize`, `activeLibLang`.

Firestore: `users_libraries/<uid>` with `libraryData` (he), `libraryDataEn` (en),
`lastUpdated`. Rules: read/write only if `request.auth.uid == userId`.

## 4. Cloud sync rules (do not break)

- `cloudReady` is true only after a **server-confirmed** snapshot; nothing is written before.
- Snapshots with `hasPendingWrites` are ignored.
- On login `window.loadUserLibrariesForStart(email)` shows the user's local mirror at once
  (offline copy only if it belongs to the same e-mail, else empty) until the cloud answers.
- `saveLibrary()` = persistLocal + render + `markPendingSync()` + `saveLibraryToCloud()`.
  Folder expand/collapse uses `saveLocalOnly()` (no cloud write).
- Confirmed snapshot + pending changes (or first run on a device = no `cloudBase`, unless the
  active offline copy belongs to another e-mail) => `window.mergeLibraries(cloud, local, base)`
  (3-way: local adds/edits/deletes kept, remote deletes respected; no base = union, cloud wins
  conflicts), applied and written. Cache snapshots are ignored while pending.
- No confirmed snapshot after 15 s => `getDocFromServer`; result is applied or its error shown
  in `#syncError` (friendly Hebrew text when `navigator.onLine === false`).
- `readGuestLibraries()` returns nulls when an offline copy is active (no cross-account upload).
- If the Firestore schema changes, every open device must get the new version (warn the owner).

## 5. Search / scraper (repo chords-scraper)

- `GET /scrape?q=...[&source=echords|tab4u]` -> `{title, source, content}`; `GET /health`.
- Hebrew -> Tab4U. Other -> Tab4U "quick" (plain HTTP, only if all words match), then E-Chords,
  then Tab4U. Tab4U: plain HTTP + cheerio (`resultsSimple?tab=songs&q=`, links
  `tabs/songs/...`, best word match, content from `#songContentTPL` table rows), Puppeteer
  fallback. Real title from the song URL. ~1-2 s.
- E-Chords blocks plain HTTP (403) => Puppeteer (one browser at a time, queue max 4, lean
  flags; Render free = 512MB). HTTP attempt skipped for 6 h after a 403. 12 h result cache.
- The app pings `/health` on open and on search focus.
- Scraping is for personal use only; don't expand it.

## 6. Testing (reuse this)

Stub Firebase with an import map in a test copy of `index.html`:
`{"imports": {"https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js": "./stub/app.js", ...}}`
with stub modules for app / auth (`onAuthStateChanged`, a `__login(user)` helper) / firestore
(`initializeFirestore`, `doc`, `setDoc` recording writes, `onSnapshot` with a `__snap(data,
{fromCache})` helper, `getDocFromServer`). Test: no writes before confirmation, merge after
offline edits, first-run rescue, no cross-account copy, folder toggle = no write, `#syncError`.
`mergeLibraries` can be unit-tested in Node by extracting it from `app.js`.

## 7. Ideas list (none started without approval)

Proposed to the owner: pick from 5 search results instead of the first; search inside the
library; keep the screen awake while a song is open; auto-scroll; colored chords; night/stage
mode; tap a chord to see its diagram; store transposition as a setting (keep the original);
manual song editing; set lists; export backup file; share a song.
Known: Tab4U sometimes picks the wrong song for vague queries (motivation for the results list).
