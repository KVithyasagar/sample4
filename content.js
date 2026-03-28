// content.js - Complete Version: Static Filenames (Overwrite), Q-Pipe (Parens), PC UI Sizing Priority, Reduced Gaps, Hover Effects

// --- GUARD CLAUSE ---
if (!window.hasGhostReaderLoaded) {
  window.hasGhostReaderLoaded = true;
}

// --- ASSETS ---
const SMILE_LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="40" height="40">
  <circle cx="50" cy="50" r="45" fill="#FFEB3B" stroke="#FBC02D" stroke-width="2"/>
  <circle cx="35" cy="40" r="5" fill="#333"/>
  <circle cx="65" cy="40" r="5" fill="#333"/>
  <path d="M 30 65 Q 50 80 70 65" stroke="#333" stroke-width="4" fill="none" stroke-linecap="round"/>
</svg>`;

// --- VARIABLES ---
let normalData = [];
let questionData = [];
let overlay = null;
let currentUser = "Student";
let ownerEmail = "";
let geminiKey = ""; 
let recognition = null;

let workQueue = [];     
let currentBatchIndex = 0; 
let batchSize = 1;
let activeDataset = []; 

// --- FEATURES VARIABLES ---
let selectedIndices = new Set(); // Selection Persistence
let customTimes = {}; // Persistence for individual row timers
let sentenceViewFilter = "all"; // View Filter
let forceFocus = true; // Control for keyboard persistence

// Efficiency Limit Variables
let listRenderLimit = 50;  
const LIST_RENDER_STEP = 50; 

// Settings & Modes
let gameMode = "sentence"; 
let isChallengeMode = false;
let isClozeMode = false; 
let feedbackMode = "immediate"; 
let navTrigger = "manual";      
let autoNavDelay = 2;            
let timerInterval = null;
let itemFinished = false;  
let canProceed = false; 
let defaultTimerValue = 10;
let hasStartedTyping = false; 

// TTS Variables
let ttsEnabled = false; 
let synth = window.speechSynthesis;
let currentUtterance = null;

let themeConfig = {
    bgColor: "#ffffff",
    bgImage: null,
    fontFamily: "Verdana, sans-serif",
    fontColor: "#0277bd"
};

let levelStartTime = 0;
let bestTimes = {}; 
let historyLog = []; 

let currentLevelState = {
  data: [],
  combinedText: "",
  combinedKeywords: "",
  foundKeywords: [],
  allocatedTime: 0
};

// --- HELPER: ESCAPE REGEX ---
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}

// --- HELPER: SAVE FILE AS (Priority: Picker -> Fallback: Download) ---
async function saveFileAs(content, filename, mimeType) {
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'GhostReader File',
                    accept: { [mimeType]: ['.json', '.csv', '.txt'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
            return; 
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.warn("File Picker API failed/not supported, using fallback download.", err);
        }
    }

    const blob = new Blob([content], {type: mimeType});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename; 
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- SETTINGS MANAGEMENT ---
function saveSettings() {
    const settings = {
        gameMode,
        isChallengeMode,
        isClozeMode,
        feedbackMode,
        navTrigger,
        autoNavDelay,
        ttsEnabled,
        themeConfig,
        defaultTimerValue,
        styleSelectValue: isClozeMode ? "cloze" : "classic" 
    };
    chrome.storage.local.set({ 'ghostSettings': settings });
}

function loadSettings(callback) {
    chrome.storage.local.get(['ghostSettings', 'scriptData', 'ghostBestTimes', 'ghostHistory', 'ghostCustomTimes'], (result) => {
        if (result.scriptData) {
            const processedData = result.scriptData.map(item => {
                let text = item.text || "";
                let keywordRaw = item.keyword || "";
                
                if (text.trim().startsWith("Q:") && text.includes("|")) {
                    const parts = text.split("|");
                    text = parts[0].trim(); 
                    
                    let pipeKeywords = parts.slice(1).join("|").trim();
                    
                    pipeKeywords = pipeKeywords.replace(/([^\s,]+)\s*\(([^)]+)\)/g, (match, mainWord, content) => {
                         const alts = content.split(',').map(s => s.trim()).join('/');
                         return `${mainWord}/${alts}`;
                    });

                    if (keywordRaw.length > 0) {
                        keywordRaw = keywordRaw + "," + pipeKeywords;
                    } else {
                        keywordRaw = pipeKeywords;
                    }
                }

                text = text.replace(/^"+|"+$/g, ''); 
                text = text.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\uFFFD]/g, "'");
                text = text.trim();
                
                keywordRaw = keywordRaw.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\uFFFD]/g, "'");
                
                let baseGroups = keywordRaw.split(',').map(k => k.trim()).filter(k => k);
                const tailRegex = /(\s*\/[^\/]+\/[,]*)+$/;
                const match = text.match(tailRegex);
                
                if (match) {
                    const fullTail = match[0];
                    text = text.replace(fullTail, "").trim(); 
                    
                    const slashMatches = fullTail.match(/\/([^\/]+)\//g);
                    if (slashMatches) {
                        slashMatches.forEach(tag => {
                            let content = tag.replace(/^\/|\/$/g, '');
                            let parts = content.split(',').map(p => p.trim());
                            let mainKey = parts[0].toLowerCase(); 
                            
                            let foundIndex = baseGroups.findIndex(bg => {
                                return bg.toLowerCase().split('/')[0] === mainKey;
                            });

                            const newGroupString = parts.join('/'); 

                            if (foundIndex !== -1) {
                                baseGroups[foundIndex] = newGroupString;
                            } else {
                                baseGroups.push(newGroupString);
                            }
                        });
                    }
                }
                
                const finalKeyword = baseGroups.join(',');
                return { ...item, text: text, keyword: finalKeyword };
            });

            // FIXED: Prevent duplicates across the whole data loading pipeline
            let seenNormal = new Set();
            normalData = processedData.filter(item => {
                if (item.text.startsWith("Q:")) return false;
                if (seenNormal.has(item.text)) return false;
                seenNormal.add(item.text);
                return true;
            });
            
            let seenQuestion = new Set();
            questionData = processedData.filter(item => {
                if (!item.text.startsWith("Q:")) return false;
                if (seenQuestion.has(item.text)) return false;
                seenQuestion.add(item.text);
                return true;
            });
        }
        
        bestTimes = result.ghostBestTimes || {};
        historyLog = result.ghostHistory || [];
        customTimes = result.ghostCustomTimes || {}; 

        if (result.ghostSettings) {
            const s = result.ghostSettings;
            if(s.gameMode) gameMode = s.gameMode;
            if(typeof s.isChallengeMode !== 'undefined') isChallengeMode = s.isChallengeMode;
            if(typeof s.isClozeMode !== 'undefined') isClozeMode = s.isClozeMode;
            if(s.feedbackMode) feedbackMode = s.feedbackMode;
            if(s.navTrigger) navTrigger = s.navTrigger;
            if(s.autoNavDelay) autoNavDelay = s.autoNavDelay;
            if(typeof s.ttsEnabled !== 'undefined') ttsEnabled = s.ttsEnabled;
            if(s.themeConfig) themeConfig = { ...themeConfig, ...s.themeConfig };
            if(s.defaultTimerValue) defaultTimerValue = s.defaultTimerValue;
        }

        if (callback) callback(result.scriptData && result.scriptData.length > 0);
    });
}

// --- LISTENER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "start_script") {
    currentUser = request.username || "Student";
    ownerEmail = request.ownerEmail || "";
    geminiKey = request.apiKey || ""; 

    loadSettings((hasData) => {
        if (hasData) {
            currentBatchIndex = 0;
            workQueue = [];
            createOverlay();
            renderSelectionPage(); 
        } else {
            alert("No script found! Please upload a file in the extension popup first.");
        }
    });
  }
});

// --- UI CREATION ---
function createOverlay() {
  const existing = document.getElementById('ghost-overlay-root');
  if (existing) existing.remove();

  overlay = document.createElement('div');
  overlay.id = 'ghost-overlay-root';
  Object.assign(overlay.style, {
    position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
    background: 'linear-gradient(to bottom, #e0f7fa 0%, #ffffff 100%)', 
    color: '#0277bd', padding: '0', borderRadius: '12px', zIndex: '2147483647', 
    fontFamily: 'Verdana, sans-serif', textAlign: 'center', 
    fontSize: '14px', // PC Base Font
    minWidth: '800px', 
    maxHeight: '95vh', overflowY: 'auto', 
    boxShadow: '0 10px 50px rgba(0,188,212,0.3)', border: '1px solid #b2ebf2'
  });

  // --- HOVER EFFECTS CSS INJECTION ---
  const hoverStyle = document.createElement('style');
  hoverStyle.textContent = `
    #ghost-overlay-root button,
    #ghost-overlay-root input,
    #ghost-overlay-root select,
    #ghost-overlay-root textarea,
    #ghost-overlay-root label,
    #ghost-text,
    .ghost-list-row,
    .ghost-start-box,
    .ghost-setting-row,
    #ghost-status-badge {
        transition: all 0.2s ease-in-out;
    }
    #ghost-overlay-root button:hover {
        filter: brightness(1.1);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.15);
    }
    #ghost-overlay-root input[type="text"]:hover,
    #ghost-overlay-root input[type="number"]:hover,
    #ghost-overlay-root input[type="password"]:hover,
    #ghost-overlay-root input[type="email"]:hover,
    #ghost-overlay-root select:hover,
    #ghost-overlay-root textarea:hover {
        border-color: #0288d1 !important;
        box-shadow: 0 0 5px rgba(2, 136, 209, 0.3);
    }
    #ghost-overlay-root input[type="checkbox"]:hover,
    #ghost-overlay-root input[type="radio"]:hover {
        transform: scale(1.2);
        cursor: pointer;
    }
    #ghost-overlay-root label:hover {
        opacity: 0.8;
        cursor: pointer;
    }
    .ghost-list-row:hover {
        background-color: rgba(2, 136, 209, 0.1) !important;
        border-radius: 4px;
    }
    #ghost-text:hover {
        background-color: #e1f5fe !important;
        border-color: #0288d1 !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .ghost-start-box:hover {
        transform: translateY(-2px);
        box-shadow: 0 15px 40px rgba(0,0,0,0.3) !important;
    }
    .ghost-setting-row:hover {
        background-color: rgba(255,255,255,0.95) !important;
        box-shadow: 0 2px 6px rgba(0,0,0,0.05);
    }
    #ghost-status-badge:hover {
        transform: scale(1.05);
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
  `;
  overlay.appendChild(hoverStyle);

  // --- DOUBLE TOUCH (BACKGROUND) -> HIDE KEYBOARD ---
  overlay.addEventListener('dblclick', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      forceFocus = false; 

      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
          active.blur(); 
      }
  });

  const contentArea = document.createElement('div');
  contentArea.id = "ghost-content-area";
  contentArea.style.padding = "12px";
  
  const header = document.createElement('div');
  Object.assign(header.style, {
      display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', 
      marginBottom: '8px', marginTop: '5px' 
  });
  header.innerHTML = `${SMILE_LOGO_SVG}`;
  
  const closeX = document.createElement('button');
  closeX.innerText = "✕";
  Object.assign(closeX.style, {
      position: "absolute", top: "8px", right: "12px", background: "none", border: "none", 
      fontSize: "20px", 
      cursor: "pointer", color: "#00acc1"
  });
  closeX.onclick = () => { stopTimer(); stopTTS(); overlay.remove(); };

  overlay.appendChild(header); 
  overlay.appendChild(closeX);
  overlay.appendChild(contentArea);
  document.body.appendChild(overlay);
  
  applyTheme(); 
}

function applyTheme() {
    if(!overlay) return;
    if (themeConfig.bgImage) {
        overlay.style.background = `url('${themeConfig.bgImage}') center/cover no-repeat`;
    } else {
        overlay.style.background = themeConfig.bgColor;
    }
    overlay.style.fontFamily = themeConfig.fontFamily;
    overlay.style.color = themeConfig.fontColor;
    const headers = overlay.querySelectorAll('h2, h3, b');
    headers.forEach(h => h.style.color = themeConfig.fontColor);
}

// --- SELECTION PAGE ---
function renderSelectionPage() {
  const container = document.getElementById('ghost-content-area');
  container.innerHTML = `<h2 style="color:${themeConfig.fontColor}; margin-top:0; margin-bottom: 8px; font-size:20px;">Select Content</h2>`;
  const wrapper = document.createElement('div');
  wrapper.style.textAlign = "left";

  const modeRow = document.createElement('div');
  modeRow.className = "ghost-setting-row"; 
  modeRow.style.marginBottom = "8px"; modeRow.style.padding="6px"; modeRow.style.background="rgba(255,255,255,0.8)"; modeRow.style.borderRadius="8px"; modeRow.style.display="flex"; modeRow.style.gap="10px"; modeRow.style.alignItems="center";
  const modeTitle = document.createElement('span'); modeTitle.innerText = "📁 Content Type:"; modeTitle.style.fontWeight="bold";
  
  const rad1 = createRadio("sentence", "Sentences", gameMode === "sentence");
  const rad2 = createRadio("exam", "Exam Questions", gameMode === "exam");
  function createRadio(val, label, checked) {
      const sp = document.createElement('span');
      const r = document.createElement('input'); r.type="radio"; r.name="gMode"; r.value=val; r.checked=checked; r.id="gm-"+val;
      const l = document.createElement('label'); l.htmlFor="gm-"+val; l.innerText=label; l.style.marginLeft="4px"; l.style.cursor="pointer";
      r.onchange = () => { 
          gameMode = val; 
          selectedIndices.clear(); 
          listRenderLimit = 50; 
          saveSettings(); 
          renderList(); 
      };
      sp.append(r, l); return sp;
  }
  activeDataset = (gameMode === "sentence") ? normalData : questionData;
  modeRow.append(modeTitle, rad1, rad2);

  const settingsRow = document.createElement('div');
  settingsRow.className = "ghost-setting-row"; 
  Object.assign(settingsRow.style, { display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center', background: 'rgba(255,255,255,0.7)', padding: '6px', borderRadius: '8px', border:'1px solid #b2ebf2', flexWrap: 'wrap' });
  const styleLabel = document.createElement('span'); styleLabel.innerText = "Style:"; styleLabel.style.fontWeight = "bold";
  
  const styleSelect = document.createElement('select');
  styleSelect.innerHTML = `<option value="classic">Classic (Hide All)</option><option value="cloze">Cloze (Hide Keywords)</option>`;
  if(isClozeMode) styleSelect.value = "cloze"; 
  styleSelect.onchange = () => { isClozeMode = (styleSelect.value === "cloze"); saveSettings(); };
  Object.assign(styleSelect.style, { padding: '4px', borderRadius: '4px', border: '1px solid #b2ebf2', fontSize: '14px' });
  
  const timerSpan = document.createElement('span'); timerSpan.style.display="flex"; timerSpan.style.alignItems="center";
  const timerChk = document.createElement('input'); timerChk.type = "checkbox"; timerChk.id="g-timer-chk";
  timerChk.checked = isChallengeMode; 
  timerChk.onchange = () => { isChallengeMode = timerChk.checked; saveSettings(); };

  const timerLbl = document.createElement('label'); timerLbl.htmlFor="g-timer-chk"; timerLbl.innerText=" Timer"; timerLbl.style.marginRight="4px";
  const timerInput = document.createElement('input'); 
  timerInput.type="number"; timerInput.value= defaultTimerValue; timerInput.style.width="50px"; 
  timerInput.style.fontSize = "14px"; 
  
  timerInput.addEventListener('change', () => { 
      defaultTimerValue = parseInt(timerInput.value); 
      customTimes = {}; 
      chrome.storage.local.set({ 'ghostCustomTimes': {} }); 
      document.querySelectorAll('.ghost-row-timer').forEach(t => t.value = defaultTimerValue);
      saveSettings();
  });
  timerSpan.append(timerChk, timerLbl, timerInput);
  
  const toggleAllBtn = document.createElement('button'); toggleAllBtn.innerText = "Select All";
  Object.assign(toggleAllBtn.style, { padding: '4px 8px', background: '#00bcd4', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginLeft: 'auto', fontSize: '14px' });
  settingsRow.append(styleLabel, styleSelect, document.createTextNode(" | "), timerSpan, toggleAllBtn);

  const viewFilterRow = document.createElement('div');
  viewFilterRow.className = "ghost-setting-row"; 
  Object.assign(viewFilterRow.style, { marginBottom: "6px", display: "flex", gap: "6px", alignItems: "center", fontSize: "14px", background: 'rgba(255,255,255,0.7)', padding: '6px', borderRadius: '6px' }); 
  viewFilterRow.innerHTML = "<b>👁️ View: </b>";
  
  const btnAll = document.createElement('button');
  btnAll.innerText = "Show All";
  Object.assign(btnAll.style, { padding:"4px 8px", borderRadius:"4px", cursor:"pointer", fontSize: "14px" });
  
  const btnHigh = document.createElement('button');
  btnHigh.innerText = "Highlighted Only";
  Object.assign(btnHigh.style, { padding:"4px 8px", borderRadius:"4px", cursor:"pointer", fontSize: "14px" });

  // Function to visually differentiate the active filter button
  function updateViewFilterButtons() {
      if (sentenceViewFilter === "all") {
          Object.assign(btnAll.style, { background: "#0288d1", color: "#fff", fontWeight: "bold", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.2)", border: "1px solid #01579b" });
          Object.assign(btnHigh.style, { background: "#e0e0e0", color: "#333", fontWeight: "normal", boxShadow: "none", border: "1px solid #ccc" });
      } else {
          Object.assign(btnHigh.style, { background: "#0288d1", color: "#fff", fontWeight: "bold", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.2)", border: "1px solid #01579b" });
          Object.assign(btnAll.style, { background: "#e0e0e0", color: "#333", fontWeight: "normal", boxShadow: "none", border: "1px solid #ccc" });
      }
  }

  // Initialize button styles
  updateViewFilterButtons();

  btnAll.onclick = () => { 
      sentenceViewFilter = "all"; 
      updateViewFilterButtons();
      selectedIndices.clear(); 
      toggleAllBtn.innerText = "Select All"; 
      renderList(); 
  };
  
  btnHigh.onclick = () => { 
      sentenceViewFilter = "highlighted"; 
      updateViewFilterButtons();
      selectedIndices.clear(); 
      toggleAllBtn.innerText = "Select All"; 
      renderList(); 
  };
  viewFilterRow.append(btnAll, btnHigh);

  const themeRow = document.createElement('div');
  themeRow.className = "ghost-setting-row"; 
  Object.assign(themeRow.style, { display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center', background: 'rgba(255,255,255,0.7)', padding: '6px', borderRadius: '8px', border:'1px solid #b2ebf2', flexWrap: 'wrap' });
  themeRow.innerHTML = `<b>🎨 Theme:</b>`;
  const bgColInput = document.createElement('input'); bgColInput.type="color"; bgColInput.value = themeConfig.bgColor.startsWith('#') ? themeConfig.bgColor : "#ffffff";
  bgColInput.onchange = (e) => { themeConfig.bgColor = e.target.value; themeConfig.bgImage = null; applyTheme(); saveSettings(); };
  
  const fontColInput = document.createElement('input'); fontColInput.type="color"; fontColInput.value = themeConfig.fontColor;
  fontColInput.onchange = (e) => { themeConfig.fontColor = e.target.value; applyTheme(); saveSettings(); };
  
  const fontSelect = document.createElement('select');
  const fonts = ["Verdana, sans-serif", "Arial, sans-serif", "Georgia, serif", "Courier New, monospace", "Comic Sans MS, cursive"];
  fonts.forEach(f => {
      const opt = document.createElement('option'); opt.value = f; opt.innerText = f.split(',')[0]; 
      if(themeConfig.fontFamily === f) opt.selected = true; fontSelect.appendChild(opt);
  });
  fontSelect.onchange = (e) => { themeConfig.fontFamily = e.target.value; applyTheme(); saveSettings(); };
  fontSelect.style.fontSize = "14px";
  fontSelect.style.padding = "2px";

  const fileLabel = document.createElement('label'); fileLabel.innerText = "🖼️ Upload BG"; 
  Object.assign(fileLabel.style, { cursor:'pointer', background:'#eceff1', padding:'2px 5px', borderRadius:'4px', border:'1px solid #ccc', fontSize:'14px' }); 
  const fileUp = document.createElement('input'); fileUp.type="file"; fileUp.accept="image/*"; fileUp.style.display="none";
  fileLabel.appendChild(fileUp);
  fileUp.onchange = (e) => {
      if(e.target.files && e.target.files[0]) { themeConfig.bgImage = URL.createObjectURL(e.target.files[0]); applyTheme(); saveSettings(); }
  };
  themeRow.append(document.createTextNode("Bg: "), bgColInput, document.createTextNode(" Font: "), fontSelect, fontColInput, fileLabel);

  const filterRow = document.createElement('div');
  Object.assign(filterRow.style, { display: 'flex', gap: '8px', marginBottom: '6px' });
  const searchInput = document.createElement('input'); searchInput.placeholder = "🔍 Search text...";
  Object.assign(searchInput.style, { flex: '2', padding: '6px', borderRadius: '4px', border: '1px solid #b2ebf2', fontSize: '14px' });
  const sortSelect = document.createElement('select'); 
  sortSelect.innerHTML = `<option value="default">Default Order</option><option value="attempts_desc">Most Tried</option><option value="attempts_asc">Least Tried</option><option value="date">Last Played</option>`;
  Object.assign(sortSelect.style, { flex: '1', padding: '6px', borderRadius: '4px', border: '1px solid #b2ebf2', fontSize: '14px' });
  filterRow.append(searchInput, sortSelect);

  const flowRow = document.createElement('div');
  flowRow.className = "ghost-setting-row"; 
  Object.assign(flowRow.style, { display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center', background: 'rgba(255,255,255,0.7)', padding: '6px', borderRadius: '8px', border:'1px solid #b2ebf2', flexWrap: 'wrap' });
  const fbLabel = document.createElement('span'); fbLabel.innerText = "Feedback:"; fbLabel.style.fontWeight = "bold";
  const fbSelect = document.createElement('select');
  fbSelect.innerHTML = `<option value="immediate">Intermediate (Popup)</option><option value="batch">Batch (Continuous)</option>`;
  fbSelect.value = feedbackMode; 
  fbSelect.onchange = () => { feedbackMode = fbSelect.value; saveSettings(); };
  Object.assign(fbSelect.style, { padding: '4px', borderRadius: '4px', border: '1px solid #b2ebf2', fontSize: '14px' });
  
  const navLabel = document.createElement('span'); navLabel.innerText = "Next:"; navLabel.style.fontWeight = "bold";
  const navSelect = document.createElement('select');
  navSelect.innerHTML = `<option value="manual">Manual (Enter)</option><option value="automatic">Automatic</option>`;
  navSelect.value = navTrigger; 
  Object.assign(navSelect.style, { padding: '4px', borderRadius: '4px', border: '1px solid #b2ebf2', fontSize: '14px' });
  
  const autoTimeInput = document.createElement('input');
  autoTimeInput.type = "number"; autoTimeInput.value = autoNavDelay; autoTimeInput.placeholder = "Sec";
  Object.assign(autoTimeInput.style, { width: '50px', padding: '4px', borderRadius: '4px', border: '1px solid #b2ebf2', display: (navTrigger === 'automatic') ? 'inline-block' : 'none', fontSize: '14px' });
  
  navSelect.onchange = () => { 
      navTrigger = navSelect.value; 
      autoTimeInput.style.display = (navSelect.value === 'automatic') ? 'inline-block' : 'none'; 
      saveSettings();
  };
  autoTimeInput.onchange = () => { autoNavDelay = parseFloat(autoTimeInput.value) || 2; saveSettings(); };
  flowRow.append(fbLabel, fbSelect, document.createTextNode(" | "), navLabel, navSelect, autoTimeInput);

  const listContainer = document.createElement('div');
  Object.assign(listContainer.style, { maxHeight: '300px', overflowY: 'auto', border: '1px solid #b2ebf2', padding: '6px', borderRadius: '6px', background: 'rgba(255,255,255,0.5)' });

  function renderList() {
    listContainer.innerHTML = "";
    const searchTerm = searchInput.value.toLowerCase();
    activeDataset = (gameMode === "sentence") ? normalData : questionData;
    let seenTexts = new Set();
    let mappedData = [];
    activeDataset.forEach((item, idx) => {
        if (sentenceViewFilter === "highlighted") { if (!item.keyword || item.keyword.trim().length === 0) return; }
        const txt = item.text.trim();
        if (seenTexts.has(txt)) return;
        seenTexts.add(txt);
        const attempts = historyLog.filter(h => h.sentence.includes(item.text)).length;
        const relevantLogs = historyLog.filter(h => h.sentence.includes(item.text));
        const lastDate = relevantLogs.length > 0 ? new Date(relevantLogs[relevantLogs.length-1].date).getTime() : 0;
        if (searchTerm && !txt.toLowerCase().includes(searchTerm)) return;
        mappedData.push({ item, originalIdx: idx, attempts, lastDate });
    });
    const sortMode = sortSelect.value;
    if (sortMode === "attempts_desc") mappedData.sort((a, b) => b.attempts - a.attempts);
    if (sortMode === "attempts_asc") mappedData.sort((a, b) => a.attempts - b.attempts); 
    if (sortMode === "date") mappedData.sort((a, b) => b.lastDate - a.lastDate);
    const visibleData = mappedData.slice(0, listRenderLimit);
    
    visibleData.forEach((d) => {
        const row = document.createElement('div');
        row.className = "ghost-list-row"; 
        row.style.marginBottom = "4px"; row.style.padding = "4px"; row.style.display="flex"; row.style.alignItems="center"; row.style.margin = "0 -4px 4px -4px";
        const chk = document.createElement('input');
        chk.type = "checkbox"; chk.value = d.originalIdx; chk.className = "ghost-item-chk"; chk.id = `ghost-chk-${d.originalIdx}`;
        chk.style.marginRight = "6px";
        chk.checked = selectedIndices.has(d.originalIdx);
        chk.onclick = () => {
            if (chk.checked) selectedIndices.add(d.originalIdx);
            else selectedIndices.delete(d.originalIdx);
            toggleAllBtn.innerText = selectedIndices.size > 1 ? "Deselect All" : "Select All";
        };
        const lbl = document.createElement('label');
        lbl.htmlFor = `ghost-chk-${d.originalIdx}`; lbl.style.flex = "1"; lbl.style.fontSize = "14px"; lbl.style.cursor="pointer";
        lbl.style.display = "flex"; lbl.style.justifyContent = "space-between"; lbl.style.alignItems = "center"; lbl.style.marginRight = "6px"; 
        const txtSpan = document.createElement('span');
        txtSpan.innerHTML = `<b>#${d.originalIdx + 1}</b>: ${d.item.text.substring(0, 60).replace(/"/g, '')}...`;
        const countSpan = document.createElement('span');
        countSpan.style.fontSize = "12px"; countSpan.style.color = "#666"; countSpan.style.marginLeft = "6px"; countSpan.style.whiteSpace = "nowrap";
        countSpan.innerText = `(${d.attempts} tries)`;
        lbl.append(txtSpan, countSpan);
        const rowTimeInput = document.createElement('input');
        rowTimeInput.type = "number"; rowTimeInput.className = "ghost-row-timer"; rowTimeInput.id = `ghost-time-${d.originalIdx}`;
        const savedTime = customTimes[d.originalIdx];
        rowTimeInput.value = savedTime !== undefined ? savedTime : defaultTimerValue;
        rowTimeInput.onchange = () => {
            const newVal = parseInt(rowTimeInput.value) || 10;
            customTimes[d.originalIdx] = newVal;
            chrome.storage.local.set({ 'ghostCustomTimes': customTimes });
        };
        rowTimeInput.style.width = "50px"; rowTimeInput.style.marginLeft = "6px"; rowTimeInput.style.padding = "2px"; rowTimeInput.style.fontSize = "14px"; 
        
        row.append(chk, lbl, rowTimeInput); 
        listContainer.appendChild(row);
    });
    
    if (mappedData.length > listRenderLimit) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.innerHTML = `⬇️ Load Next ${LIST_RENDER_STEP} Items (Showing ${listRenderLimit} of ${mappedData.length})`;
        Object.assign(loadMoreBtn.style, { width: '100%', padding: '8px', marginTop: '6px', background: '#b2ebf2', color: '#006064', border: '1px solid #00bcd4', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' });
        loadMoreBtn.onclick = () => { listRenderLimit += LIST_RENDER_STEP; renderList(); };
        listContainer.appendChild(loadMoreBtn);
    }
    toggleAllBtn.innerText = selectedIndices.size > 1 ? "Deselect All" : "Select All";
  }

  renderList();
  searchInput.addEventListener('input', () => { listRenderLimit = 50; renderList(); });
  sortSelect.addEventListener('change', renderList);
  toggleAllBtn.onclick = () => {
    const allChk = document.querySelectorAll('.ghost-item-chk');
    if (toggleAllBtn.innerText === "Deselect All") {
        allChk.forEach(c => { c.checked = false; selectedIndices.delete(parseInt(c.value)); });
        toggleAllBtn.innerText = "Select All";
    } else {
        allChk.forEach(c => { c.checked = true; selectedIndices.add(parseInt(c.value)); });
        if (selectedIndices.size > 1) toggleAllBtn.innerText = "Deselect All";
    }
  };

  const startBtn = document.createElement('button');
  startBtn.innerText = "START SESSION";
  Object.assign(startBtn.style, { marginTop: '8px', width: '100%', padding: '10px', background: '#0288d1', color: 'white', border: 'none', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }); 
  startBtn.onclick = () => {
    workQueue = [];
    selectedIndices.forEach((idx) => {
        const timeInput = document.getElementById(`ghost-time-${idx}`);
        const val = timeInput ? parseInt(timeInput.value) : defaultTimerValue;
        if (activeDataset[idx]) { workQueue.push({ ...activeDataset[idx], customTime: val || 10 }); }
    });
    if (workQueue.length === 0) return alert("Select at least one item!");
    const source = (gameMode === "sentence") ? normalData : questionData;
    workQueue.sort((a,b) => source.indexOf(a) - source.indexOf(b));
    isClozeMode = (styleSelect.value === "cloze");
    isChallengeMode = timerChk.checked;
    feedbackMode = fbSelect.value;
    navTrigger = navSelect.value;
    autoNavDelay = parseFloat(autoTimeInput.value) || 2;
    saveSettings(); 
    currentBatchIndex = 0; 
    startLevel();
  };

  const examBtn = document.createElement('button');
  examBtn.innerText = "📝 START AI EXAM";
  Object.assign(examBtn.style, { marginTop: '6px', width: '100%', padding: '10px', background: '#ffa000', color: 'white', border: 'none', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' });
  examBtn.onclick = () => {
    if (questionData.length === 0) return alert("No Exam Questions (Q:) found!");
    renderAIExam();
  };
  
  wrapper.append(modeRow, viewFilterRow, themeRow, filterRow, settingsRow, flowRow, listContainer, startBtn, examBtn);
  container.appendChild(wrapper);
}

// --- NEW START PAGE CONFIGURATION (REPLICATES POPUP UI AND LOADS FILE) ---
function renderStartPage() {
    const container = document.getElementById('ghost-content-area');
    
    container.innerHTML = `
      <div style="display: flex; justify-content: center; padding: 10px;">
        <div class="ghost-start-box" style="width: 340px; padding: 20px; font-family: 'Verdana', sans-serif; background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: #333; text-align: center; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
          
          <div style="margin-bottom: 12px;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="60" height="60">
              <circle cx="50" cy="50" r="45" fill="#FFEB3B" stroke="#FBC02D" stroke-width="2"/> 
              <circle cx="35" cy="40" r="5" fill="#333"/> 
              <circle cx="65" cy="40" r="5" fill="#333"/> 
              <path d="M 30 65 Q 50 80 70 65" stroke="#333" stroke-width="4" fill="none" stroke-linecap="round"/> 
            </svg>
          </div>
          
          <h3 style="font-size: 20px; margin: 5px 0 15px 0; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">Happy Reader AI</h3>
          
          <div style="margin-bottom: 8px; position: relative;">
            <input type="file" id="ghost-file-input" accept=".txt, .html, .htm" style="width: 100%; padding: 8px; box-sizing: border-box; border-radius: 20px; border: 2px solid rgba(255, 255, 255, 0.6); background: rgba(255, 255, 255, 0.9); color: #333; font-size: 14px; outline: none; font-family: 'Verdana', sans-serif; text-align: center;">
          </div>
          
          <div id="ghost-status" style="font-size: 13px; margin-top: 6px; min-height: 18px; font-weight: bold; color: #fff;">✅ Ready: Continue with loaded data</div>
          
          <hr style="border: 0; height: 1px; background: rgba(255, 255, 255, 0.5); margin: 12px 0;">
          
          <div style="margin-bottom: 8px; position: relative;">
            <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 16px;">🔑</span>
            <input type="password" id="ghost-api-key" placeholder="Gemini API Key (Optional)" value="${geminiKey}" style="width: 100%; padding: 8px 8px 8px 34px; box-sizing: border-box; border-radius: 20px; border: 2px solid rgba(255, 255, 255, 0.6); background: rgba(255, 255, 255, 0.9); color: #333; font-size: 14px; outline: none; font-family: 'Verdana', sans-serif;">
          </div>
          
          <div style="margin-bottom: 8px; position: relative;">
            <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 16px;">👤</span>
            <input type="text" id="ghost-username" placeholder="Student Name" value="${currentUser}" style="width: 100%; padding: 8px 8px 8px 34px; box-sizing: border-box; border-radius: 20px; border: 2px solid rgba(255, 255, 255, 0.6); background: rgba(255, 255, 255, 0.9); color: #333; font-size: 14px; outline: none; font-family: 'Verdana', sans-serif;">
          </div>
          
          <div style="margin-bottom: 8px; position: relative;">
            <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 16px;">📧</span>
            <input type="email" id="ghost-owner-email" placeholder="Teacher Email" value="${ownerEmail}" style="width: 100%; padding: 8px 8px 8px 34px; box-sizing: border-box; border-radius: 20px; border: 2px solid rgba(255, 255, 255, 0.6); background: rgba(255, 255, 255, 0.9); color: #333; font-size: 14px; outline: none; font-family: 'Verdana', sans-serif;">
          </div>
          
          <button id="ghost-start-session-btn" style="width: 100%; padding: 10px; margin-top: 8px; border-radius: 20px; border: none; background: white; color: #00c6ff; font-size: 16px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 15px rgba(0,0,0,0.1); transition: transform 0.2s;">START SESSION 🚀</button>
        </div>
      </div>
    `;

    const fileInput = document.getElementById('ghost-file-input');
    const statusDiv = document.getElementById('ghost-status');

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            statusDiv.innerText = "📁 Selected: " + fileInput.files[0].name;
            statusDiv.style.color = "#FFEB3B";
        }
    });

    document.getElementById('ghost-start-session-btn').onclick = () => {
        geminiKey = document.getElementById('ghost-api-key').value;
        currentUser = document.getElementById('ghost-username').value || "Student";
        ownerEmail = document.getElementById('ghost-owner-email').value;
        
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            statusDiv.innerText = "⏳ Loading " + file.name + "...";
            
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target.result;
                let parsedData = [];
                let seenParsedTexts = new Set(); // FIXED: Extra deduplication during parse phase
                
                if (file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm')) {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(content, 'text/html');
                    const blockTags = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD']);
                    const blocks = doc.body ? doc.body.querySelectorAll('*') : [];
                    let foundBlocks = false;
                    
                    blocks.forEach(el => {
                        if (blockTags.has(el.tagName.toUpperCase())) {
                            let hasBlockChild = Array.from(el.children).some(child => blockTags.has(child.tagName.toUpperCase()));
                            if (!hasBlockChild) {
                                let text = el.textContent.replace(/\s+/g, ' ').trim();
                                if (text && !seenParsedTexts.has(text)) {
                                    seenParsedTexts.add(text);
                                    let kws = [];
                                    el.querySelectorAll('u, b, strong, mark, em, font, span[style]').forEach(m => {
                                        let t = m.textContent.replace(/\s+/g, ' ').trim();
                                        if(t) kws.push(t);
                                    });
                                    parsedData.push({ text: text, keyword: [...new Set(kws)].join(',') });
                                    foundBlocks = true;
                                }
                            }
                        }
                    });
                    
                    if (!foundBlocks && doc.body) {
                        const lines = doc.body.textContent.split('\n');
                        lines.forEach(l => {
                            let t = l.trim();
                            if(t && !seenParsedTexts.has(t)) {
                                seenParsedTexts.add(t);
                                parsedData.push({ text: t, keyword: "" });
                            }
                        });
                    }
                } else {
                    const lines = content.split('\n');
                    lines.forEach(l => {
                        let text = l.trim();
                        if (text && !seenParsedTexts.has(text)) {
                            seenParsedTexts.add(text);
                            parsedData.push({ text: text, keyword: "" });
                        }
                    });
                }
                
                chrome.storage.local.set({ 'scriptData': parsedData }, () => {
                    loadSettings((hasData) => {
                        if (hasData) {
                            selectedIndices.clear(); 
                            renderSelectionPage();
                        } else {
                            statusDiv.innerText = "❌ No content found in file";
                            statusDiv.style.color = "#ff5252";
                        }
                    });
                });
            };
            reader.readAsText(file);
        } else {
            renderSelectionPage();
        }
    };
}


