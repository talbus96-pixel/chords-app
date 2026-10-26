# Shiron (formerly ChordsApp) — instructions for Claude (read fully before touching anything)

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
- Design: 3 designs chosen in ⚙️ settings: `irish` (default), `scroll` (parchment + soft rollers
  on the song card; owner LOVES it, don't change), `sea`. The owner does NOT want more designs.
  List = `window.SHIRON_THEMES` in the inline `<head>` script of index.html (also sets
  `<html data-theme>` before paint; unknown -> `irish`). irish and sea share one structure
  (`html:where([data-theme]:not([data-theme="scroll"]))` rules, low specificity so night mode
  wins) and differ by one variables line each. They are NOT pastel any more (owner: "pleasant
  colors, the background may be a gradient"): colored gradient header (`--header-bg`, white
  title), gradient page background (`--page-bg`: irish sage->cream, sea sky->sand). Button swatches: `THEME_SWATCH` in app.js.
  Base variables = the "מזכרת אירית" block; night mode (`body.night`) comes after the themes.
  The owner wants it pleasant and gentle ("not a blackjack table").
- Font: the ORIGINAL system font everywhere ("Segoe UI", Tahoma, ... sans-serif), titles too.
  No Google Fonts (owner asked to go back to the original font).

## 2. Files and services

```
repo root (= website):
  index.html, style.css
  app.js            <- all UI/library logic (classic script)
  firebase-sync.js  <- Google login + Firestore sync (type="module")
  sw.js             <- service worker: network-first for own files, cache-first for
                       gstatic firebasejs + Google Fonts. Bump CACHE ("chords-vN") when
                       changing it. Each file is cached separately (a 404 must not break install).
  manifest.webmanifest (app name: "Shiron", also in <title> and headers), icons/icon-192.png, icons/icon-512.png
  icons/source/logo.svg      <- current logo (green "C" + gold note on cream, chosen option "4A")
  icons/alt-option-3/        <- owner's second choice (guitar in gold ring), kept in case they switch
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
`myLibrary` = active one (`activeLang`, localStorage `activeLibLang`). Songs may have `transpose`
(semitones, -11..11): `content` always stays the ORIGINAL text, the display applies `transpose`.
Song language = Hebrew-letter regex on title+content (`songLang`). Folder colors: `PRESET_COLORS` (30 colors
grouped by hue, includes the original 10; the owner asked for many folder colors), `DEFAULT_FOLDER_COLOR` = `#1f6b3a`.

localStorage (per origin):
- `chordLibraryData` / `_en` — guest libraries = the active offline copy.
- `chordLibraryData_<uid>` / `_en` — local mirror of the logged-in user.
- `offlineCopies` (max 5), `offlineActiveId` (set + not logged in => read-only mode).
- `pendingSync_<uid>` — timestamp of a local change not yet acknowledged by the cloud.
- `cloudBase_<uid>` — last library known to be in the cloud (base for 3-way merge).
- `songFontSize`, `activeLibLang`, `scrollSpeed` (1-10), `colorChords` / `nightMode` ("1"/"0").

Firestore: `users_libraries/<uid>` with `libraryData` (he), `libraryDataEn` (en),
`lastUpdated`. `mergeLibraries` FIELDS include `transpose`. (A `setLists` field existed briefly in
Oct 2026; set lists were removed and the next write drops it.) Rules: read/write only if `request.auth.uid == userId`.

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

- `GET /scrape?q=...[&source=echords|tab4u]` -> `{title, source, url, content, results}` where
  `results` = up to 5 `{title, source, url}` (chosen song first); the app shows them under
  "לא השיר הנכון?". `GET /song?url=...` fetches one chosen Tab4U / E-Chords page (other hosts
  rejected, same browser fallback + cache). `GET /health`.
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

## 7. Features and ideas

**The owner wants the app MINIMAL and calm: more features = more visual load.** Keep the song
screen clean; put rarely used toggles in the ⚙️ settings panel or a ⋮ menu, not above the chords.

Song screen: the ORIGINAL two buttons "העלה חצי טון (+)" / "הורד חצי טון (-)" + "A− 13 A+"
(owner rejected a reset-to-original button and a compact "− 0 +" control), one row
"▶ גלילה 🐢 3 🐇", then the song.
Transposition is stored per song (`transpose`, original text kept; "שמור שינויים בשיר" saves it).
Other features: pick from up to 5 search results ("לא השיר הנכון?"); search inside the library
(sidebar box, title or lyrics, both libraries); screen stays awake while a song is open (Wake
Lock); auto-scroll speed 1-10; song editing from the song's ⋮ menu ("✏️ ערוך שיר"); in the
settings panel (the ⚙️ button, top corner; ids still `accountMenu` / `accountPanel`): account
(login/logout, sync status), design picker + night mode + colored chords, offline copies, backup
to a JSON file and restore (restore only ADDS what is missing, via `mergeLibraries(current, backup, null)`).

Removed at the owner's request: set lists. Not wanted: chord diagrams. Postponed: share a song.
Fixed (Oct 2026): in Hebrew (RTL) songs a chord ending in "#" at the end of a chord line showed
as "#F". `songHtml` now puts an invisible LRM (U+200E) right after the last chord of each chord
line; only lines ending in "#" (or another neutral char) change.
