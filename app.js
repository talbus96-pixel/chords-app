const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
let currentSongData = null;
let currentLibNodeId = null; // מזהה השיר שמוצג, אם נפתח מהספרייה (ולא מחיפוש)
let activeFolderForColor = null;

// 10 צבעים ייעודיים לבחירה
// צבעים בסגנון אירי: ירוקים, זהב, חום, בורדו, אברש, כחול ים ואבן
const DEFAULT_FOLDER_COLOR = "#1f6b3a";
const PRESET_COLORS = [
    "#1f6b3a", // ירוק אירי
    "#5c8a3a", // ירוק אזוב
    "#3f8f7a", // ירוק ים
    "#c49a2c", // זהב
    "#c8742c", // ענבר
    "#8b4a2b", // חום אדמה
    "#8e2c3a", // בורדו
    "#7a5a8c", // סגול אברש
    "#3d6a8a", // כחול ים
    "#7a7466"  // אבן
];

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const songDisplay = document.getElementById("songDisplay");
const sourceInfo = document.getElementById("sourceInfo");
const saveBtn = document.getElementById("saveBtn");
const libraryContainer = document.getElementById("libraryContainer");
const addFolderBtnRoot = document.getElementById("addFolderBtnRoot");
const rootDropZone = document.getElementById("rootDropZone");
const contextMenu = document.getElementById("contextMenu");
const contextMenuList = document.getElementById("contextMenuList");
const sidebarArea = document.getElementById("sidebarArea");
const colorModal = document.getElementById("colorModal");
const paletteGrid = document.getElementById("paletteGrid");
const closePaletteBtn = document.getElementById("closePaletteBtn");