// --- DATA MANAGEMENT HELPERS ---
function performBackup() {
    chrome.storage.local.get(null, (items) => {
        const jsonContent = JSON.stringify(items, null, 2);
        const filename = `GhostReader_Backup.json`; 
        saveFileAs(jsonContent, filename, 'application/json');
    });
}

function performRestore(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (confirm("WARNING: This will overwrite ALL current extension data. Continue?")) {
                chrome.storage.local.clear(() => {
                    chrome.storage.local.set(data, () => {
                        alert("Data restored!");
                        loadSettings((hasData) => { renderSelectionPage(); });
                    });
                });
            }
        } catch (err) { alert("Error: Invalid Backup File!"); }
    };
    reader.readAsText(file);
}

// --- SESSION LOGIC ---
function startLevel() {
  stopTimer();
  stopTTS(); 
  itemFinished = false; 
  canProceed = false; 
  hasStartedTyping = false;
  forceFocus = true; 
  
  const container = document.getElementById('ghost-content-area');
  container.innerHTML = ""; 
  
  levelStartTime = Date.now();
  const actualStartIndex = currentBatchIndex * batchSize;
  if (actualStartIndex >= workQueue.length) { showFinishScreen(); return; }

  currentLevelState.data = workQueue.slice(actualStartIndex, actualStartIndex + batchSize);
  currentLevelState.foundKeywords = []; 
  currentLevelState.allocatedTime = currentLevelState.data.reduce((acc, item) => acc + (item.customTime || 10), 0);
  updateLevelState(); 
  
  if (ttsEnabled) {
     speakText(currentLevelState.combinedText);
  }

  const navBar = document.createElement('div');
  navBar.style.display = "flex"; navBar.style.justifyContent = "space-between"; navBar.style.marginBottom = "6px"; navBar.style.alignItems = "center";
  
  const jumpSelect = document.createElement('select');
  jumpSelect.style.padding = "4px"; jumpSelect.style.fontSize = "14px";
  workQueue.forEach((item, idx) => {
      const opt = document.createElement('option'); opt.value = idx; opt.innerText = `Phrase ${idx + 1}`; 
      if (idx === currentBatchIndex) opt.selected = true; jumpSelect.appendChild(opt);
  });
  jumpSelect.onchange = (e) => { currentBatchIndex = parseInt(e.target.value); startLevel(); };
  
  const timerGroup = document.createElement('div');
  const timerDisplay = document.createElement('span');
  timerDisplay.id = "ghost-timer"; timerDisplay.style.color = themeConfig.fontColor; timerDisplay.style.fontWeight = "bold"; timerDisplay.style.marginRight = "8px"; timerDisplay.style.fontSize = "14px";
  
  const bestRecord = bestTimes[currentLevelState.combinedText] || null;
  const bestBadge = document.createElement('span');
  bestBadge.id = "ghost-status-badge"; 
  Object.assign(bestBadge.style, { background: "#fff9c4", color: "#f9a825", padding: "2px 6px", borderRadius: "12px", fontWeight: "bold", fontSize: "13px", border: "1px solid #fbc02d" }); 
  bestBadge.innerHTML = bestRecord ? `🏆 Best: ${parseFloat(bestRecord).toFixed(2)}s` : `🏆 Best: --`;

  timerGroup.append(timerDisplay, bestBadge);
  navBar.append(jumpSelect, timerGroup);
  container.appendChild(navBar);

  if (isChallengeMode) startTimer(currentLevelState.allocatedTime);

  const textDiv = document.createElement('div');
  textDiv.id = "ghost-text";
  
  Object.assign(textDiv.style, { 
    marginBottom: "8px", 
    fontSize: "24px", 
    fontWeight: "500", color: "#01579b", 
    minHeight: "80px", padding: "10px", 
    lineHeight: "1.6", 
    border: "1px solid #b3e5fc", borderRadius: "8px", background: "#fafafa",
    cursor: "pointer", opacity: "1", transition: "all 0.2s ease",
    whiteSpace: "pre-wrap", 
    overflowWrap: "break-word", 
    wordBreak: "break-word", 
    textAlign: "left"
  });

  renderTextView(textDiv);
  textDiv.onclick = () => { doPeek(textDiv); };

  const ttsRow = document.createElement('div');
  ttsRow.style.marginBottom = "6px"; ttsRow.style.display="flex"; ttsRow.style.gap="4px"; ttsRow.style.justifyContent="center";
  const ttsBtn = createButton(ttsEnabled ? "🔊 Reading ON" : "🔇 Reading OFF", ttsEnabled ? "#4caf50" : "#9e9e9e");
  ttsBtn.style.minWidth = "100px";
  ttsBtn.onclick = () => { 
      ttsEnabled = !ttsEnabled; 
      saveSettings(); 
      ttsBtn.innerText = ttsEnabled ? "🔊 Reading ON" : "🔇 Reading OFF"; 
      ttsBtn.style.background = ttsEnabled ? "#4caf50" : "#9e9e9e"; 
  };
  const playBtn = createButton("Play", "#039be5"); playBtn.onclick = () => speakText(currentLevelState.combinedText);
  const pauseBtn = createButton("Pause", "#039be5"); pauseBtn.onclick = () => synth.pause();
  const resumeBtn = createButton("Resume", "#039be5"); resumeBtn.onclick = () => synth.resume();
  const stopBtn = createButton("Stop", "#d32f2f"); stopBtn.onclick = stopTTS;
  ttsRow.append(ttsBtn, playBtn, pauseBtn, resumeBtn, stopBtn);

  const statsRow = document.createElement('div');
  statsRow.id = "ghost-stats-row";
  statsRow.className = "ghost-setting-row"; // Hover class applied
  Object.assign(statsRow.style, {
      display: 'flex', gap: '10px', marginBottom: '6px', fontSize: '14px', 
      color: '#455a64', background: '#e1f5fe', padding: '6px', borderRadius: '5px'
  });
  const totalKeySpan = document.createElement('span');
  totalKeySpan.innerHTML = `Total Keywords: <b id="ghost-cnt-total">0</b>`;
  const correctKeySpan = document.createElement('span');
  correctKeySpan.innerHTML = `Found: <b id="ghost-cnt-found" style="color:#2e7d32">0</b>`;
  statsRow.append(totalKeySpan, correctKeySpan);

  const input = document.createElement('input');
  input.type = "text"; input.id = "ghost-user-input"; input.autocomplete="off";
  input.placeholder = "Type words to reveal...";
  Object.assign(input.style, { width: "100%", padding: "8px", borderRadius: "8px", border: "2px solid #4fc3f7", fontSize: "18px", outline: "none" }); 
  setTimeout(() => input.focus(), 50); 
  
  input.onblur = () => { 
      if (forceFocus && !itemFinished) { 
          setTimeout(() => {
              const active = document.activeElement;
              if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active !== input) {
                  return; 
              }
              if (forceFocus) input.focus();
          }, 150); 
      }
  };
  
  input.onfocus = () => {
      forceFocus = true;
  };

  const feedbackDiv = document.createElement('div'); 
  feedbackDiv.id = "ghost-input-feedback"; feedbackDiv.style.marginTop="4px"; feedbackDiv.style.color="#43a047"; feedbackDiv.style.fontSize="14px";

  const navRow = document.createElement('div');
  navRow.style.marginTop = "8px"; navRow.style.display = "flex"; navRow.style.gap="6px";
  const backBtn = createButton(currentBatchIndex === 0 ? "🏠 Menu" : "⬅️ Previous", "#90a4ae"); 
  backBtn.onclick = () => { if(currentBatchIndex === 0) renderSelectionPage(); else { currentBatchIndex--; startLevel(); } };
  const micBtn = createButton("🎤 Voice", "#29b6f6");
  micBtn.onclick = () => toggleVoice(input);
  
 const nextBtn = createButton("Next ➡️", "#ffb74d");
  nextBtn.onclick = () => { 
      stopTimer();
      stopTTS();
      currentBatchIndex++; 
      startLevel(); 
  };
  navRow.append(backBtn, micBtn, nextBtn);

  const toolsRow = document.createElement('div');
  toolsRow.style.marginTop = "6px"; toolsRow.style.display = "flex"; toolsRow.style.gap = "6px"; toolsRow.style.alignItems = "stretch";
  const peekBtn = createButton("👁️ Peek", "#ffca28"); peekBtn.onclick = () => doPeek(textDiv);
  const knowBtn = createButton("🧠 I Know", "#66bb6a"); knowBtn.onclick = () => finishItem("Known (Skipped)");
  const addGroup = document.createElement('div'); addGroup.style.display = "flex"; addGroup.style.flex = "1";
  const addInput = document.createElement('input'); addInput.type = "number"; addInput.value = "1"; 
  Object.assign(addInput.style, { width: "40px", padding: "0", textAlign: "center", borderRadius: "5px 0 0 5px", border: "1px solid #0277bd", backgroundColor: "#fff176", color: "#000", fontWeight: "bold", fontSize: "14px" });
  const addBtn = createButton("+ Add", "#0277bd"); addBtn.style.borderRadius = "0 5px 5px 0";
  addBtn.onclick = () => {
      const num = parseInt(addInput.value) || 1;
      const nextStart = actualStartIndex + currentLevelState.data.length;
      const moreItems = workQueue.slice(nextStart, nextStart + num);
      if(moreItems.length===0) return alert("No more items.");
      currentLevelState.data = [...currentLevelState.data, ...moreItems];
      updateLevelState(); renderTextView(textDiv); if(ttsEnabled) speakText(moreItems.map(d=>d.text).join(' ')); updateStatsUI(input.value); 
      forceFocus = true;
      input.focus();
  };
  addGroup.append(addInput, addBtn);
  const endBtn = createButton("⏹️ End", "#757575"); endBtn.onclick = () => showFinishScreen();
  toolsRow.append(peekBtn, knowBtn, addGroup, endBtn);

  input.addEventListener('input', () => {
      if (itemFinished) {
          input.value = "Success! Press ENTER to continue ➡️";
          return; 
      }

      const val = input.value;
      if (textDiv.dataset.revealed === "true") { textDiv.dataset.revealed = "false"; renderTextView(textDiv); }
      
      if (!hasStartedTyping) {
          hasStartedTyping = true;
          renderTextView(textDiv);
      }

      if (!itemFinished) {
          const allKeywords = parseKeywords(currentLevelState.combinedKeywords);
          let newFind = false;
          
          allKeywords.forEach(group => {
              const cleanGroup = group.map(v => v.replace(/_/g, ' ').toLowerCase());
              const matchFound = cleanGroup.some(kw => val.toLowerCase().includes(kw));

              if (matchFound) {
                  const actualMatch = cleanGroup.find(kw => val.toLowerCase().includes(kw));
                  const groupAlreadySatisfied = currentLevelState.foundKeywords.some(k => cleanGroup.includes(k));

                  if (!groupAlreadySatisfied && actualMatch) {
                      currentLevelState.foundKeywords.push(actualMatch);
                      newFind = true;
                      input.value = ""; 
                      input.style.borderColor = "#66bb6a"; setTimeout(()=>input.style.borderColor = "#4fc3f7", 300);
                  }
              }
          });
          
          if (newFind) {
              renderTextView(textDiv); 
              checkCompletion(); 
          }
      }
      updateStatsUI(val);
  });

  input.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
          if (itemFinished && navTrigger === 'manual') { 
              if(canProceed) {
                  if(feedbackMode === 'immediate') {
                      showResultModal(historyLog[historyLog.length-1]);
                  } else {
                      currentBatchIndex++; 
                      startLevel(); 
                  }
              }
              return; 
          }
          
          const allGroups = parseKeywords(currentLevelState.combinedKeywords);
          const satisfiedCount = allGroups.filter(g => {
              const cleanG = g.map(v => v.replace(/_/g, ' ').toLowerCase());
              return cleanG.some(word => currentLevelState.foundKeywords.includes(word));
          }).length;

          if (satisfiedCount >= allGroups.length) {
              finishItem("Manual Finish");
          } else {
              input.style.borderColor = "red";
              const oldPlaceholder = input.placeholder;
              input.value = "";
              input.placeholder = "⚠️ Find all keywords to proceed!";
              setTimeout(() => {
                  input.style.borderColor = "#4fc3f7";
                  input.placeholder = oldPlaceholder;
              }, 1200);
          }
      }
  });
  container.append(textDiv, ttsRow, statsRow, input, feedbackDiv, navRow, toolsRow);
  updateStatsUI(""); 
}

