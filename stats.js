// מונה ביקורים: כל פתיחה של האפליקציה = ביקור (מסמך אחד ב-Firestore, אוסף "visits").
// נשמר: מזהה אקראי של המכשיר, המייל (רק אם מחוברים עם גוגל), מתי התחיל, מתי נראה לאחרונה,
// כמה זמן האפליקציה הייתה פתוחה מול העיניים (רק כשהמסך גלוי), וסוג המכשיר.
// הצפייה בנתונים: רק לחשבון STATS_OWNER. ההגנה האמיתית היא בכללי האבטחה של Firestore
// (השרת מסרב לקרוא לכל אחד אחר); הכפתור והחלון נוצרים רק כשהחשבון הזה מחובר.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, setDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from "./firebase-sync.js";

const STATS_OWNER = "tal123t123@gmail.com";
const HEARTBEAT_MS = 60 * 1000;          // עדכון משך הביקור כל דקה
const NEW_VISIT_AFTER_MS = 30 * 60 * 1000; // חזרה אחרי 30 דקות ברקע = ביקור חדש

function randomId() {
    const a = new Uint8Array(9);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function visitorId() {
    try {
        let v = localStorage.getItem("shironVisitorId");
        if (!v || !/^[0-9a-f]{8,32}$/.test(v)) { v = randomId(); localStorage.setItem("shironVisitorId", v); }
        return v;
    } catch (e) { return randomId(); }
}

function deviceName() {
    const ua = navigator.userAgent || "";
    let d = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
        : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "אחר";
    try { if (window.matchMedia("(display-mode: standalone)").matches) d += " · אפליקציה"; } catch (e) {}
    return d;
}

// ---------- רישום הביקור ----------
const VID = visitorId();
const DEV = deviceName();
let visit = null;       // { id, e, s, l, d }
let visibleSince = null; // מתי המסך הפך לגלוי (לחישוב המשך)
let hiddenAt = null;
let authKnown = false;

function currentEmail() {
    const u = auth.currentUser;
    return u && u.email ? u.email : null;
}

function addVisibleTime() {
    if (visit && visibleSince !== null) {
        const now = Date.now();
        visit.d += Math.max(0, Math.round((now - visibleSince) / 1000));
        visibleSince = now;
    }
}

function writeVisit() {
    if (!visit) return;
    visit.l = Date.now();
    const data = { v: VID, e: visit.e, s: visit.s, l: visit.l, d: Math.min(visit.d, 86400), dev: DEV };
    // שגיאה כאן (למשל אין חיבור, או שכללי האבטחה עוד לא עודכנו) לא משפיעה על שום דבר אחר באפליקציה
    setDoc(doc(db, "visits", visit.id), data).catch(() => {});
}

function startVisit() {
    const s = Date.now();
    visit = { id: VID + "_" + s, e: currentEmail(), s, l: s, d: 0 };
    visibleSince = document.visibilityState === "visible" ? s : null;
    writeVisit();
}

onAuthStateChanged(auth, () => {
    const email = currentEmail();
    if (!authKnown) { authKnown = true; startVisit(); }
    else if (visit && visit.e !== email) { addVisibleTime(); writeVisit(); startVisit(); } // התחברות/התנתקות = ביקור חדש עם המייל הנכון
    refreshOwnerUI();
});

setInterval(() => {
    if (visit && document.visibilityState === "visible") { addVisibleTime(); writeVisit(); }
}, HEARTBEAT_MS);

document.addEventListener("visibilitychange", () => {
    if (!visit) return;
    if (document.visibilityState === "hidden") {
        addVisibleTime();
        visibleSince = null;
        hiddenAt = Date.now();
        writeVisit();
    } else {
        if (hiddenAt && Date.now() - hiddenAt > NEW_VISIT_AFTER_MS) startVisit();
        else visibleSince = Date.now();
        hiddenAt = null;
    }
});

// ---------- דף הסטטיסטיקה (רק לבעלים) ----------
function isOwner() {
    const u = auth.currentUser;
    return !!(u && u.email && u.emailVerified !== false && u.email.toLowerCase() === STATS_OWNER);
}

let section = null;
let modal = null;
let days = 30;

function el(tag, cls, text) {
    const x = document.createElement(tag);
    if (cls) x.className = cls;
    if (text !== undefined) x.textContent = text; // תמיד טקסט, אף פעם לא HTML
    return x;
}

function refreshOwnerUI() {
    if (isOwner()) {
        if (!section) buildOwnerUI();
    } else {
        // מי שאינו הבעלים: אין כפתור, אין חלון, אין נתונים בדף
        if (section) { section.remove(); section = null; }
        if (modal) { modal.remove(); modal = null; }
    }
}

function buildOwnerUI() {
    const panel = document.getElementById("accountPanel");
    if (!panel) return;
    section = el("div", "settings-section");
    section.appendChild(el("div", "settings-title", "מנהל"));
    const row = el("div", "offline-row");
    const btn = el("button", "", "📊 סטטיסטיקת שימוש");
    btn.addEventListener("click", () => {
        panel.classList.add("hidden");
        openStats();
    });
    row.appendChild(btn);
    section.appendChild(row);
    panel.appendChild(section);

    modal = el("div", "modal-overlay hidden");
    modal.id = "statsModal";
    const card = el("div", "color-palette-card stats-card");
    card.appendChild(el("h3", "", "📊 סטטיסטיקת שימוש"));
    const range = el("div", "modal-btns stats-range");
    [[7, "7 ימים"], [30, "30 ימים"], [90, "90 ימים"]].forEach(([n, label]) => {
        const b = el("button", n === days ? "primary" : "", label);
        b.addEventListener("click", () => {
            days = n;
            range.querySelectorAll("button").forEach((x) => x.classList.toggle("primary", x === b));
            loadStats();
        });
        range.appendChild(b);
    });
    card.appendChild(range);
    card.appendChild(el("div", "stats-body"));
    const close = el("button", "", "סגור");
    close.addEventListener("click", () => modal.classList.add("hidden"));
    card.appendChild(close);
    modal.appendChild(card);
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
    document.body.appendChild(modal);
}

function openStats() {
    if (!isOwner() || !modal) return;
    modal.classList.remove("hidden");
    loadStats();
}

function fmtDur(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec + " שנ׳";
    const m = Math.round(sec / 60);
    if (m < 60) return m + " דק׳";
    const h = Math.floor(m / 60);
    return h + " שע׳" + (m % 60 ? " " + (m % 60) + " דק׳" : "");
}

function fmtDate(ms) {
    const d = new Date(ms);
    return d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" }) + " " +
        d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

async function loadStats() {
    if (!isOwner() || !modal) return;
    const body = modal.querySelector(".stats-body");
    body.replaceChildren(el("div", "edit-hint", "⏳ טוען..."));
    let visits;
    try {
        const since = Date.now() - days * 24 * 3600 * 1000;
        const snap = await getDocs(query(collection(db, "visits"), where("s", ">=", since)));
        visits = snap.docs.map((x) => x.data()).filter((x) => x && typeof x.s === "number");
    } catch (e) {
        body.replaceChildren(el("div", "sync-error", "לא הצלחתי לטעון: " + (e.code || e.message || e)));
        return;
    }
    if (!isOwner()) { body.replaceChildren(); return; }

    // מכשיר שהתחבר פעם עם מייל: גם ביקורי האורח שלו משויכים לאותו מייל
    const emailOfDevice = {};
    visits.forEach((x) => { if (x.e) emailOfDevice[x.v] = x.e; });
    const people = {};
    visits.forEach((x) => {
        const email = x.e || emailOfDevice[x.v] || null;
        const key = email ? "e:" + email : "v:" + x.v;
        const p = people[key] || (people[key] = { email, vid: x.v, devs: new Set(), list: [], dur: 0, last: 0 });
        p.devs.add(String(x.dev || ""));
        p.list.push(x);
        p.dur += x.d || 0;
        p.last = Math.max(p.last, x.l || x.s);
    });
    const arr = Object.values(people).sort((a, b) => b.last - a.last);
    const logged = arr.filter((p) => p.email).length;

    const out = [];
    const sum = el("div", "stats-summary");
    [["אנשים", arr.length], ["מחוברים", logged], ["אורחים", arr.length - logged],
     ["ביקורים", visits.length], ["זמן כולל", fmtDur(visits.reduce((t, x) => t + (x.d || 0), 0))]]
        .forEach(([k, v]) => {
            const c = el("div", "stats-num");
            c.appendChild(el("b", "", String(v)));
            c.appendChild(el("span", "", k));
            sum.appendChild(c);
        });
    out.push(sum);
    if (!arr.length) out.push(el("div", "edit-hint", "אין ביקורים בתקופה הזו."));

    const list = el("div", "move-folder-list stats-list");
    arr.forEach((p) => {
        const item = el("details", "stats-person");
        const head = el("summary");
        const name = p.email || ("אורח #" + String(p.vid).slice(0, 4));
        head.appendChild(el("div", "stats-name", name));
        head.appendChild(el("div", "edit-hint",
            [...p.devs].filter(Boolean).join(", ") + " · " + p.list.length + " ביקורים · " + fmtDur(p.dur) +
            " · אחרון: " + fmtDate(p.last)));
        item.appendChild(head);
        p.list.sort((a, b) => b.s - a.s).forEach((x) => {
            item.appendChild(el("div", "stats-visit", fmtDate(x.s) + " — " + fmtDur(x.d) + (x.e ? "" : " (אורח)")));
        });
        list.appendChild(item);
    });
    out.push(list);
    body.replaceChildren(...out);
}