// המרת צבע HEX ל-RGBA עבור רקע שקוף ועדין
function hexToRgba(hex, alpha = 0.15) {
    let cleanHex = hex.replace("#", "");
    if (cleanHex.length === 3) {
        cleanHex = cleanHex.split("").map(c => c + c).join("");
    }
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ===== ספריות: עברית ואנגלית =====
// המפתח הבסיסי משתנה לפי המשתמש המחובר (firebase-sync.js מעדכן אותו)
const GUEST_LIB_KEY = "chordLibraryData";
window.libraryStorageKey = GUEST_LIB_KEY;

function emptyLibrary(lang) {
    return { id: "root", type: "folder", name: lang === "en" ? "My Library" : "הספרייה שלי", color: DEFAULT_FOLDER_COLOR, isExpanded: true, children: [] };
}

function parseLibrary(raw, lang) {
    let data = null;
    try { data = JSON.parse(raw); } catch (e) {}
    if (Array.isArray(data)) { // פורמט ישן מאוד: מערך של שירים
        const lib = emptyLibrary(lang);
        lib.children = data.map(s => ({...s, id: "song_" + Math.random(), type: 'file'}));
        return lib;
    }
    if (!data || !Array.isArray(data.children)) return emptyLibrary(lang);
    return data;
}

function storageKeyFor(base, lang) { return base + (lang === "en" ? "_en" : ""); }

function readLibraryFromStorage(lang, base) {
    let raw = null;
    try { raw = localStorage.getItem(storageKeyFor(base || window.libraryStorageKey, lang)); } catch (e) {}
    return parseLibrary(raw, lang);
}

const libs = { he: readLibraryFromStorage("he"), en: readLibraryFromStorage("en") };
let activeLang = "he";
try { if (localStorage.getItem("activeLibLang") === "en") activeLang = "en"; } catch (e) {}
let myLibrary = libs[activeLang]; // הספרייה הפעילה כרגע (כל הפונקציות למטה עובדות עליה)

window.myLibrary = myLibrary;
window.libraries = libs;
window.renderLibrary = renderLibrary;

function replaceInPlace(target, source) {
    Object.keys(target).forEach(k => delete target[k]);
    Object.assign(target, source);
}

// מצב אופליין: כשלא מחוברים ויש עותק אופליין פעיל, שינויים נשארים רק בזיכרון ולא נשמרים
function isReadOnlyOffline() {
    try { return window.libraryStorageKey === GUEST_LIB_KEY && !!localStorage.getItem("offlineActiveId"); } catch (e) { return false; }
}

let lastStorageFullToast = 0;
function persistLocal() {
    if (isReadOnlyOffline()) return false;
    try {
        localStorage.setItem(storageKeyFor(window.libraryStorageKey, "he"), JSON.stringify(libs.he));
        localStorage.setItem(storageKeyFor(window.libraryStorageKey, "en"), JSON.stringify(libs.en));
        return true;
    } catch (e) {
        // הזיכרון של הדפדפן/האפליקציה מלא: לא שותקים, מודיעים
        if (Date.now() - lastStorageFullToast > 15000) {
            lastStorageFullToast = Date.now();
            showToast("⚠️ אין מספיק מקום במכשיר. מחק עותקי אופליין ישנים");
        }
        return false;
    }
}

// --- פונקציות שקוד הענן (firebase-sync.js) משתמש בהן ---
window.getLibrariesForCloud = function () {
    return JSON.parse(JSON.stringify({ he: libs.he, en: libs.en }));
};

window.readGuestLibraries = function () {
    if (localStorage.getItem("offlineActiveId")) return { he: null, en: null };
    return { he: readLibraryFromStorage("he", GUEST_LIB_KEY), en: readLibraryFromStorage("en", GUEST_LIB_KEY) };
};

// נקרא כשהענן שלח נתונים. מחליף את הספריות בזיכרון (בלי לכתוב חזרה לענן).
// he / en יכולים להיות null אם הענן לא שלח אותם - אז הספרייה המקומית נשארת כמו שהיא.
window.applyLibrariesFromCloud = function (he, en) {
    if (he) replaceInPlace(libs.he, he);
    if (en) replaceInPlace(libs.en, en);
    persistLocal(); // נשמר תחת מפתח המשתמש בלבד. עותק האופליין (ספריית האורח) מתעדכן רק בכפתור ההורדה
    renderLibrary();
    updateOfflineBanner();
};

// הספריות השמורות במכשיר תחת המפתח הנוכחי (של המשתמש המחובר)
window.readUserLibraries = function () {
    return { he: readLibraryFromStorage("he"), en: readLibraryFromStorage("en") };
};

window.emptyLibraries = function () { return { he: emptyLibrary("he"), en: emptyLibrary("en") }; };

// נקרא מיד כשמשתמש מתחבר, לפני שהענן עונה: מציג את מה שנשמר במכשיר למשתמש הזה.
// (בלי זה הוצגה ספריית האורח / עותק האופליין, ושינויים שנשמרו בטלפון "חזרו למקור" עד שהענן ענה)
// אם אין במכשיר כלום למשתמש: עותק האופליין רק אם הוא של אותו חשבון, אחרת ספרייה ריקה עד שהענן יענה
window.loadUserLibrariesForStart = function (email) {
    let he = readLibraryFromStorage("he"), en = readLibraryFromStorage("en");
    if (he.children.length === 0 && en.children.length === 0) {
        const c = activeCopy();
        if (c && c.email && c.email === email) {
            he = parseLibrary(JSON.stringify(c.he), "he");
            en = parseLibrary(JSON.stringify(c.en), "en");
        }
    }
    replaceInPlace(libs.he, he);
    replaceInPlace(libs.en, en);
    renderLibrary();
    updateOfflineBanner();
    updateSaveChangesBtn();
};

// מיזוג אחרי שהמכשיר היה מנותק מהענן ונשמרו בו שינויים.
// base = הספרייה כפי שהייתה בענן בפעם האחרונה שהמכשיר היה מסונכרן (יכול להיות null).
// - שיר/תיקייה חדשים במכשיר: מתווספים.
// - שינוי שם / תוכן / צבע: אם השתנה במכשיר לעומת base - של המכשיר, אחרת של הענן.
// - נמחק במכשיר (היה ב-base, לא במכשיר): נמחק. נמחק במכשיר אחר (היה ב-base, לא בענן): לא חוזר.
// - בלי base: רק מוסיפים את מה שחדש במכשיר, ובהתנגשות הענן קובע.
window.mergeLibraries = function (cloud, local, base) {
    const out = JSON.parse(JSON.stringify(cloud));
    const LANGS = ["he", "en"];
    const index = (libsObj) => {
        const m = new Map();
        const walk = (n) => { if (n.id !== "root") m.set(n.id, n); (n.children || []).forEach(walk); };
        LANGS.forEach(l => { if (libsObj && libsObj[l]) walk(libsObj[l]); });
        return m;
    };
    const baseIdx = index(base), localIdx = index(local), outIdx = index(out);
    const FIELDS = ["title", "name", "content", "color", "source", "transpose"];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // נמחק במכשיר הזה: היה בבסיס, לא קיים במכשיר
    if (base) {
        const prune = (n) => {
            if (!n.children) return;
            n.children = n.children.filter(c => !(baseIdx.has(c.id) && !localIdx.has(c.id)));
            n.children.forEach(prune);
        };
        LANGS.forEach(l => { if (out[l]) prune(out[l]); });
    }

    LANGS.forEach(l => {
        const visit = (localNode, outParent) => {
            (localNode.children || []).forEach(child => {
                let target = outIdx.get(child.id);
                if (target) {
                    const b = baseIdx.get(child.id);
                    if (b) FIELDS.forEach(f => { if (!same(child[f], b[f])) target[f] = JSON.parse(JSON.stringify(child[f] === undefined ? null : child[f])); });
                } else if (base && baseIdx.has(child.id)) {
                    return; // נמחק בענן (ממכשיר אחר) - לא מחזירים
                } else {
                    target = JSON.parse(JSON.stringify(child));
                    if (target.type === "folder") target.children = [];
                    outParent.children.push(target);
                    outIdx.set(child.id, target);
                }
                if (child.type === "folder" && target.type === "folder") visit(child, target);
            });
        };
        if (!local || !local[l]) return;
        if (!out[l]) { out[l] = JSON.parse(JSON.stringify(local[l])); return; }
        visit(local[l], out[l]);
    });
    return out;
};

// נקרא בהתנתקות: טוען מחדש את ספריות האורח המקומיות
window.reloadLibraryFromLocal = function () {
    replaceInPlace(libs.he, readLibraryFromStorage("he"));
    replaceInPlace(libs.en, readLibraryFromStorage("en"));
    renderLibrary();
    updateOfflineBanner();
};

let lastReadOnlyToast = 0;
function saveLibrary() {
    persistLocal();
    renderLibrary();
    if (isReadOnlyOffline() && Date.now() - lastReadOnlyToast > 15000) {
        lastReadOnlyToast = Date.now();
        showToast("📴 מצב אופליין: השינויים לא יישמרו");
    }
    // מסמנים שיש שינוי שעוד לא אושר בענן (כדי לא לאבד אותו אם הענן לא זמין כרגע)
    if (!isReadOnlyOffline() && window.markPendingSync) window.markPendingSync();
    // נשמר בענן רק אם מחוברים והענן אומת (ההגנות בתוך firebase-sync.js)
    if (window.saveLibraryToCloud) window.saveLibraryToCloud();
}

// פתיחה/סגירה של תיקייה: נשמר רק במכשיר, בלי לשלוח את כל הספרייה לענן
function saveLocalOnly() {
    persistLocal();
    renderLibrary();
}

// אתחול 10 הצבעים במודאל
paletteGrid.innerHTML = "";
PRESET_COLORS.forEach(color => {
    const dot = document.createElement("div");
    dot.className = "color-circle";
    dot.style.backgroundColor = color;
    dot.onclick = () => {
        if (activeFolderForColor) {
            changeColor(activeFolderForColor, color);
            colorModal.classList.add("hidden");
        }
    };
    paletteGrid.appendChild(dot);
});

closePaletteBtn.onclick = () => colorModal.classList.add("hidden");

// רינדור עץ התיקיות
function renderLibrary() {
    libraryContainer.innerHTML = "";
    const rootElement = createTreeElement(myLibrary);
    rootElement.classList.add("tree-root");
    libraryContainer.appendChild(rootElement);
}

function createTreeElement(node) {
    const li = document.createElement("li");
    li.dataset.id = node.id;
    if (node.isExpanded) {
        li.classList.add("is-open");
    }
    
    const itemDiv = document.createElement("div");
    itemDiv.className = "tree-item";
    itemDiv.draggable = node.id !== "root";

    // עיצוב דינמי של צבע התיקייה והרקע שמאחורי הכותרת
    if (node.type === "folder" && node.id !== "root") {
        const folderColor = node.color || DEFAULT_FOLDER_COLOR;
        itemDiv.style.backgroundColor = hexToRgba(folderColor, 0.12);
        itemDiv.style.borderColor = hexToRgba(folderColor, 0.35);
    }

    // אירועי Drag & Drop
    itemDiv.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", node.id);
        e.stopPropagation();
    });

    itemDiv.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (node.type === "folder") {
            itemDiv.classList.add("drag-over-folder");
        } else {
            itemDiv.classList.add("drag-over-item");
        }
    });

    itemDiv.addEventListener("dragleave", () => {
        itemDiv.classList.remove("drag-over-folder", "drag-over-item");
    });
    
    itemDiv.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        itemDiv.classList.remove("drag-over-folder", "drag-over-item");
        
        const draggedId = e.dataTransfer.getData("text/plain");
        if (draggedId && draggedId !== node.id) {
            if (node.type === "folder") {
                moveItem(draggedId, node.id);
            } else {
                reorderBefore(draggedId, node.id);
            }
        }
    });

    // קליק ימני במחשב. במכשיר מגע לחיצה ארוכה לא פותחת תפריט (כדי שאפשר יהיה לגרור). התפריט נפתח מהכפתור ⋮
    itemDiv.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isTouchPrimary()) return;
        openContextMenu(e.clientX, e.clientY, node);
    });

    // צד ימין: סמן חץ + אייקון + שם
    const leftControls = document.createElement("div");
    leftControls.className = "item-left-controls";

    if (node.type === "folder" && node.id !== "root") {
        const arrow = document.createElement("span");
        arrow.className = "toggle-arrow";
        arrow.innerText = node.isExpanded ? "▼" : "▶";
        arrow.onclick = (e) => {
            e.stopPropagation();
            node.isExpanded = !node.isExpanded;
            saveLocalOnly();
        };
        leftControls.appendChild(arrow);
    } else if (node.type === "file") {
        const placeholder = document.createElement("span");
        placeholder.className = "toggle-placeholder";
        leftControls.appendChild(placeholder);
    }

    const titleDiv = document.createElement("div");
    titleDiv.className = "item-title";
    const iconSpan = document.createElement("span");
    iconSpan.className = "item-icon";
    
    if (node.type === "folder") {
        // התיקייה הראשית תמיד בצבע העיצוב (אי אפשר לשנות לה צבע)
        const folderColor = node.id === "root" ? DEFAULT_FOLDER_COLOR : (node.color || DEFAULT_FOLDER_COLOR);
        // אייקון וקטורי SVG שמגיב לצבע שנבחר באופן מושלם
        iconSpan.innerHTML = `
            <svg class="folder-svg" viewBox="0 0 24 24" style="fill: ${folderColor}; width: 18px; height: 18px;">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
        `;
    } else {
        iconSpan.innerText = "🎵";
    }

    const textSpan = document.createElement("span");
    textSpan.innerText = node.name || node.title;
    titleDiv.appendChild(iconSpan);
    titleDiv.appendChild(textSpan);
    leftControls.appendChild(titleDiv);
    itemDiv.appendChild(leftControls);

    // צד שמאל: כפתורים גלויים (פלטת צבעים לתיקייה ומחיקה)
    if (node.id !== "root") {
        const actionsBar = document.createElement("div");
        actionsBar.className = "item-actions-bar";

        if (node.type === "folder") {
            const colorBtn = document.createElement("button");
            colorBtn.className = "action-icon-btn";
            colorBtn.innerText = "🎨";
            colorBtn.title = "בחר צבע לתיקייה";
            colorBtn.onclick = (e) => {
                e.stopPropagation();
                openColorModal(node.id);
            };
            actionsBar.appendChild(colorBtn);
        }

        const delBtn = document.createElement("button");
        delBtn.className = "action-icon-btn delete-btn";
        delBtn.innerText = "🗑️";
        delBtn.title = "מחק";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteItem(node.id);
        };
        actionsBar.appendChild(delBtn);

        const dotsBtn = document.createElement("button");
        dotsBtn.className = "action-icon-btn menu-dots-btn";
        dotsBtn.innerText = "⋮";
        dotsBtn.title = "תפריט";
        dotsBtn.onclick = (e) => {
            e.stopPropagation();
            const r = dotsBtn.getBoundingClientRect();
            openContextMenu(r.left, r.bottom, node);
        };
        actionsBar.appendChild(dotsBtn);

        itemDiv.appendChild(actionsBar);
    }

    li.appendChild(itemDiv);

    // לחיצה על השורה
    itemDiv.addEventListener("click", () => {
        if (node.type === "folder") {
            if (node.id !== "root") {
                node.isExpanded = !node.isExpanded;
                saveLocalOnly();
            }
        } else {
            openLibrarySong(node);
        }
    });

    // ילדים
    if (node.type === "folder") {
        const ul = document.createElement("ul");
        ul.className = "tree-list";
        node.children.forEach(child => ul.appendChild(createTreeElement(child)));
        li.appendChild(ul);
    }
    return li;
}