function renderTextView(textDiv) {
    if (!hasStartedTyping) {
        textDiv.innerHTML = currentLevelState.combinedText;
    } else {
        if (isClozeMode) {
            textDiv.innerHTML = formatClozeText(currentLevelState.combinedText, currentLevelState.foundKeywords);
        } else {
            textDiv.innerHTML = formatClassicHighlights(currentLevelState.combinedText, currentLevelState.foundKeywords);
        }
    }
    textDiv.style.opacity = "1";
}

function doPeek(textDiv) {
    document.getElementById('ghost-user-input').focus();
    if (textDiv.dataset.revealed === "true") { textDiv.dataset.revealed = "false"; renderTextView(textDiv); } 
    else { textDiv.innerHTML = currentLevelState.combinedText; textDiv.style.opacity = "1"; textDiv.dataset.revealed = "true"; }
}

function formatClassicHighlights(target, found) {
    const allGroups = parseKeywords(currentLevelState.combinedKeywords);
    
    let flatKeys = [];
    allGroups.forEach(g => g.forEach(k => flatKeys.push(k.replace(/_/g, ' '))));
    flatKeys.sort((a, b) => b.length - a.length);

    let formatted = target;
    flatKeys.forEach(key => {
        const keyLower = key.toLowerCase();
        const isFound = found.some(fw => fw === keyLower || allGroups.some(g => g.includes(fw) && g.map(x=>x.toLowerCase()).includes(keyLower)));
        
        const regex = new RegExp(`(###(?:FOUND|HIDDENKEY):[\\s\\S]*?###)|(${escapeRegExp(key)})`, 'gi');
        formatted = formatted.replace(regex, (match, tag, kw) => {
            if (tag) return tag; 
            if (kw) {
                if (isFound) {
                    return `###FOUND:${kw}###`;
                } else {
                    return `###HIDDENKEY:______###`;
                }
            }
            return match;
        });
    });

    const parts = formatted.split('###');
    return parts.map(part => {
        if (part.startsWith('FOUND:')) {
            return `<span style="color:#2e7d32; font-weight:bold; border-bottom:2px solid #2e7d32;">${part.replace('FOUND:', '')}</span>`;
        } else if (part.startsWith('HIDDENKEY:')) {
             return `<span style="color:#e0e0e0; background:#e0e0e0; border-radius:3px; padding:0 3px;">______</span>`;
        } else {
            return part.replace(/[a-zA-Z0-9]/g, '_'); 
        }
    }).join('');
}

