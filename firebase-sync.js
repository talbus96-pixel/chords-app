import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithCredential,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAnLv5Gme0d8G-UH9ghz1yZAa8hTjPM8bE",
  authDomain: "chordsapp-e4a85.firebaseapp.com",
  projectId: "chordsapp-e4a85",
  storageBucket: "chordsapp-e4a85.firebasestorage.app",
  messagingSenderId: "678717011887",
  appId: "1:678717011887:web:3ef3b4550a26563162e15a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const GUEST_KEY = "chordLibraryData";

// cloudReady = true רק אחרי שהענן אישר לנו מה יש בו בפועל.
// כל עוד זה false, אסור לכתוב לענן (זו ההגנה מפני דריסת הספרייה).
let cloudReady = false;
let unsubscribeSnapshot = null;
let userDisplayEl = null;
let baseUserName = "";

function setStatus(text) {
    if (userDisplayEl && baseUserName) {
        userDisplayEl.innerText = "שלום, " + baseUserName + " " + text;
    }
    const st = document.getElementById("accountStatus");
    if (st) st.innerText = !baseUserName ? "" : text.startsWith("⚠️") ? "⚠️" : text.startsWith("⏳") ? "⏳" : "☁️";
    refreshOfflineBtn();
}

function setAccountLabel(name) {
    const l = document.getElementById("accountLabel");
    if (l) l.innerText = name || "התחברות";
}

function isCapacitorNative() {
    return window.Capacitor && window.Capacitor.isNativePlatform();
}

if (isCapacitorNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth) {
    window.Capacitor.Plugins.GoogleAuth.initialize({
        clientId: '678717011887-3gh7chfl1fc8j3d10g0fma01h4qltnfb.apps.googleusercontent.com',
        scopes: ['profile', 'email'],
        grantOfflineAccess: false,
    });
}

// ספרייה חלופית כשהענן לא החזיר אחת: קודם מה ששמור במכשיר למשתמש הזה, אחר כך ספריית אורח (אם אין עותק אופליין), אחרת ריקה
function fallbackLib(lang) {
    const u = window.readUserLibraries();
    const g = window.readGuestLibraries();
    if (hasContent(u[lang])) return u[lang];
    if (hasContent(g[lang])) return g[lang];
    return window.emptyLibraries()[lang];
}

function refreshOfflineBtn() {
    const btn = document.getElementById("downloadOfflineBtn");
    if (!btn) return;
    btn.classList.toggle("hidden", !auth.currentUser);
    btn.disabled = !(auth.currentUser && cloudReady);
}

window.getAccount = () => auth.currentUser ? { uid: auth.currentUser.uid, email: auth.currentUser.email || "" } : null;
window.isCloudReady = () => cloudReady;

function validLib(lib) {
    return lib && Array.isArray(lib.children);
}

function hasContent(lib) {
    return validLib(lib) && lib.children.length > 0;
}

export async function saveLibraryToCloud() {
    // הגנות: לא כותבים אם לא מחוברים, אם הענן עוד לא אומת, או אם אין ספריות
    if (!auth.currentUser || !cloudReady || !window.getLibrariesForCloud) return;
    try {
        const libs = window.getLibrariesForCloud();
        const docRef = doc(db, "users_libraries", auth.currentUser.uid);
        await setDoc(docRef, {
            libraryData: libs.he,
            libraryDataEn: libs.en,
            lastUpdated: new Date().toISOString()
        });
        setStatus("☁️✓");
    } catch (error) {
        console.error("שגיאה בשמירת הנתונים לענן:", error);
        setStatus("⚠️ לא נשמר בענן");
    }
}
window.saveLibraryToCloud = saveLibraryToCloud;

