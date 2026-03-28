// 1. AUTO-LOAD PREVIOUS DATA
window.onload = () => {
  chrome.storage.local.get(['scriptData', 'lastFileName'], (result) => {
    if (result.scriptData && result.scriptData.length > 0) {
      document.getElementById('status').innerText = `✅ Ready: ${result.lastFileName || 'Previous File'}`;
    } else {
      document.getElementById('status').innerText = "📂 Please upload a file";
    }
  });
};

// 2. SAVE FILE TO STORAGE ON UPLOAD
document.getElementById('fileInput').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  
  reader.onload = (e) => {
    const rawContent = e.target.result;
    const parsedData = [];

    // --- LOGIC: Parse HTML Highlights for Composite Keywords ---
    if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawContent, 'text/html');
        
        const blocks = doc.body.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, pre');
        const nodesToProcess = blocks.length > 0 ? blocks : doc.body.childNodes;

        nodesToProcess.forEach(node => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            
            const cleanText = node.textContent.replace(/\s+/g, ' ').trim();
            if (!cleanText) return;

            const marks = node.querySelectorAll('mark, b, strong, em, u, span[style*="background"]');
            let keywords = [];
            
            marks.forEach(m => {
                const kw = m.textContent.replace(/\s+/g, ' ').trim();
                if (kw) keywords.push(kw);
            });
            
            if (keywords.length > 0) {
                parsedData.push({ text: cleanText, keyword: keywords.join(',') });
            } else {
                parsedData.push({ text: cleanText, keyword: "" });
            }
        });
    } 
    // --- Fallback for Plain Text ---
    else {
        const lines = rawContent.split('\n');
        lines.forEach(line => {
            if (line.includes('|')) {
                const parts = line.split('|');
                parsedData.push({ text: parts[0].trim(), keyword: parts[1].trim() });
            }
        });
    }

    // Save data
    chrome.storage.local.set({ scriptData: parsedData, lastFileName: file.name }, () => {
      document.getElementById('status').innerText = `✅ Loaded ${parsedData.length} items`;
    });
  };
  
  reader.readAsText(file);
});

// 3. START BUTTON LOGIC
document.getElementById('startBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});

  if (!tab) { alert("Error: No active tab found."); return; }

  const username = document.getElementById('username').value.trim() || "Student";
  const ownerEmail = document.getElementById('ownerEmail').value.trim() || "";
  const apiKey = document.getElementById('apiKey').value.trim();

  const message = {
    action: "start_script",
    username: username,
    ownerEmail: ownerEmail,
    apiKey: apiKey 
  };

  chrome.tabs.sendMessage(tab.id, message, (response) => {
    if (chrome.runtime.lastError) {
      console.log("Script not active. Injecting now...");
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }, () => {
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, message);
          window.close();
        }, 500);
      });
    } else {
      window.close();
    }
  });
});