function formatClozeText(target, found) {
    const allGroups = parseKeywords(currentLevelState.combinedKeywords);
    
    let flatKeys = [];
    allGroups.forEach(g => g.forEach(k => flatKeys.push(k.replace(/_/g, ' '))));
    flatKeys.sort((a, b) => b.length - a.length);

    let formatted = target;
    flatKeys.forEach(key => {
        const keyLower = key.toLowerCase();
        const isFound = found.some(fw => fw === keyLower || allGroups.some(g => g.includes(fw) && g.map(x=>x.toLowerCase()).includes(keyLower)));
        
        const regex = new RegExp(`(###(?:FOUND|HIDDEN):[\\s\\S]*?###)|(${escapeRegExp(key)})`, 'gi');
        formatted = formatted.replace(regex, (match, tag, kw) => {
            if (tag) return tag; 
            if (kw) {
                if (isFound) {
                    return `###FOUND:${kw}###`;
                } else {
                    return `###HIDDEN:______###`;
                }
            }
            return match;
        });
    });

    const parts = formatted.split('###');
    return parts.map(part => {
        if (part.startsWith('FOUND:')) {
            return `<span style="color:#2e7d32; font-weight:bold; border-bottom:2px solid #2e7d32;">${part.replace('FOUND:', '')}</span>`;
        } else if (part.startsWith('HIDDEN:')) {
            return `<span style="color:#e0e0e0; background:#e0e0e0; border-radius:3px; padding:0 3px;">______</span>`;
        } else {
            return part;
        }
    }).join('');
}