function startCloudSync(user) {
    cloudReady = false;
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }

    window.libraryStorageKey = GUEST_KEY + "_" + user.uid;
    setStatus("⏳");

    const docRef = doc(db, "users_libraries", user.uid);
    unsubscribeSnapshot = onSnapshot(docRef, (snap) => {
        // שינוי שאנחנו עצמנו כתבנו ועוד לא אושר בשרת - מתעלמים
        if (snap.metadata.hasPendingWrites) return;
        const confirmed = !snap.metadata.fromCache;

        if (snap.exists()) {
            const d = snap.data();
            const heOk = validLib(d.libraryData);
            const enOk = validLib(d.libraryDataEn);
            window.applyLibrariesFromCloud(heOk ? d.libraryData : fallbackLib("he"), enOk ? d.libraryDataEn : fallbackLib("en"));
            cloudReady = confirmed;
            setStatus(cloudReady ? "☁️✓" : "⏳");
            // חסרה ספרייה (מסמך מגרסה ישנה, או שגרסה ישנה מחקה אותה): משלימים בענן, רק אחרי אישור שרת
            if (confirmed && !(heOk && enOk)) saveLibraryToCloud();
        } else if (confirmed) {
            // השרת אישר שאין עדיין מסמך למשתמש הזה: יוצרים אותו
            cloudReady = true;
            window.applyLibrariesFromCloud(fallbackLib("he"), fallbackLib("en"));
            saveLibraryToCloud();
        }
        // מסמך לא קיים + נתוני מטמון בלבד = כנראה אין אינטרנט. לא עושים כלום.
    }, (error) => {
        console.error("שגיאת סנכרון:", error);
        cloudReady = false;
        setStatus("⚠️ אין חיבור לענן");
    });
}

function stopCloudSync() {
    cloudReady = false;
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    window.libraryStorageKey = GUEST_KEY;
    if (window.reloadLibraryFromLocal) window.reloadLibraryFromLocal();
}

function setupAuthUI() {
    const authDiv = document.createElement("div");
    authDiv.className = "auth-container";

    const loginBtn = document.createElement("button");
    loginBtn.id = "firebaseLoginBtn";
    loginBtn.innerText = "התחבר עם גוגל ☁️";
    loginBtn.style.cssText = "padding: 7px 10px; border-radius: 6px; cursor: pointer; background: #3b82f6; color: white; border: none; font-weight: bold;";

    const userDisplay = document.createElement("span");
    userDisplay.id = "firebaseUserDisplay";
    userDisplay.style.cssText = "font-size: 14px; font-weight: bold; color: #333; display: none;";
    userDisplayEl = userDisplay;

    const emailEl = document.createElement("div");
    emailEl.className = "auth-email";
    emailEl.style.display = "none";

    authDiv.appendChild(userDisplay);
    authDiv.appendChild(emailEl);
    authDiv.appendChild(loginBtn);

    const holder = document.getElementById("accountInfo");
    if (holder) {
        holder.appendChild(authDiv);
    } else {
        authDiv.style.cssText = "position: absolute; left: 15px; top: 10px; display: flex; align-items: center; gap: 10px; z-index: 1000;";
        document.body.appendChild(authDiv);
    }

    loginBtn.onclick = async () => {
        if (auth.currentUser) {
            if (isCapacitorNative() && window.Capacitor.Plugins.GoogleAuth) {
                try { await window.Capacitor.Plugins.GoogleAuth.signOut(); } catch (e) {}
            }
            await signOut(auth);
        } else {
            try {
                if (isCapacitorNative() && window.Capacitor.Plugins.GoogleAuth) {
                    const googleUser = await window.Capacitor.Plugins.GoogleAuth.signIn();
                    const credential = GoogleAuthProvider.credential(googleUser.authentication.idToken);
                    await signInWithCredential(auth, credential);
                } else {
                    await signInWithPopup(auth, provider);
                }
            } catch (error) {
                console.error("שגיאה בהתחברות:", error);
                alert("ההתחברות נכשלה: " + (error.code || "") + " " + (error.message || error));
            }
        }
    };

    onAuthStateChanged(auth, (user) => {
        if (user) {
            baseUserName = user.displayName ? user.displayName.split(" ")[0] : "משתמש";
            userDisplay.style.display = "block";
            setAccountLabel(baseUserName);
            emailEl.innerText = user.email || "";
            emailEl.style.display = user.email ? "block" : "none";
            loginBtn.innerText = "התנתק";
            loginBtn.style.background = "#64748b";
            startCloudSync(user);
            refreshOfflineBtn();
            if (window.onAccountChange) window.onAccountChange();
        } else {
            baseUserName = "";
            userDisplay.style.display = "none";
            emailEl.style.display = "none";
            setAccountLabel("");
            const st = document.getElementById("accountStatus");
            if (st) st.innerText = "";
            loginBtn.innerText = "התחבר עם גוגל ☁️";
            loginBtn.style.background = "#3b82f6";
            stopCloudSync();
            refreshOfflineBtn();
            if (window.onAccountChange) window.onAccountChange();
        }
    });
}

setupAuthUI();