// שחרור באזור הראשי
rootDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    rootDropZone.classList.add("drag-active");
});
rootDropZone.addEventListener("dragleave", () => rootDropZone.classList.remove("drag-active"));
rootDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    rootDropZone.classList.remove("drag-active");
    const draggedId = e.dataTransfer.getData("text/plain");
    if (draggedId) moveItem(draggedId, "root");
});

sidebarArea.addEventListener("contextmenu", (e) => {
    if (e.target === sidebarArea || e.target === libraryContainer) {
        e.preventDefault();
        if (isTouchPrimary()) return;
        openContextMenu(e.clientX, e.clientY, myLibrary);
    }
});

window.addEventListener("click", () => contextMenu.classList.add("hidden"));

// תפריט קליק ימני
function openContextMenu(x, y, node) {
    contextMenuList.innerHTML = "";
    const otherLibLabel = activeLang === "he" ? "העבר לספרייה האנגלית" : "העבר לספרייה העברית";

    if (node.id === "root") {
        contextMenuList.innerHTML = `
            <li onclick="createFolder('root')">➕ תיקייה חדשה</li>
        `;
    } else if (node.type === "folder") {
        contextMenuList.innerHTML = `
            <li onclick="createFolder('${node.id}')">➕ תת-תיקייה חדשה</li>
            <li onclick="renameItem('${node.id}')">✏️ שנה שם</li>
            <li onclick="openColorModal('${node.id}')">🎨 בחר צבע מתוך 10</li>
            <li onclick="openMoveModal('${node.id}')">📂 העבר לתיקייה...</li>
            <li onclick="moveItem('${node.id}', 'root')">📤 העבר לתיקייה הראשית</li>
            <li onclick="moveToOtherLibrary('${node.id}')">🔁 ${otherLibLabel}</li>
            <div class="context-divider"></div>
            <li class="danger" onclick="deleteItem('${node.id}')">🗑️ מחק תיקייה</li>
        `;
    } else {
        contextMenuList.innerHTML = `
            <li onclick="renameItem('${node.id}')">✏️ שנה שם שיר</li>
            <li onclick="duplicateSong('${node.id}')">📋 שכפל שיר</li>
            <li onclick="editSong('${node.id}')">✏️ ערוך שיר</li>
            <li onclick="openMoveModal('${node.id}')">📂 העבר לתיקייה...</li>
            <li onclick="moveItem('${node.id}', 'root')">📤 העבר לתיקייה הראשית</li>
            <li onclick="moveToOtherLibrary('${node.id}')">🔁 ${otherLibLabel}</li>
            <div class="context-divider"></div>
            <li class="danger" onclick="deleteItem('${node.id}')">🗑️ מחק שיר</li>
        `;
    }

    contextMenu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 200))}px`;
    contextMenu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - 280))}px`;
    contextMenu.classList.remove("hidden");
}

function openColorModal(folderId) {
    activeFolderForColor = folderId;
    colorModal.classList.remove("hidden");
}

function changeColor(folderId, color) {
    const info = findParentAndNode(myLibrary, folderId);
    if (info && info.node.type === "folder") {
        info.node.color = color;
        saveLibrary();
    }
}

// ניהול היררכיית קבצים
function findParentAndNode(current, targetId, parent = null) {
    if (current.id === targetId) return { parent, node: current };
    if (current.children) {
        for (let child of current.children) {
            const res = findParentAndNode(child, targetId, current);
            if (res) return res;
        }
    }
    return null;
}

function moveItem(itemId, newParentId) {
    const itemInfo = findParentAndNode(myLibrary, itemId);
    const newParentInfo = findParentAndNode(myLibrary, newParentId);
    
    if (itemInfo && newParentInfo && newParentInfo.node.type === "folder") {
        let temp = newParentInfo.node;
        while(temp) {
            if (temp.id === itemId) return;
            const tempInfo = findParentAndNode(myLibrary, temp.id);
            temp = tempInfo ? tempInfo.parent : null;
        }
        itemInfo.parent.children = itemInfo.parent.children.filter(c => c.id !== itemId);
        newParentInfo.node.children.push(itemInfo.node);
        newParentInfo.node.isExpanded = true;
        saveLibrary();
    }
}