function updateStatsUI(val) {
    const feedback = document.getElementById('ghost-input-feedback');
    const totalEl = document.getElementById('ghost-cnt-total');
    const foundEl = document.getElementById('ghost-cnt-found');
    if (!feedback) return;
    
    const allGroups = parseKeywords(currentLevelState.combinedKeywords);
    let found = [];
    
    allGroups.forEach((g) => {
        const cleanG = g.map(v => v.replace(/_/g, ' ').toLowerCase());
        const matchedWords = cleanG.filter(w => currentLevelState.foundKeywords.includes(w));
        matchedWords.forEach(w => found.push(w + "✅"));
    });
    
    found = [...new Set(found)];
    feedback.innerHTML = found.join(" ");

    const satisfiedGroupCount = allGroups.filter(g => {
        const cleanG = g.map(v => v.replace(/_/g, ' ').toLowerCase());
        return cleanG.some(word => currentLevelState.foundKeywords.includes(word));
    }).length;

    if (totalEl) totalEl.innerText = allGroups.length; 
    if (foundEl) foundEl.innerText = satisfiedGroupCount; 
}

function checkCompletion() {
    const allGroups = parseKeywords(currentLevelState.combinedKeywords);
    const satisfiedCount = allGroups.filter(g => {
        const cleanG = g.map(v => v.replace(/_/g, ' ').toLowerCase());
        return cleanG.some(word => currentLevelState.foundKeywords.includes(word));
    }).length;
    
    if (satisfiedCount >= allGroups.length) {
         if (navTrigger === 'automatic') finishItem(isClozeMode ? "Cloze" : "Classic");
    }
}

