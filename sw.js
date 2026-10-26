// Service worker: מאפשר להתקין את האתר כאפליקציה מכרום, ולפתוח אותו גם בלי אינטרנט.
// הקבצים של האפליקציה נטענים קודם מהרשת (כדי שעדכונים יופיעו מיד), ורק אם אין רשת - מהעותק השמור.
const CACHE = "chords-v4";
const CORE = ["./", "./index.html", "./style.css", "./app.js", "./firebase-sync.js",
    "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (event) => {
    // כל קובץ נשמר בנפרד: קובץ אחד חסר לא מפיל את כל ההתקנה
    event.waitUntil(caches.open(CACHE)
        .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {}))))
        .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// ספריות Firebase וגופנים: הכתובת כוללת גרסה ולא משתנה, אז מהעותק השמור קודם
function isStaticLib(url) {
    return url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")
        || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);

    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(req).then((res) => {
                if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
                return res;
            }).catch(() => caches.match(req, { ignoreSearch: true })
                .then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
        );
        return;
    }

    if (isStaticLib(url)) {
        event.respondWith(
            caches.match(req).then((hit) => hit || fetch(req).then((res) => {
                if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
                return res;
            }))
        );
    }
    // כל השאר (שרת החיפוש, הענן של Firebase, ההתחברות) - עובר כרגיל, בלי שמירה
});