function reorderBefore(draggedId, targetId) {
    const draggedInfo = findParentAndNode(myLibrary, draggedId);
    const targetInfo = findParentAndNode(myLibrary, targetId);
    
    if (draggedInfo && targetInfo) {
        draggedInfo.parent.children = draggedInfo.parent.children.filter(c => c.id !== draggedId);
        const targetIndex = targetInfo.parent.children.findIndex(c => c.id === targetId);
        targetInfo.parent.children.splice(targetIndex, 0, draggedInfo.node);
        saveLibrary();
    }
}

function duplicateSong(songId) {
    const info = findParentAndNode(myLibrary, songId);
    if (info && info.node.type === "file") {
        const copy = JSON.parse(JSON.stringify(info.node));
        copy.id = "song_" + Date.now();
        copy.title = (copy.title || copy.name) + " (עותק)";
        info.parent.children.push(copy);
        saveLibrary();
    }
}

function createFolder(parentId) {
    const folderName = prompt("הכנס שם לתיקייה החדשה:");
    if (!folderName) return;
    const parentInfo = findParentAndNode(myLibrary, parentId);
    if (parentInfo && parentInfo.node.type === "folder") {
        parentInfo.node.children.push({
            id: "folder_" + Date.now(),
            type: "folder",
            name: folderName,
            color: DEFAULT_FOLDER_COLOR,
            isExpanded: true,
            children: []
        });
        saveLibrary();
    }
}

function renameItem(id) {
    const info = findParentAndNode(myLibrary, id);
    if (info) {
        const newName = prompt("הכנס שם חדש:", info.node.name || info.node.title);
        if (newName) {
            if (info.node.type === "folder") info.node.name = newName;
            else info.node.title = newName;
            saveLibrary();
        }
    }
}

function deleteItem(id) {
    if (confirm("האם אתה בטוח שברצונך למחוק?")) {
        const info = findParentAndNode(myLibrary, id);
        if (info) {
            info.parent.children = info.parent.children.filter(c => c.id !== id);
            saveLibrary();
            // השיר שמוצג נמחק (בעצמו או בתוך תיקייה שנמחקה)
            if (currentLibNodeId && !findLibNode(currentLibNodeId)) {
                currentSongData = null;
                currentLibNodeId = null;
                updateSaveChangesBtn();
                stopAutoScroll();
                updateWakeLock();
                songDisplay.innerText = "חפש שיר כדי לשאוב אותו, או בחר שיר מעץ התיקיות...";
                sourceInfo.classList.add("hidden");
            }
        }
    }
}

addFolderBtnRoot.addEventListener("click", () => createFolder("root"));

// חיפוש ושאיבה
const SCRAPER_URL = "https://chords-scraper.onrender.com";

// השרת החינמי נרדם אחרי כרבע שעה בלי שימוש. מעירים אותו כבר כשהאפליקציה נפתחת / כשנוגעים בתיבת החיפוש
let lastWakePing = 0;
function wakeServer() {
    if (Date.now() - lastWakePing < 5 * 60 * 1000) return;
    lastWakePing = Date.now();
    fetch(SCRAPER_URL + "/health").catch(() => {});
}
wakeServer();
searchInput.addEventListener("focus", wakeServer);

searchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") performSearch(); });
searchBtn.addEventListener("click", performSearch);