function finishItem(method) {
    stopTimer();
    itemFinished = true;
    canProceed = false; 
    const input = document.getElementById('ghost-user-input');
    
    input.style.background = "#e8f5e9";
    
    const now = Date.now();
    const duration = (now - levelStartTime) / 1000;
    const batchKey = currentLevelState.combinedText;
    let best = bestTimes[batchKey] || Infinity;
    if (duration < best) { best = duration; bestTimes[batchKey] = duration; chrome.storage.local.set({ ghostBestTimes: bestTimes }); }
    const deviation = (best !== Infinity) ? (duration - best).toFixed(2) : "0.00";
    
    const badge = document.getElementById('ghost-status-badge');
    if(badge) {
        badge.innerHTML = `⏱️ ${duration.toFixed(2)}s | 🏆 Best: ${parseFloat(best).toFixed(2)}s`;
        badge.style.background = "#c8e6c9"; badge.style.color = "#2e7d32"; badge.style.borderColor = "#43a047";
    }

    const record = {
        date: new Date().toLocaleString(), sentence: batchKey, time: duration.toFixed(2),
        method: method, best: best.toFixed(2), deviation: deviation,
        timeLimit: currentLevelState.allocatedTime, gameMode: gameMode 
    };
    historyLog.push(record);
    chrome.storage.local.set({ ghostHistory: historyLog });

    if (navTrigger === 'manual') {
        canProceed = true;
        input.value = "Success! Press ENTER to continue ➡️";
        input.focus();
    } else { 
        input.value = "Correct! (Next in " + autoNavDelay + "s...)"; 
        setTimeout(() => { 
            if(feedbackMode === 'immediate') {
                showResultModal(record);
            } else {
                currentBatchIndex++; 
                startLevel(); 
            }
        }, (autoNavDelay || 2) * 1000); 
    }
}

