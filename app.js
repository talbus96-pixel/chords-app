const scale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
let currentSongData = null;
let currentLibNodeId = null; // מזהה השיר שמוצג, אם נפתח מהספרייה (ולא מחיפוש)
let activeFolderForColor = null;

// 10 צבעים ייעודיים לבחירה
const PRESET_COLORS = [
    "#ef4444", // אדום
    "#f97316", // כתום
    "#f59e0b", // ענבר/צהוב
    "#10b981", // ירוק
    "#06b6d4", // טורקיז
    "#3b82f6", // כחול
    "#6366f1", // אינדיגו
    "#8b5cf6", // סגול
    "#ec4899", // ורוד
    "#64748b"  // אפור
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
    return { id: "root", type: "folder", name: lang === "en" ? "My Library" : "הספרייה שלי", color: "#3b82f6", isExpanded: true, children: [] };
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

function persistLocal() {
    if (isReadOnlyOffline()) return;
    try {
        localStorage.setItem(storageKeyFor(window.libraryStorageKey, "he"), JSON.stringify(libs.he));
        localStorage.setItem(storageKeyFor(window.libraryStorageKey, "en"), JSON.stringify(libs.en));
    } catch (e) {}
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
    // נשמר בענן רק אם מחוברים והענן אומת (ההגנות בתוך firebase-sync.js)
    if (window.saveLibraryToCloud) window.saveLibraryToCloud();
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
        const folderColor = node.color || "#3b82f6";
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
            saveLibrary();
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
        const folderColor = node.color || "#3b82f6";
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
                saveLibrary();
            }
        } else {
            currentSongData = { ...node };
            currentLibNodeId = node.id;
            displayCurrentSong();
            saveBtn.classList.add("hidden");
            updateSaveChangesBtn();
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
            color: "#3b82f6",
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
            if (currentSongData && currentSongData.id === id) {
                currentSongData = null;
                currentLibNodeId = null;
                updateSaveChangesBtn();
                songDisplay.innerText = "חפש שיר כדי לשאוב אותו, או בחר שיר מעץ התיקיות...";
                sourceInfo.classList.add("hidden");
            }
        }
    }
}

addFolderBtnRoot.addEventListener("click", () => createFolder("root"));

// חיפוש ושאיבה
searchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") performSearch(); });
searchBtn.addEventListener("click", performSearch);

async function performSearch() {
    const searchTerm = searchInput.value.trim();
    if (!searchTerm) return;

    songDisplay.innerText = "⏳ מחפש את השיר... (אם השרת היה רדום זה יכול לקחת עד דקה)";
    sourceInfo.classList.add("hidden");
    saveBtn.classList.add("hidden");
    currentSongData = null;
    currentLibNodeId = null;
    updateSaveChangesBtn();

    try {
        const res = await fetch(`https://chords-scraper.onrender.com/scrape?q=${encodeURIComponent(searchTerm)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentSongData = {
            id: "song_" + Date.now(),
            type: "file",
            title: data.title || searchTerm,
            source: data.source || 'Tab4U',
            content: data.content
        };

        displayCurrentSong();
        saveBtn.classList.remove("hidden");
    } catch (err) {
        songDisplay.innerText = `❌ לא הצלחתי לשאוב: ${err.message}\n\nנסה שוב בעוד רגע, או נסה לנסח את החיפוש אחרת (למשל: שם שיר + שם אמן).`;
    }
}

// שפת השיר: אם יש בו אותיות עבריות - עברית, אחרת אנגלית
function songLang(song) {
    return /[\u0590-\u05FF]/.test((song.content || "") + " " + (song.title || "")) ? "he" : "en";
}

saveBtn.addEventListener("click", () => {
    if (!currentSongData) return;
    const lang = songLang(currentSongData);
    libs[lang].children.push({...currentSongData});
    saveLibrary();
    if (lang !== activeLang) switchLibrary(lang, true);
    const where = lang === "he" ? "הספרייה העברית" : "הספרייה האנגלית";
    saveBtn.innerText = "✅ נשמר ב" + where + "!";
    setTimeout(() => { saveBtn.innerText = "💾 שמור שיר לראשי"; saveBtn.classList.add("hidden"); }, 2500);
});

function displayCurrentSong() {
    if (!currentSongData) return;
    sourceInfo.innerText = `מקור: נשאב מ-${currentSongData.source}`;
    sourceInfo.classList.remove("hidden");
    songDisplay.innerText = currentSongData.content;
    // שירים בעברית מיושרים לימין, שירים באנגלית לשמאל (אחרת האקורדים לא מתיישרים מעל המילים)
    const isHebrew = /[\u0590-\u05FF]/.test(currentSongData.content);
    songDisplay.style.direction = isHebrew ? "rtl" : "ltr";
    songDisplay.style.textAlign = isHebrew ? "right" : "left";
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

document.getElementById("transposeUp").addEventListener("click", () => {
    if (!currentSongData) return;
    currentSongData.content = transposeText(currentSongData.content, 1);
    displayCurrentSong();
    updateSaveChangesBtn();
});

document.getElementById("transposeDown").addEventListener("click", () => {
    if (!currentSongData) return;
    currentSongData.content = transposeText(currentSongData.content, -1);
    displayCurrentSong();
    updateSaveChangesBtn();
});

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
    const show = !!(node && currentSongData && currentSongData.id === currentLibNodeId && node.content !== currentSongData.content);
    saveChangesBtn.classList.toggle("hidden", !show);
}

saveChangesBtn.addEventListener("click", () => {
    const node = currentLibNodeId && findLibNode(currentLibNodeId);
    if (!node || !currentSongData) return;
    node.content = currentSongData.content;
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

// סגירת המגירה בנייד כשבוחרים שיר
const originalDisplaySong = displayCurrentSong;
displayCurrentSong = function() {
    originalDisplaySong();
    if (window.innerWidth <= 768) {
        closeMobileDrawer();
    }
};