async function performSearch() {
    const searchTerm = searchInput.value.trim();
    if (!searchTerm) return;

    songDisplay.innerText = "⏳ מחפש את השיר... (אם השרת היה רדום זה יכול לקחת עד דקה)";
    clearSongView();
    searchResultsList = [];
    renderSearchResults();

    try {
        const res = await fetch(`${SCRAPER_URL}/scrape?q=${encodeURIComponent(searchTerm)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showSearchedSong(data, searchTerm);
        searchResultsList = Array.isArray(data.results) ? data.results : [];
        renderSearchResults(data.url);
    } catch (err) {
        songDisplay.innerText = `❌ לא הצלחתי לשאוב: ${err.message}\n\nנסה שוב בעוד רגע, או נסה לנסח את החיפוש אחרת (למשל: שם שיר + שם אמן).`;
    }
}

// מנקה את אזור השיר לפני חיפוש / כשאין שיר
function clearSongView() {
    sourceInfo.classList.add("hidden");
    saveBtn.classList.add("hidden");
    currentSongData = null;
    currentLibNodeId = null;
    stopAutoScroll();
    updateSaveChangesBtn();
    updateWakeLock();
}

function showSearchedSong(data, fallbackTitle) {
    currentSongData = {
        id: "song_" + Date.now(),
        type: "file",
        title: data.title || fallbackTitle,
        source: data.source || 'Tab4U',
        content: data.content,
        transpose: 0
    };
    currentLibNodeId = null;
    displayCurrentSong();
    scrollSongToTop();
    saveBtn.classList.remove("hidden");
    updateSaveChangesBtn();
}

// ===== בחירה מתוך עד 5 תוצאות חיפוש =====
const searchResultsEl = document.getElementById("searchResults");
let searchResultsList = [];
let searchResultsOpen = false;

function renderSearchResults(currentUrl) {
    searchResultsEl.innerHTML = "";
    if (searchResultsList.length < 2) { searchResultsEl.classList.add("hidden"); return; }
    if (currentUrl !== undefined) { searchResultsEl.dataset.current = currentUrl || ""; searchResultsOpen = false; }
    const cur = searchResultsEl.dataset.current;
    const toggle = document.createElement("button");
    toggle.className = "results-toggle";
    toggle.innerText = searchResultsOpen ? "▲ הסתר תוצאות" : "🔎 לא השיר הנכון? בחר מתוך " + searchResultsList.length + " תוצאות";
    toggle.onclick = () => { searchResultsOpen = !searchResultsOpen; renderSearchResults(); };
    searchResultsEl.appendChild(toggle);
    if (searchResultsOpen) {
        searchResultsList.forEach(r => {
            const b = document.createElement("button");
            b.className = "result-item" + (r.url === cur ? " current" : "");
            b.dir = "auto";
            b.innerText = (r.url === cur ? "✓ " : "") + r.title + "  ·  " + r.source;
            b.onclick = () => pickSearchResult(r);
            searchResultsEl.appendChild(b);
        });
    }
    searchResultsEl.classList.remove("hidden");
}

async function pickSearchResult(r) {
    if (r.url === searchResultsEl.dataset.current) { searchResultsOpen = false; renderSearchResults(); return; }
    clearSongView();
    searchResultsOpen = false;
    renderSearchResults();
    songDisplay.innerText = "⏳ טוען את " + r.title + "...";
    try {
        const res = await fetch(`${SCRAPER_URL}/song?url=${encodeURIComponent(r.url)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showSearchedSong({ ...data, title: data.title || r.title }, r.title);
        renderSearchResults(r.url);
    } catch (err) {
        songDisplay.innerText = `❌ לא הצלחתי לטעון את השיר: ${err.message}\n\nנסה שוב, או בחר תוצאה אחרת.`;
    }
}

// שפת השיר: אם יש בו אותיות עבריות - עברית, אחרת אנגלית
function songLang(song) {
    return /[\u0590-\u05FF]/.test((song.content || "") + " " + (song.title || "")) ? "he" : "en";
}

let savingSearchedSong = false;
saveBtn.addEventListener("click", () => {
    if (!currentSongData || savingSearchedSong) return; // לחיצה כפולה לא שומרת פעמיים
    savingSearchedSong = true;
    const lang = songLang(currentSongData);
    // מזהה חדש וייחודי בכל שמירה (אחרת שני עותקים עם אותו מזהה נמחקים יחד)
    libs[lang].children.push({ ...currentSongData, id: "song_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) });
    saveLibrary();
    if (lang !== activeLang) switchLibrary(lang, true);
    const where = lang === "he" ? "הספרייה העברית" : "הספרייה האנגלית";
    saveBtn.innerText = "✅ נשמר ב" + where + "!";
    setTimeout(() => { saveBtn.innerText = "💾 שמור שיר לראשי"; saveBtn.classList.add("hidden"); savingSearchedSong = false; }, 2500);
});

function escapeHtml(t) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// הטקסט המוצג: המקור אחרי שינוי הטון השמור בשיר. האקורדים עטופים כדי שאפשר יהיה לצבוע אותם
function songHtml(content, steps) {
    const text = steps ? transposeText(content, steps) : content;
    return text.split("\n").map(line => isChordLine(line)
        ? line.replace(/\S+/g, tok => CHORD_RE.test(tok) ? '<span class="chord">' + escapeHtml(tok) + '</span>' : escapeHtml(tok))
        : escapeHtml(line)).join("\n");
}

function displayCurrentSong() {
    if (!currentSongData) return;
    sourceInfo.innerText = `מקור: נשאב מ-${currentSongData.source}`;
    sourceInfo.classList.toggle("hidden", !currentSongData.source);
    songDisplay.innerHTML = songHtml(currentSongData.content || "", currentSongData.transpose || 0);
    // שירים בעברית מיושרים לימין, שירים באנגלית לשמאל (אחרת האקורדים לא מתיישרים מעל המילים)
    const isHebrew = /[\u0590-\u05FF]/.test(currentSongData.content);
    songDisplay.style.direction = isHebrew ? "rtl" : "ltr";
    songDisplay.style.textAlign = isHebrew ? "right" : "left";
    updateWakeLock();
}

// פתיחת שיר מהספרייה (מהעץ, מהחיפוש בספרייה או מרשימת הופעה)
function openLibrarySong(node) {
    currentSongData = { ...node, transpose: node.transpose || 0 };
    currentLibNodeId = node.id;
    searchResultsList = [];
    renderSearchResults();
    stopAutoScroll();
    displayCurrentSong();
    scrollSongToTop();
    saveBtn.classList.add("hidden");
    updateSaveChangesBtn();
}

function scrollSongToTop() {
    const sc = document.querySelector(".main-content");
    if (sc) sc.scrollTop = 0;
}

// טרנספוזיציה
const SHARP_SCALE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_SCALE  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// אקורד שלם: שורש + סיומת (m, maj7, sus4, add9, 7b5...) + בס אופציונלי אחרי /
const CHORD_RE = /^([A-G][#b]?)((?:m|maj|min|M|dim|aug|sus|add|\+|°|-)?\d{0,2}(?:(?:sus|add|maj|dim|aug|m|b|#|\+|-)?\d{1,2}){0,4}(?:\([^)]*\))?)(?:\/([A-G][#b]?))?$/;

function shiftNote(note, steps) {
    const useFlats = note.length === 2 && note[1] === "b";
    const list = useFlats ? FLAT_SCALE : SHARP_SCALE;
    let index = list.indexOf(note);
    if (index === -1) index = (useFlats ? SHARP_SCALE : FLAT_SCALE).indexOf(note);
    if (index === -1) return note;
    return list[(((index + steps) % 12) + 12) % 12];
}

function transposeChord(token, steps) {
    const m = token.match(CHORD_RE);
    if (!m) return token;
    return shiftNote(m[1], steps) + m[2] + (m[3] ? "/" + shiftNote(m[3], steps) : "");
}

// שורה נחשבת "שורת אקורדים" רק אם כל המילים בה הן אקורדים (או סימני מפריד)
function isChordLine(line) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    let chords = 0;
    for (const t of tokens) {
        if (CHORD_RE.test(t)) chords++;
        else if (!/^(\||-|–|x\d+|\d+x|\/|:|\(|\))+$/i.test(t)) return false;
    }
    return chords > 0;
}

function transposeLine(line, steps) {
    // שומר על היישור מעל המילים: אם האקורד התארך/התקצר, מתאים את הרווחים אחריו
    let debt = 0;
    return line.replace(/(\S+)(\s*)/g, (full, token, spaces) => {
        const out = CHORD_RE.test(token) ? transposeChord(token, steps) : token;
        debt += out.length - token.length;
        let sp = spaces;
        if (debt > 0 && sp.length > 1) {
            const cut = Math.min(debt, sp.length - 1);
            sp = sp.slice(cut);
            debt -= cut;
        } else if (debt < 0 && sp.length > 0) {
            sp = sp + " ".repeat(-debt);
            debt = 0;
        }
        return out + sp;
    });
}

function transposeText(text, steps) {
    return text.split("\n").map(line => isChordLine(line) ? transposeLine(line, steps) : line).join("\n");
}

// שינוי הטון נשמר כהגדרה של השיר (transpose = מספר חצאי טונים). הטקסט המקורי לא משתנה
function changeTranspose(delta) {
    if (!currentSongData) return;
    let t = (currentSongData.transpose || 0) + delta;
    if (t > 11 || t < -11) t = 0; // סיבוב שלם = הטון המקורי
    currentSongData.transpose = t;
    displayCurrentSong();
    updateSaveChangesBtn();
}

document.getElementById("transposeUp").addEventListener("click", () => changeTranspose(1));
document.getElementById("transposeDown").addEventListener("click", () => changeTranspose(-1));

// גודל גופן של השיר – נשמר במכשיר כדי שיישאר גם אחרי סגירת האפליקציה
const FONT_MIN = 10, FONT_MAX = 32;
const fontSizeLabel = document.getElementById("fontSizeLabel");
let songFontSize = parseInt(localStorage.getItem("songFontSize"), 10);
if (!songFontSize) songFontSize = window.innerWidth <= 768 ? 13 : 15;

function applyFontSize() {
    songDisplay.style.fontSize = songFontSize + "px";
    fontSizeLabel.innerText = songFontSize;
    try { localStorage.setItem("songFontSize", songFontSize); } catch (e) {}
}

function changeFontSize(delta) {
    songFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, songFontSize + delta));
    applyFontSize();
}

document.getElementById("fontSmallerBtn").addEventListener("click", () => changeFontSize(-1));
document.getElementById("fontBiggerBtn").addEventListener("click", () => changeFontSize(1));
applyFontSize();

// ===== החלפת ספרייה (עברית / אנגלית) =====
const libHeBtn = document.getElementById("libHeBtn");
const libEnBtn = document.getElementById("libEnBtn");
const sidebarTitle = document.getElementById("sidebarTitle");
const appLayout = document.querySelector(".app-layout");
const toastEl = document.getElementById("toast");
const moveModal = document.getElementById("moveModal");
const moveFolderList = document.getElementById("moveFolderList");
let switching = false;
let toastTimer = null;

// מכשיר מגע (טלפון/טאבלט) לעומת עכבר
function isTouchPrimary() {
    try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; }
}

function showToast(text) {
    toastEl.innerText = text;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

function updateLibraryUI() {
    const en = activeLang === "en";
    sidebarArea.classList.toggle("lang-en", en);
    appLayout.classList.toggle("lang-en", en);
    sidebarArea.dir = en ? "ltr" : "rtl";
    libHeBtn.classList.toggle("active", !en);
    libEnBtn.classList.toggle("active", en);
    sidebarTitle.innerText = en ? "📚 הספרייה האנגלית" : "📚 הספרייה העברית";
}

function switchLibrary(lang, animate) {
    if (lang !== "he" && lang !== "en") return;
    if (switching) return;
    const apply = () => {
        activeLang = lang;
        myLibrary = libs[lang];
        window.myLibrary = myLibrary;
        try { localStorage.setItem("activeLibLang", lang); } catch (e) {}
        updateLibraryUI();
        renderLibrary();
    };
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (lang === activeLang || !animate || !sidebarArea.animate || reduced || window.innerWidth <= 768) { apply(); return; }

    // "דלת מסתובבת": המגירה יוצאת לצד אחד ונכנסת מהצד השני
    switching = true;
    const toEnglish = lang === "en";
    const outX = toEnglish ? "120%" : "-120%";
    const inX = toEnglish ? "-120%" : "120%";
    const out = sidebarArea.animate([{ transform: "translateX(0)" }, { transform: "translateX(" + outX + ")" }],
        { duration: 220, easing: "ease-in", fill: "forwards" });
    out.onfinish = () => {
        apply();
        sidebarArea.animate([{ transform: "translateX(" + inX + ")" }, { transform: "translateX(0)" }],
            { duration: 260, easing: "ease-out" }).onfinish = () => { switching = false; };
        out.cancel();
    };
    out.oncancel = () => { /* ממשיכים כרגיל */ };
}

libHeBtn.addEventListener("click", () => switchLibrary("he", true));
libEnBtn.addEventListener("click", () => switchLibrary("en", true));

// העברת פריט (שיר או תיקייה) לספרייה השנייה
function moveToOtherLibrary(id) {
    const info = findParentAndNode(myLibrary, id);
    if (!info || !info.parent) return;
    const otherLang = activeLang === "he" ? "en" : "he";
    info.parent.children = info.parent.children.filter(c => c.id !== id);
    libs[otherLang].children.push(info.node);
    if (currentSongData && currentSongData.id === id) {
        // השיר שמוצג נשאר מוצג; רק הספרייה שלו השתנתה
    }
    saveLibrary();
    showToast("הועבר ל" + (otherLang === "he" ? "ספרייה העברית" : "ספרייה האנגלית"));
}

// חלון "העבר לתיקייה..." (מחליף גרירה במובייל)
function openMoveModal(itemId) {
    const info = findParentAndNode(myLibrary, itemId);
    if (!info) return;
    moveFolderList.innerHTML = "";
    moveFolderList.dir = activeLang === "en" ? "ltr" : "rtl";
    const addFolder = (folder, depth) => {
        if (folder.id === itemId) return; // לא מעבירים תיקייה לתוך עצמה או לתוך הצאצאים שלה
        const btn = document.createElement("button");
        btn.className = "move-folder-btn";
        btn.style.paddingInlineStart = (12 + depth * 16) + "px";
        const isCurrent = !!(info.parent && info.parent.id === folder.id);
        btn.innerText = (depth === 0 ? "📚 הספרייה הראשית" : "📁 " + folder.name) + (isCurrent ? "  (כאן)" : "");
        btn.disabled = isCurrent;
        btn.onclick = () => { moveModal.classList.add("hidden"); moveItem(itemId, folder.id); };
        moveFolderList.appendChild(btn);
        (folder.children || []).filter(c => c.type === "folder").forEach(c => addFolder(c, depth + 1));
    };
    addFolder(myLibrary, 0);
    moveModal.classList.remove("hidden");
}
document.getElementById("closeMoveBtn").onclick = () => moveModal.classList.add("hidden");

// ===== שמירת שינויים בשיר (למשל טרנספוזיציה) =====
const saveChangesBtn = document.getElementById("saveChangesBtn");

function findLibNode(id) {
    for (const lang of ["he", "en"]) {
        const info = findParentAndNode(libs[lang], id);
        if (info && info.parent) return info.node;
    }
    return null;
}

function updateSaveChangesBtn() {
    const node = currentLibNodeId && findLibNode(currentLibNodeId);
    const show = !!(node && currentSongData && currentSongData.id === currentLibNodeId &&
        (node.content !== currentSongData.content || (node.transpose || 0) !== (currentSongData.transpose || 0)));
    saveChangesBtn.classList.toggle("hidden", !show);
}

saveChangesBtn.addEventListener("click", () => {
    const node = currentLibNodeId && findLibNode(currentLibNodeId);
    if (!node || !currentSongData) return;
    node.content = currentSongData.content;
    node.transpose = currentSongData.transpose || 0;
    saveLibrary();
    updateSaveChangesBtn();
    if (!isReadOnlyOffline()) showToast("✅ השינויים נשמרו בשיר");
});

// ===== עותקי אופליין =====
const OFFLINE_MAX = 5;
const offlineModal = document.getElementById("offlineModal");
const offlineList = document.getElementById("offlineList");

function readCopies() {
    try { const a = JSON.parse(localStorage.getItem("offlineCopies")); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function writeCopies(a) { localStorage.setItem("offlineCopies", JSON.stringify(a)); }
function activeCopyId() { try { return localStorage.getItem("offlineActiveId"); } catch (e) { return null; } }
function activeCopy() { const id = activeCopyId(); return id ? (readCopies().find(c => c.id === id) || null) : null; }
function countSongs(node) {
    if (!node) return 0;
    if (node.type === "file") return 1;
    return (node.children || []).reduce((n, c) => n + countSongs(c), 0);
}
function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("he-IL") + " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function updateOfflineBanner() {
    const b = document.getElementById("offlineBanner");
    if (!b) return;
    const c = activeCopy();
    if (window.libraryStorageKey === GUEST_LIB_KEY && c) {
        b.innerText = "📴 עותק אופליין של " + c.email + " (" + fmtDate(c.savedAt) + "). שינויים לא יישמרו.";
        b.classList.remove("hidden");
    } else {
        b.classList.add("hidden");
    }
    const icon = document.getElementById("accountOfflineIcon");
    if (icon) icon.classList.toggle("hidden", b.classList.contains("hidden"));
}
window.onAccountChange = updateOfflineBanner;
window.activeOfflineCopyEmail = function () { const c = activeCopy(); return c ? c.email : null; };

function activateCopyData(copy) {
    localStorage.setItem(GUEST_LIB_KEY, JSON.stringify(copy.he));
    localStorage.setItem(GUEST_LIB_KEY + "_en", JSON.stringify(copy.en));
    localStorage.setItem("offlineActiveId", copy.id);
}

function saveOfflineCopy() {
    const acc = window.getAccount && window.getAccount();
    if (!acc || !(window.isCloudReady && window.isCloudReady())) {
        showToast("צריך להיות מחובר ומסונכרן עם הענן כדי להוריד");
        return;
    }
    const data = window.getLibrariesForCloud();
    const songs = countSongs(data.he) + countSongs(data.en);
    const cur = activeCopy();
    if (cur && !confirm("עותק האופליין הפעיל שייך כרגע ל-" + cur.email + " (" + cur.songs + " שירים, " + fmtDate(cur.savedAt) + ").\nלהחליף אותו בעותק של " + acc.email + " (" + songs + " שירים)?")) return;
    let copies = readCopies();
    if (copies.length >= OFFLINE_MAX) {
        const victim = copies.find(c => c.id !== activeCopyId());
        if (!victim) return;
        if (!confirm("יש כבר " + OFFLINE_MAX + " עותקים. העותק הישן ביותר (" + victim.email + ", " + fmtDate(victim.savedAt) + ") יימחק. להמשיך?")) return;
        copies = copies.filter(c => c.id !== victim.id);
    }
    const copy = { id: "copy_" + Date.now(), email: acc.email, savedAt: new Date().toISOString(), songs: songs, he: data.he, en: data.en };
    copies.push(copy);
    try {
        writeCopies(copies);
        activateCopyData(copy);
    } catch (e) {
        showToast("אין מספיק מקום בטלפון לעותק נוסף");
        return;
    }
    updateOfflineBanner();
    showToast("✅ עותק אופליין נשמר: " + acc.email);
}

function activateCopy(id) {
    const c = readCopies().find(x => x.id === id);
    if (!c) return;
    try { activateCopyData(c); } catch (e) { showToast("אין מספיק מקום בטלפון"); return; }
    if (window.libraryStorageKey === GUEST_LIB_KEY) {
        replaceInPlace(libs.he, JSON.parse(JSON.stringify(c.he)));
        replaceInPlace(libs.en, JSON.parse(JSON.stringify(c.en)));
        renderLibrary();
            showToast("העותק הופעל");
    } else {
        showToast("העותק הוגדר כעותק האופליין. יוצג כשתתנתק או כשאין אינטרנט.");
    }
    updateOfflineBanner();
    openOfflineModal();
}

function deleteCopy(id) {
    if (id === activeCopyId()) { showToast("אי אפשר למחוק את העותק הפעיל"); return; }
    if (!confirm("למחוק את העותק?")) return;
    try { writeCopies(readCopies().filter(c => c.id !== id)); } catch (e) {}
    openOfflineModal();
}

function openOfflineModal() {
    offlineList.innerHTML = "";
    const copies = readCopies().slice().reverse();
    if (copies.length === 0) {
        offlineList.innerText = "אין עדיין עותקי אופליין. התחבר ולחץ על \"הורד לשימוש אופליין\".";
    }
    copies.forEach(c => {
        const row = document.createElement("div");
        row.className = "offline-row-item";
        const active = c.id === activeCopyId();
        const info = document.createElement("div");
        info.className = "offline-info";
        info.innerText = (active ? "✅ פעיל\n" : "") + c.email + "\n" + fmtDate(c.savedAt) + " · " + c.songs + " שירים";
        const btns = document.createElement("div");
        btns.className = "offline-btns";
        if (!active) {
            const a = document.createElement("button");
            a.innerText = "הפעל";
            a.onclick = () => activateCopy(c.id);
            const d = document.createElement("button");
            d.innerText = "🗑️";
            d.onclick = () => deleteCopy(c.id);
            btns.appendChild(a); btns.appendChild(d);
        }
        row.appendChild(info); row.appendChild(btns);
        offlineList.appendChild(row);
    });
    offlineModal.classList.remove("hidden");
}

document.getElementById("downloadOfflineBtn").addEventListener("click", saveOfflineCopy);
document.getElementById("manageOfflineBtn").addEventListener("click", () => {
    accountPanel.classList.add("hidden");
    openOfflineModal();
});

// ===== תפריט החשבון המתקפל =====
const accountPanel = document.getElementById("accountPanel");
document.getElementById("accountToggleBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    accountPanel.classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
    if (!accountPanel.classList.contains("hidden") && !document.getElementById("accountMenu").contains(e.target)) {
        accountPanel.classList.add("hidden");
    }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") accountPanel.classList.add("hidden"); });
document.getElementById("closeOfflineBtn").addEventListener("click", () => offlineModal.classList.add("hidden"));
updateOfflineBanner();

updateLibraryUI();
renderLibrary();

// שליטה במגירת הניווט בנייד
const menuToggleBtn = document.getElementById("menuToggleBtn");
const closeSidebarBtn = document.getElementById("closeSidebarBtn");
const drawerOverlay = document.getElementById("drawerOverlay");

function openMobileDrawer() {
    sidebarArea.classList.add("open");
    drawerOverlay.classList.add("active");
}

function closeMobileDrawer() {
    sidebarArea.classList.remove("open");
    drawerOverlay.classList.remove("active");
}

if (menuToggleBtn) menuToggleBtn.addEventListener("click", openMobileDrawer);
if (closeSidebarBtn) closeSidebarBtn.addEventListener("click", closeMobileDrawer);
if (drawerOverlay) drawerOverlay.addEventListener("click", closeMobileDrawer);

// ===== חיפוש בתוך הספרייה (שתי הספריות, לפי שם השיר או מילים מתוכו) =====
const libSearchInput = document.getElementById("libSearchInput");
const libSearchResults = document.getElementById("libSearchResults");

function normSearch(t) { return String(t || "").toLowerCase().replace(/\s+/g, " ").trim(); }

function renderLibSearch() {
    const q = normSearch(libSearchInput.value);
    libraryContainer.classList.toggle("hidden", !!q);
    libSearchResults.classList.toggle("hidden", !q);
    if (!q) return;
    const byTitle = [], byContent = [];
    ["he", "en"].forEach(lang => {
        const walk = (n, path) => {
            if (n.type === "file") {
                if (normSearch(n.title).includes(q)) byTitle.push({ n, path });
                else if (normSearch(n.content).includes(q)) byContent.push({ n, path });
                return;
            }
            const p = n.id === "root" ? [lang === "he" ? "עברית" : "English"] : path.concat(n.name);
            (n.children || []).forEach(c => walk(c, p));
        };
        walk(libs[lang], []);
    });
    const all = byTitle.concat(byContent);
    libSearchResults.innerHTML = "";
    if (all.length === 0) { libSearchResults.innerText = "לא נמצאו שירים"; return; }
    all.forEach(({ n, path }) => {
        const b = document.createElement("button");
        b.className = "lib-search-item";
        const t = document.createElement("div");
        t.dir = "auto";
        t.innerText = "🎵 " + (n.title || "");
        const where = document.createElement("div");
        where.className = "lib-search-path";
        where.innerText = path.join(" › ") + (byContent.some(x => x.n === n) ? " · נמצא במילים" : "");
        b.appendChild(t); b.appendChild(where);
        b.onclick = () => openLibrarySong(n);
        libSearchResults.appendChild(b);
    });
}
libSearchInput.addEventListener("input", renderLibSearch);

// ===== מסך דולק כל עוד שיר פתוח =====
let wakeLock = null;
async function updateWakeLock() {
    const want = !!currentSongData && document.visibilityState === "visible";
    if (!("wakeLock" in navigator)) return;
    try {
        if (want && !wakeLock) {
            wakeLock = await navigator.wakeLock.request("screen");
            wakeLock.addEventListener("release", () => { wakeLock = null; });
        } else if (!want && wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
    } catch (e) { /* הדפדפן לא אישר (למשל סוללה חלשה) - ממשיכים בלי */ }
}
// כשחוזרים לאפליקציה הדפדפן משחרר את המסך, אז מבקשים שוב
document.addEventListener("visibilitychange", updateWakeLock);

// ===== גלילה אוטומטית =====
const autoScrollBtn = document.getElementById("autoScrollBtn");
const scrollSpeedLabel = document.getElementById("scrollSpeedLabel");
const SCROLL_MIN = 1, SCROLL_MAX = 10;
let scrollSpeed = parseInt(localStorage.getItem("scrollSpeed"), 10) || 3;
let scrollRaf = null, scrollLast = 0, scrollAcc = 0;

function scrollerEl() { return document.querySelector(".main-content"); }

function scrollStep(now) {
    const sc = scrollerEl();
    const dt = Math.min(100, now - scrollLast);
    scrollLast = now;
    scrollAcc += (4 + scrollSpeed * 6) * dt / 1000; // פיקסלים לשנייה: 10 עד 64
    const whole = Math.floor(scrollAcc);
    if (whole > 0) { sc.scrollTop += whole; scrollAcc -= whole; }
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1) { stopAutoScroll(); return; }
    scrollRaf = requestAnimationFrame(scrollStep);
}

function startAutoScroll() {
    if (!currentSongData) { showToast("פתח שיר כדי לגלול"); return; }
    if (scrollRaf) return;
    scrollLast = performance.now();
    scrollAcc = 0;
    scrollRaf = requestAnimationFrame(scrollStep);
    autoScrollBtn.innerText = "⏸ עצור";
    autoScrollBtn.classList.add("on");
}

function stopAutoScroll() {
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
    autoScrollBtn.innerText = "▶ גלילה";
    autoScrollBtn.classList.remove("on");
}

function changeScrollSpeed(d) {
    scrollSpeed = Math.min(SCROLL_MAX, Math.max(SCROLL_MIN, scrollSpeed + d));
    scrollSpeedLabel.innerText = scrollSpeed;
    try { localStorage.setItem("scrollSpeed", scrollSpeed); } catch (e) {}
}

autoScrollBtn.addEventListener("click", () => scrollRaf ? stopAutoScroll() : startAutoScroll());
document.getElementById("scrollSlowerBtn").addEventListener("click", () => changeScrollSpeed(-1));
document.getElementById("scrollFasterBtn").addEventListener("click", () => changeScrollSpeed(1));
changeScrollSpeed(0);

// ===== אקורדים צבעוניים ומצב לילה (נשמרים במכשיר) =====
const colorChordsBtn = document.getElementById("colorChordsBtn");
const nightModeBtn = document.getElementById("nightModeBtn");

function readFlag(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : v === "1"; } catch (e) { return def; } }
function writeFlag(key, v) { try { localStorage.setItem(key, v ? "1" : "0"); } catch (e) {} }

let colorChords = readFlag("colorChords", true);
let nightMode = readFlag("nightMode", false);

function applyViewFlags() {
    songDisplay.classList.toggle("colored", colorChords);
    colorChordsBtn.classList.toggle("on", colorChords);
    document.body.classList.toggle("night", nightMode);
    nightModeBtn.classList.toggle("on", nightMode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", nightMode ? "#0f1813" : "#1f6b3a");
}
colorChordsBtn.addEventListener("click", () => { colorChords = !colorChords; writeFlag("colorChords", colorChords); applyViewFlags(); });
nightModeBtn.addEventListener("click", () => { nightMode = !nightMode; writeFlag("nightMode", nightMode); applyViewFlags(); });
applyViewFlags();

// ===== עריכה ידנית של שיר =====
const editModal = document.getElementById("editModal");
const editTitleInput = document.getElementById("editTitleInput");
const editContentInput = document.getElementById("editContentInput");

// נפתח מהתפריט ⋮ של שיר בספרייה
let editingId = null;
function editSong(id) {
    const node = findLibNode(id);
    if (!node) return;
    stopAutoScroll();
    closeMobileDrawer();
    editingId = id;
    editTitleInput.value = node.title || "";
    editContentInput.value = node.content || "";
    editModal.classList.remove("hidden");
}
document.getElementById("editCancelBtn").addEventListener("click", () => editModal.classList.add("hidden"));
document.getElementById("editSaveBtn").addEventListener("click", () => {
    const node = editingId && findLibNode(editingId);
    editModal.classList.add("hidden");
    if (!node) return;
    node.title = editTitleInput.value.trim() || node.title;
    node.content = editContentInput.value.replace(/\s+$/, "");
    saveLibrary();
    if (!isReadOnlyOffline()) showToast("✅ השיר נשמר");
    // השיר פתוח עכשיו: מציגים את הגרסה הערוכה (ושומרים על הטון שנבחר)
    if (currentSongData && currentLibNodeId === node.id) {
        currentSongData.title = node.title;
        currentSongData.content = node.content;
        displayCurrentSong();
        updateSaveChangesBtn();
    }
    if (libSearchInput.value) renderLibSearch();
});

// ===== גיבוי לקובץ ושחזור =====
document.getElementById("exportBackupBtn").addEventListener("click", () => {
    const data = window.getLibrariesForCloud();
    const backup = { app: "Shiron", kind: "backup", version: 1, exportedAt: new Date().toISOString(), he: data.he, en: data.en };
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Shiron-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    showToast("💾 קובץ הגיבוי ירד (" + (countSongs(data.he) + countSongs(data.en)) + " שירים)");
});

const importBackupInput = document.getElementById("importBackupInput");
document.getElementById("importBackupBtn").addEventListener("click", () => {
    if (isReadOnlyOffline()) { showToast("📴 במצב אופליין אי אפשר לשחזר. התחבר קודם"); return; }
    importBackupInput.value = "";
    importBackupInput.click();
});
importBackupInput.addEventListener("change", () => {
    const file = importBackupInput.files && importBackupInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        let b = null;
        try { b = JSON.parse(reader.result); } catch (e) {}
        const ok = (l) => l && Array.isArray(l.children);
        if (!b || !ok(b.he) || !ok(b.en)) { alert("הקובץ הזה לא נראה כמו גיבוי של האפליקציה"); return; }
        const fromBackup = { he: b.he, en: b.en };
        const current = window.getLibrariesForCloud();
        const before = countSongs(current.he) + countSongs(current.en);
        // מיזוג בלי בסיס: מוסיף מה שחסר, ושום דבר שקיים כרגע לא נמחק או משתנה
        const merged = window.mergeLibraries(current, fromBackup, null);
        const added = countSongs(merged.he) + countSongs(merged.en) - before;
        if (!confirm("גיבוי מ-" + (b.exportedAt ? fmtDate(b.exportedAt) : "?") + ".\n" +
            (added > 0 ? added + " שירים יתווספו לספרייה." : "כל השירים שבגיבוי כבר נמצאים בספרייה.") +
            "\nשירים שקיימים עכשיו לא יימחקו ולא ישתנו. להמשיך?")) return;
        replaceInPlace(libs.he, merged.he);
        replaceInPlace(libs.en, merged.en);
        saveLibrary();
            accountPanel.classList.add("hidden");
        showToast("✅ השחזור הושלם");
    };
    reader.readAsText(file);
});

// התקנה כאפליקציה מכרום ("הוסף למסך הבית") ועבודה בלי אינטרנט. לא בתוך אפליקציית ה-APK
if ("serviceWorker" in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// סגירת המגירה בנייד כשבוחרים שיר
const originalDisplaySong = displayCurrentSong;
displayCurrentSong = function() {
    originalDisplaySong();
    if (window.innerWidth <= 768) {
        closeMobileDrawer();
    }
};