function showResultModal(currentRecord) {
    const container = document.getElementById('ghost-content-area');
    container.innerHTML = ""; 
    const modal = document.createElement('div'); modal.style.textAlign = "center";
    const devVal = parseFloat(currentRecord.deviation); const devSign = devVal > 0 ? "+" : "";
    const myHistory = historyLog.filter(h => h.sentence === currentRecord.sentence).sort((a, b) => parseFloat(a.time) - parseFloat(b.time)).slice(0, 10); 
    let tableHtml = `<table style="width:100%; border-collapse:collapse; margin-top:10px; font-size:14px; text-align:left; color:#006064;"><tr style="border-bottom:1px solid #b2ebf2;"><th style="padding:4px;">Date</th><th style="padding:4px;">Time</th><th style="padding:4px;">Dev</th></tr>`; 
    myHistory.forEach(h => { tableHtml += `<tr style="border-bottom:1px solid #e0f7fa;"><td style="padding:4px;">${h.date.split(',')[0]}</td><td style="padding:4px;">${h.time}s</td><td style="padding:4px;">${h.deviation}</td></tr>`; });
    tableHtml += "</table>";

    modal.innerHTML = `
        <h3 style="color:${themeConfig.fontColor}; font-size:20px; margin-bottom:8px;">Great Job!</h3>
        <div style="background:rgba(255,255,255,0.8); padding:8px; border-radius:8px; border:1px solid #b2ebf2;">
             <div style="font-size:16px; margin-bottom:4px;">⏱️ Time: <b>${currentRecord.time}s</b></div>
             <div style="margin:6px 0;">
                <span style="background:#FFFFFF; color:#C154C1; padding:4px 10px; border-radius:4px; font-weight:bold; font-size:14px; border:1px solid a0a0a0;">
                    🏆 Best Time: ${currentRecord.best}s
                </span>
             </div>
             <div style="color:#43a047; font-weight:bold; font-size:14px; margin-top:4px;">Dev: ${devSign}${currentRecord.deviation}s</div>
        </div>
        ${tableHtml}
    `;
    const btnRow = document.createElement('div'); btnRow.style.display="flex"; btnRow.style.gap="8px"; btnRow.style.justifyContent="center"; btnRow.style.marginTop="15px";
    const redoBtn = createButton("🔄 Redo", "#ffb74d"); redoBtn.onclick = () => { startLevel(); };
    const menuBtn = createButton("🏠 Menu", "#90a4ae"); menuBtn.onclick = () => { renderSelectionPage(); };
    const nextBtn = createButton("Next ➡️", "#0288d1"); nextBtn.onclick = () => { currentBatchIndex++; startLevel(); };
    btnRow.append(redoBtn, menuBtn, nextBtn);
    modal.appendChild(btnRow); container.appendChild(modal);
}

function toggleVoice(input) {
    if (!('webkitSpeechRecognition' in window)) return alert("Voice API missing");
    if (recognition) { recognition.stop(); recognition = null; input.placeholder="Voice stopped."; return; }
    
    recognition = new webkitSpeechRecognition();
    recognition.continuous = true; 
    recognition.interimResults = false; 
    recognition.lang = 'en-US';
    
    recognition.onstart = () => { input.placeholder = "Listening (Editing)..."; input.style.background = "#fff3e0"; };
    
    recognition.onresult = (e) => {
        let transcript = e.results[e.results.length - 1][0].transcript.trim();
        
        const startPos = input.selectionStart;
        const endPos = input.selectionEnd;
        const originalText = input.value;
        
        const textBefore = originalText.substring(0, startPos);
        const textAfter = originalText.substring(endPos, originalText.length);
        
        const newText = textBefore + transcript + " " + textAfter;
        input.value = newText;
        
        const newCursorPos = startPos + transcript.length + 1;
        input.setSelectionRange(newCursorPos, newCursorPos);

        input.dispatchEvent(new Event('input'));
        
        if (transcript.toLowerCase() === "enter" || transcript.toLowerCase() === "next") {
            recognition.stop();
            checkCompletion();
        }
    };
    
    recognition.start(); 
}

function speakText(t) { 
    if('speechSynthesis' in window) { 
        window.speechSynthesis.cancel(); 
        currentUtterance = new SpeechSynthesisUtterance(t);
        window.speechSynthesis.speak(currentUtterance); 
    }
}
function stopTTS() { window.speechSynthesis.cancel(); }

function startTimer(sec) { 
    let t = sec; 
    const el = document.getElementById('ghost-timer'); 
    const update = () => { if(el) el.innerText = `⏳ ${t}s`; }; 
    update(); 
    
    timerInterval = setInterval(() => { 
        t--; 
        update(); 
        if (t <= 0) { 
            stopTimer(); 
            if (el) el.innerText = "Time Up!"; 
            const txtDiv = document.getElementById('ghost-text');
            if(txtDiv) { txtDiv.style.opacity="1"; txtDiv.dataset.revealed="true"; }
            
            const inp = document.getElementById('ghost-user-input');
            if(inp) {
                inp.disabled = true;
                inp.placeholder = "Time Up! (Locked)";
                inp.style.backgroundColor = "#ffebee";
            }
        } 
    }, 1000); 
}

function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }

function parseKeywords(k) { 
    return k.toLowerCase().split(',').filter(w => w.trim().length > 0).map(t => t.split('/').map(v => v.trim().replace(/_/g, ' '))); 
}

function updateLevelState() { currentLevelState.combinedText = currentLevelState.data.map(d => d.text).join(' '); currentLevelState.combinedKeywords = currentLevelState.data.map(d => d.keyword).join(','); }

function createButton(t, c) { const b=document.createElement('button'); b.innerText=t; Object.assign(b.style, {flex:1, padding:'6px 10px', background:c, color:'white', border:'none', borderRadius:'4px', cursor:'pointer', minWidth:'80px', fontSize:'14px'}); return b; } 

function showFinishScreen() {
    const container = document.getElementById('ghost-content-area');
    container.innerHTML = `<h2 style="color:${themeConfig.fontColor}; margin-top: 0; font-size: 20px;">Session Complete</h2>`;
    const dlBtn = createButton("Download History", "#43a047"); dlBtn.style.width = "100%"; 
    dlBtn.onclick = downloadCSV;
    
    const dataRow = document.createElement('div');
    Object.assign(dataRow.style, { display: 'flex', gap: '8px', marginTop: '10px', marginBottom: '10px', justifyContent: 'center' });
    
    const backupBtn = createButton("💾 Backup All", "#5c6bc0");
    backupBtn.onclick = performBackup;

    const restoreBtn = createButton("📂 Restore Data", "#3949ab");
    const restoreInput = document.createElement('input'); 
    restoreInput.type = "file"; restoreInput.accept = ".json"; restoreInput.style.display = "none";
    restoreBtn.onclick = () => restoreInput.click();
    restoreInput.onchange = (e) => { if(e.target.files.length) performRestore(e.target.files[0]); };

    dataRow.append(backupBtn, restoreBtn, restoreInput);
    
    const resetBtn = createButton("Reset History", "#0277bd"); resetBtn.style.width = "100%";
    resetBtn.onclick = () => { if(confirm("Clear all history?")) { chrome.storage.local.set({ghostHistory:[], ghostBestTimes:{}}); alert("History Cleared"); }};
    const examBtn = createButton("Start AI Exam", "#ffa000"); examBtn.style.width = "100%"; examBtn.onclick = renderAIExam;
    
    const bottomRow = document.createElement('div'); bottomRow.style.marginTop = "15px"; bottomRow.style.display="flex"; bottomRow.style.gap="8px";
    
    const returnBtn = createButton("🔄 Return to Menu", "#0277bd"); 
    returnBtn.onclick = () => { renderSelectionPage(); };
    
    const goHomeBtn = createButton("🏠 Start Menu", "#757575"); 
    goHomeBtn.onclick = renderStartPage;
    
    bottomRow.append(returnBtn, goHomeBtn);
    
    container.append(dlBtn, dataRow, resetBtn, document.createElement('br'), document.createElement('br'), examBtn, bottomRow);
}

function downloadCSV() {
    let csvContent = "data:text/csv;charset=utf-8,Student,Date,Sentence,Method,Time(s),Deviation(s)\n";
    historyLog.forEach((row) => { csvContent += `${currentUser},${row.date},"${row.sentence.replace(/"/g, '""')}",${row.method},${row.time},${row.deviation}\n`; });
    
    const filename = `${currentUser}_History.csv`;
    saveFileAs(csvContent, filename, 'text/csv');
}

function renderAIExam() {
  const container = document.getElementById('ghost-content-area'); 
  container.innerHTML = `<h2 style="color:${themeConfig.fontColor}; margin-top:0; margin-bottom:10px; font-size:20px;">AI Exam</h2>`;
  
  const navRow = document.createElement('div'); 
  navRow.style.marginBottom = "6px"; navRow.style.display="flex"; navRow.style.gap="8px";
  
  const startMenuBtn = createButton("🏠 Start Menu", "#757575"); startMenuBtn.onclick = renderStartPage;
  const menuBtn = createButton("🏠 Menu", "#90a4ae"); menuBtn.onclick = renderSelectionPage;
  const redoBtn = createButton("🔄 Redo", "#ffb74d"); redoBtn.onclick = renderAIExam; 
  const revealBtn = createButton("🔑 Reveal Answers", "#f06292");
  
  revealBtn.onclick = () => {
      const qDivs = document.querySelectorAll('.ghost-ai-q-text');
      qDivs.forEach((d, i) => { 
          const kw = questionData[i].keyword; 
          if(!d.innerHTML.includes("✅")) { 
              d.innerHTML += `<br><span style="color:#2e7d32; font-size:14px;">✅ Answer Keys: ${kw}</span>`; 
          } 
      });
  };
  
  navRow.append(startMenuBtn, menuBtn, redoBtn, revealBtn); 
  container.appendChild(navRow);
  
  const qList = document.createElement('div'); 
  qList.className = "ghost-setting-row"; // Hover class applied
  qList.style.textAlign = "left"; qList.style.marginBottom = "10px"; qList.style.background = "rgba(255,255,255,0.7)"; qList.style.padding = "6px"; qList.style.borderRadius = "8px";
  
  questionData.forEach((item, index) => { 
      qList.innerHTML += `<div style="margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #b2ebf2;"><b style="color:#0288d1; font-size:16px;">Q${index+1}:</b> <span class="ghost-ai-q-text" style="font-size:15px; font-weight:500;">${item.text.replace(/^Q:\s*/, "")}</span></div>`; 
  });
  container.appendChild(qList);
  
  const instruction = document.createElement('div'); 
  instruction.style.marginBottom = "6px"; instruction.style.fontSize = "14px"; instruction.style.color = "#555"; 
  instruction.innerHTML = "<b>Option A:</b> Type answers below (Format: <i>1. Answer... 2. Answer...</i> OR one answer per line)<br><b>Option B:</b> Upload image(s) to scan"; 
  container.appendChild(instruction);
  
  const fileInput = document.createElement('input'); 
  fileInput.type = "file"; fileInput.accept = "image/*"; 
  fileInput.multiple = true; 
  fileInput.style.display = "block"; fileInput.style.marginBottom = "6px"; fileInput.style.fontSize = "14px";
  
  const scanBtn = createButton("UPLOAD & SCAN", "#0288d1"); scanBtn.style.width = "100%";
  
  const textArea = document.createElement('textarea'); 
  textArea.id = "ai-result-box"; 
  textArea.placeholder = "1. Answer one\n2. Answer two\n(Or upload image(s) to scan)..."; 
  Object.assign(textArea.style, { width: "100%", height: "100px", marginTop: "6px", padding: "8px", borderRadius: "8px", border: "1px solid #4fc3f7", fontFamily: "sans-serif", fontSize: "14px" }); 
  
  const submitBtn = createButton("CHECK ANSWERS", "#43a047"); 
  submitBtn.style.display = "block"; submitBtn.style.width = "100%"; submitBtn.style.marginTop = "6px";
  
  const resultsDiv = document.createElement('div'); 
  resultsDiv.id = "exam-results"; resultsDiv.style.marginTop = "10px";
  
  scanBtn.onclick = () => { 
      if (fileInput.files.length === 0) return alert("Select image(s)!"); 
      attemptGeminiScan(Array.from(fileInput.files), "gemini-3-flash-preview", textArea, scanBtn, submitBtn); 
  };
  
  submitBtn.onclick = () => { 
    const rawText = textArea.value;
    const answersMap = {};
    const lines = rawText.split('\n');
    let hasNumbered = false;

    lines.forEach(line => {
        const trimmed = line.trim();
        const match = trimmed.match(/^(\d+)[\.\)]\s*(.*)/);
        if (match) {
            hasNumbered = true;
            const qNum = parseInt(match[1]);
            const content = match[2].toLowerCase();
            answersMap[qNum] = content;
        }
    });

    if (!hasNumbered) {
        let qIndex = 1;
        lines.forEach(line => {
            if (line.trim().length > 0) {
                answersMap[qIndex] = line.trim().toLowerCase();
                qIndex++;
            }
        });
    }

    let correctCount = 0;
    let feedbackHTML = "";

    questionData.forEach((q, index) => { 
        const qNum = index + 1;
        const specificAnswer = answersMap[qNum] || ""; 
        const keywords = parseKeywords(q.keyword); 
        
        const isCorrect = keywords.every(g => g.some(v => specificAnswer.includes(v.replace(/_/g, ' '))));
        
        if (isCorrect) correctCount++;
        
        feedbackHTML += `<div style="display:flex; justify-content:space-between; padding:4px; border-bottom:1px solid #e0f7fa;">
            <span style="font-weight:bold; color:#0277bd; font-size:14px;">Q${qNum}</span>
            <span style="color:${isCorrect ? '#2e7d32' : '#c62828'}; font-weight:bold; font-size:14px;">
                ${isCorrect ? "✅ Correct" : "❌ Incorrect"}
            </span>
        </div>`; 
    });

    resultsDiv.innerHTML = `
        <div style="background:#e1f5fe; padding:8px; border-radius:8px; border:1px solid #4fc3f7;">
            <h3 style="margin:0 0 6px 0; color:${themeConfig.fontColor}; font-size:16px;">Score: ${correctCount} / ${questionData.length}</h3>
            <div style="max-height:150px; overflow-y:auto; background:rgba(255,255,255,0.6); padding:4px; border-radius:4px;">
                ${feedbackHTML}
            </div>
        </div>
    `; 
  };

  container.append(fileInput, scanBtn, textArea, submitBtn, resultsDiv);
}

// --- FULLY RESTORED FALLBACK FUNCTION FOR API ERRORS ---
async function attemptGeminiScan(files, modelId, textArea, scanBtn, submitBtn, retryIndex = 0) {
  if(!geminiKey) return alert("API Key missing! Start session with key.");
  
  const fallbackModels = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash"];
  
  if (retryIndex >= fallbackModels.length) {
      scanBtn.innerText = "Error";
      return alert("All Google AI models are currently overloaded. Please wait 1 minute and try again.");
  }
  
  const targetModel = fallbackModels[retryIndex];
  scanBtn.innerText = retryIndex === 0 ? "..." : `Retrying... (${retryIndex})`;
  
  try {
    const parts = [{ text: "Transcribe handwriting exactly from all provided images." }];

    for (const file of files) {
        const base64 = await new Promise((res) => { 
            const r = new FileReader(); 
            r.onloadend = () => res(r.result.split(',')[1]); 
            r.readAsDataURL(file); 
        });
        
        parts.push({ 
            inline_data: { 
                mime_type: file.type || "image/jpeg", 
                data: base64 
            } 
        });
    }

    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${geminiKey}`, { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify({ contents: [{ parts: parts }] }) 
    });
    
    const data = await resp.json();
    
    if(data.error) {
        if(data.error.code === 429 || data.error.code === 503 || data.error.message.toLowerCase().includes("demand") || data.error.message.includes("not found")) {
            console.warn(`Model ${targetModel} busy. Falling back to next...`);
            return attemptGeminiScan(files, modelId, textArea, scanBtn, submitBtn, retryIndex + 1);
        }
        return alert("API Error: " + data.error.message);
    }
    
    textArea.value = data.candidates[0].content.parts[0].text; 
    scanBtn.innerText = "Done"; 
    
  } catch (e) { 
      alert(e.message); 
      scanBtn.innerText = "Error"; 
  }
}