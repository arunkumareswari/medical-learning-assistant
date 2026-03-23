/* MedRAG Professional JavaScript */

// State Management
let conversationHistory = [];
let currentTool = 'default';
let currentProvider = 'groq';
let currentModel = 'llama-3.3-70b-versatile';
let searchMode = 'hybrid';
let currentSessionId = Date.now().toString();

// API Configuration
const API_BASE = 'http://localhost:8000';

// Tool Configuration
const TOOLS = {
    'default': {
        name: 'General Chat',
        icon: 'message-square',
        desc: 'Like ChatGPT / Claude'
    },
    'study': {
        name: 'Study Mode',
        icon: 'graduation-cap',
        desc: 'Medical Exam Prep (5M / 15M)'
    },
    'websearch': {
        name: 'Web Search',
        icon: 'globe',
        desc: 'Latest Research & Articles'
    },
    'clinical': {
        name: 'OPD Assistant',
        icon: 'stethoscope',
        desc: 'Clinical Case & Diagnosis'
    }
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    loadStats();
    loadHistory();
    lucide.createIcons();
});

function initializeApp() {
    // Auto-resize textarea
    const textarea = document.getElementById('queryInput');
    textarea.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    // Enter to send (Shift+Enter for new line)
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendQuery();
        }
    });
}

function setupEventListeners() {
    // Send button
    document.getElementById('sendBtn').addEventListener('click', handleSendQuery);

    // Model selector
    document.getElementById('modelSelector').addEventListener('change', (e) => {
        const [provider, model] = e.target.value.split(':');
        currentProvider = provider;
        currentModel = model;
    });

    // Search mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            searchMode = e.currentTarget.dataset.mode;
        });
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.tool-btn') && !e.target.closest('.tools-dropdown')) {
            document.getElementById('toolsDropdown').classList.remove('show');
        }
    });
}

// ===== QUERY HANDLING =====
async function handleSendQuery() {
    const textarea = document.getElementById('queryInput');
    const query = textarea.value.trim();

    if (!query) return;

    // Clear input
    textarea.value = '';
    textarea.style.height = 'auto';

    // Hide welcome hero
    const welcomeHero = document.getElementById('welcomeHero');
    if (welcomeHero) {
        welcomeHero.style.display = 'none';
    }

    // Add user message
    addUserMessage(query);

    // Add to history
    conversationHistory.push({
        role: 'user',
        content: query
    });

    // Show loading
    const loadingId = addLoadingMessage();

    // Call API with SSE streaming
    try {
        await streamResponse(query, loadingId);

        // Save to history
        saveToHistory(query);
        updateStats();

    } catch (error) {
        console.error('Query error:', error);
        removeLoadingMessage(loadingId);
        addErrorMessage('Failed to get response. Please check if the backend is running.');
    }
}

async function streamResponse(query, loadingId) {
    const response = await fetch(`${API_BASE}/ask-question-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: query,
            search_mode: searchMode,
            persona: 'student',
            history: conversationHistory.slice(-10),
            provider: currentProvider,
            model: currentModel,
            tool: currentTool
        })
    });

    if (!response.ok) {
        throw new Error('Network response was not ok');
    }

    // Read SSE stream
    let fullAnswer = '';
    let sources = null;
    let messageId = null;
    let containerCreated = false;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'message';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (line.startsWith('event: ')) {
                currentEvent = line.substring(7).trim();
            } else if (line.startsWith('data: ')) {
                const data = line.substring(6);

                try {
                    const parsed = JSON.parse(data);

                    if (currentEvent === 'sources') {
                        sources = parsed;
                    } else if (currentEvent === 'model_error') {
                        // ⚠️ Model quota/error — update selector UI and show toast
                        handleModelError(parsed);
                    } else if (currentEvent === 'done') {
                        // Stream complete
                    } else if (currentEvent === 'error') {
                        fullAnswer += '\n\n❌ Error: ' + parsed;
                        if (containerCreated) {
                            document.getElementById(`${messageId}-text`).innerHTML = marked.parse(fullAnswer);
                        }
                    } else {
                        // ✅ First chunk arrived — NOW create the container and remove loader
                        if (!containerCreated) {
                            removeLoadingMessage(loadingId);
                            messageId = createAiMessageContainer();
                            containerCreated = true;
                        }
                        fullAnswer += parsed;
                        document.getElementById(`${messageId}-text`).innerHTML = marked.parse(fullAnswer);
                        scrollToBottom();
                    }
                } catch (e) {
                    if (!containerCreated) {
                        removeLoadingMessage(loadingId);
                        messageId = createAiMessageContainer();
                        containerCreated = true;
                    }
                    fullAnswer += data;
                    document.getElementById(`${messageId}-text`).innerHTML = marked.parse(fullAnswer);
                    scrollToBottom();
                }

                currentEvent = 'message';
            }
        }
    }

    // Fallback: if no content came at all
    if (!containerCreated) {
        removeLoadingMessage(loadingId);
        messageId = createAiMessageContainer();
    }

    // Add sources after streaming
    if (sources && messageId) {
        displaySources(messageId, sources);
    }

    // Save to conversation history
    conversationHistory.push({ role: 'assistant', content: fullAnswer });

    // Update session in history with the AI response
    saveToHistory(conversationHistory[0].content);

    lucide.createIcons();
    scrollToBottom();
}

function createAiMessageContainer() {
    const messageId = 'ai-msg-' + Date.now();
    const chatContainer = document.getElementById('chatContainer');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-ai';
    messageDiv.id = messageId;

    messageDiv.innerHTML = `
        <div class="ai-response-header">
            <div class="ai-avatar">
                <i data-lucide="brain-circuit"></i>
            </div>
            <div class="ai-info">
                <div class="ai-name">MedRAG Assistant</div>
                <div class="ai-model">${currentProvider === 'groq' ? 'Groq' : 'Gemini'} • ${getModelLabel(currentModel)}</div>
            </div>
        </div>
        <div class="ai-response-content">
            <div class="response-text" id="${messageId}-text"></div>
            <div class="sources-section" id="${messageId}-sources" style="display: none;">
                <div class="sources-header">
                    <i data-lucide="book-marked"></i>
                    Research References
                </div>
                <div class="sources-grid" id="${messageId}-sources-grid"></div>
            </div>
        </div>
    `;

    chatContainer.appendChild(messageDiv);
    lucide.createIcons();
    scrollToBottom();
    return messageId;
}


// ===== MODEL ERROR HANDLING =====
function handleModelError(errorData) {
    const { type, failed_model, failed_provider, fallback, fallback_model } = errorData;
    const isQuota = type === 'quota';

    // 1. Mark the failed option in the dropdown with ⚠️
    const selector = document.getElementById('modelSelector');
    if (selector) {
        for (const option of selector.options) {
            if (option.value === `${failed_provider}:${failed_model}`) {
                if (!option.text.startsWith('⚠️')) {
                    option.text = `⚠️ ${option.text} (${isQuota ? 'Quota exceeded' : 'Error'})`;
                }
                option.style.color = '#ef4444';
                break;
            }
        }
    }

    // 2. Show a toast notification
    const msg = isQuota
        ? `⚠️ Gemini quota exceeded — switched to Groq (${fallback_model}) for this response.`
        : `⚠️ ${failed_provider} error — switched to Groq (${fallback_model}).`;
    showToast(msg, 'warning');
}

function showToast(message, type = 'info') {
    // Remove existing toast if any
    const existing = document.getElementById('model-toast');
    if (existing) existing.remove();

    const colors = { warning: '#f59e0b', error: '#ef4444', info: '#3b82f6' };
    const toast = document.createElement('div');
    toast.id = 'model-toast';
    toast.style.cssText = `
        position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
        background: #1e1e2e; border: 1px solid ${colors[type] || colors.info};
        color: #e2e8f0; padding: 10px 18px; border-radius: 10px;
        font-size: 13px; z-index: 9999; box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        max-width: 420px; text-align: center; animation: fadeInUp 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Auto-dismiss after 5s
    setTimeout(() => toast.remove(), 5000);
}

// ===== MESSAGE RENDERING =====
function addUserMessage(text) {
    const chatContainer = document.getElementById('chatContainer');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-user';

    messageDiv.innerHTML = `
        <div class="user-message-card">
            <div class="user-message-text">${escapeHtml(text)}</div>
        </div>
    `;

    chatContainer.appendChild(messageDiv);
    scrollToBottom();
}

function addLoadingMessage() {
    const chatContainer = document.getElementById('chatContainer');
    const loadingId = 'loading-' + Date.now();

    const loadingDiv = document.createElement('div');
    loadingDiv.id = loadingId;
    loadingDiv.className = 'loading-message';

    loadingDiv.innerHTML = `
        <div class="loading-spinner"></div>
        <div class="loading-text">Searching medical databases...</div>
    `;

    chatContainer.appendChild(loadingDiv);
    scrollToBottom();

    return loadingId;
}

function removeLoadingMessage(loadingId) {
    const loadingDiv = document.getElementById(loadingId);
    if (loadingDiv) {
        loadingDiv.remove();
    }
}

function addErrorMessage(text) {
    const chatContainer = document.getElementById('chatContainer');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-ai';

    messageDiv.innerHTML = `
        <div class="ai-response-content">
            <div class="response-text" style="color: var(--error);">
                <strong>⚠️ Error:</strong> ${escapeHtml(text)}
            </div>
        </div>
    `;

    chatContainer.appendChild(messageDiv);
    scrollToBottom();
}

function displaySources(messageId, sources) {
    const sourcesSection = document.getElementById(`${messageId}-sources`);
    const sourcesGrid = document.getElementById(`${messageId}-sources-grid`);

    if (!sourcesSection || !sourcesGrid) return;

    const allSources = [
        ...(sources.textbooks || []).map(s => ({ ...s, type: 'textbook' })),
        ...(sources.web || []).map(s => ({ ...s, type: 'pubmed' }))
    ];

    if (allSources.length === 0) return;

    sourcesSection.style.display = 'block';

    allSources.forEach(source => {
        const card = document.createElement('div');
        card.className = `source-card ${source.type}`;

        const isTextbook = source.type === 'textbook';

        card.innerHTML = `
            <div class="source-header">
                <div class="source-type ${source.type}">
                    <i data-lucide="${isTextbook ? 'book' : 'microscope'}"></i>
                    ${isTextbook ? 'Textbook' : 'PubMed'}
                </div>
                ${!isTextbook && source.url ? `<a href="${source.url}" target="_blank" class="source-link-badge" onclick="event.stopPropagation()">🔗 Open</a>` : ''}
                ${isTextbook && source.page_num != null && source.page_num !== 0 ? `<span class="source-page-badge">p.${source.page_num}</span>` : isTextbook && source.chunk_index != null ? `<span class="source-page-badge">~p.${Math.floor(source.chunk_index / 3.75) + 1}</span>` : ''}
            </div>
            <div class="source-title">${escapeHtml(source.title)}</div>
        `;

        if (source.url) {
            card.style.cursor = 'pointer';
            card.onclick = () => window.open(source.url, '_blank');
        }

        sourcesGrid.appendChild(card);
    });

    lucide.createIcons();
}

// ===== SAMPLE QUERIES =====
function askSample(query) {
    document.getElementById('queryInput').value = query;
    handleSendQuery();
}

// ===== TOOLS MANAGEMENT =====
function toggleTools() {
    const dropdown = document.getElementById('toolsDropdown');
    dropdown.classList.toggle('show');
}

function selectTool(tool) {
    currentTool = tool;

    const label = document.getElementById('selectedToolLabel');
    label.innerHTML = `<i data-lucide="${TOOLS[tool].icon}"></i> ${TOOLS[tool].name}`;

    document.getElementById('toolsDropdown').classList.remove('show');
    lucide.createIcons();
}

// ===== HISTORY MANAGEMENT =====
function saveToHistory(firstQuery) {
    let sessions = safeJSONParse('medrag_sessions', []);

    // Migration from old format
    if (sessions.length === 0) {
        let oldHistory = safeJSONParse('medrag_history', []);
        if (oldHistory.length > 0) {
            sessions = oldHistory.map(item => ({
                id: Date.now().toString() + Math.random(),
                title: item.query,
                timestamp: item.timestamp,
                messages: [{ role: 'user', content: item.query }]
            }));
        }
    }

    let currentSession = sessions.find(s => s.id === currentSessionId);

    if (!currentSession) {
        currentSession = {
            id: currentSessionId,
            title: firstQuery,
            timestamp: Date.now(),
            messages: []
        };
        sessions.unshift(currentSession);
    }

    currentSession.messages = [...conversationHistory];

    // Keep last 20
    sessions = sessions.slice(0, 20);

    localStorage.setItem('medrag_sessions', JSON.stringify(sessions));
    // Clear old format to save space
    localStorage.removeItem('medrag_history');

    loadHistory();
}

function safeJSONParse(key, defaultVal) {
    try {
        const val = localStorage.getItem(key);
        if (!val) return defaultVal;
        return JSON.parse(val);
    } catch (e) {
        console.error(`Error parsing localStorage key ${key}:`, e);
        return defaultVal;
    }
}

function loadHistory() {
    let sessions = safeJSONParse('medrag_sessions', []);
    const historyList = document.getElementById('historyList');

    // Migration fallback
    if (sessions.length === 0 && localStorage.getItem('medrag_history')) {
        let oldHistory = safeJSONParse('medrag_history', []);
        sessions = oldHistory.map(item => ({
            id: Date.now().toString() + Math.random(),
            title: item.query,
            timestamp: item.timestamp,
            messages: [{ role: 'user', content: item.query }]
        }));
        localStorage.setItem('medrag_sessions', JSON.stringify(sessions));
    }

    if (sessions.length === 0) {
        historyList.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">No queries yet</div>';
        return;
    }

    historyList.innerHTML = '';

    sessions.forEach(session => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.onclick = () => {
            loadSession(session.id);
        };

        div.innerHTML = `
            <div class="history-item-title">${escapeHtml(session.title)}</div>
        `;

        historyList.appendChild(div);
    });

    /* 
    // Automatically load the most recent session if we just loaded the page and haven't started chatting
    if (conversationHistory.length === 0 && sessions.length > 0) {
        loadSession(sessions[0].id);
    }
    */
}

function loadSession(id) {
    const sessions = safeJSONParse('medrag_sessions', []);
    const session = sessions.find(s => s.id === id);
    if (!session) return;

    currentSessionId = id;
    conversationHistory = [...session.messages];

    // Clear chat container
    const chatContainer = document.getElementById('chatContainer');
    chatContainer.innerHTML = '';

    // Hide welcome hero
    const welcomeHero = document.getElementById('welcomeHero');
    if (welcomeHero) welcomeHero.style.display = 'none';

    // Render all messages
    conversationHistory.forEach(msg => {
        if (msg.role === 'user') {
            addUserMessage(msg.content);
        } else if (msg.role === 'assistant') {
            const messageId = createAiMessageContainer();
            document.getElementById(`${messageId}-text`).innerHTML = marked.parse(msg.content);
        }
    });

    // Close mobile sidebar if open
    const historyPanel = document.getElementById('historyPanel');
    if (historyPanel) historyPanel.classList.remove('mobile-open');

    lucide.createIcons();
    scrollToBottom();
}

function newChat() {
    // Reset current session ID to generate a new chat
    currentSessionId = Date.now().toString();
    conversationHistory = [];
    document.getElementById('queryInput').value = '';

    // Clear the visual chat container
    document.getElementById('chatContainer').innerHTML = '';

    // Show the welcome hero back
    const welcomeHero = document.getElementById('welcomeHero');
    if (welcomeHero) welcomeHero.style.display = 'flex';

    // Close mobile sidebar if open
    const historyPanel = document.getElementById('historyPanel');
    if (historyPanel) historyPanel.classList.remove('mobile-open');
}

function clearAllHistory() {
    if (!confirm('Are you sure you want to clear all your chat history? This cannot be undone.')) return;
    
    // Clear localStorage
    localStorage.removeItem('medrag_sessions');
    localStorage.removeItem('medrag_history');
    
    // Clear current state
    conversationHistory = [];
    currentSessionId = Date.now().toString();
    
    // Update UI
    document.getElementById('historyList').innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">No queries yet</div>';
    document.getElementById('chatContainer').innerHTML = '';
    
    // Show welcome hero
    const welcomeHero = document.getElementById('welcomeHero');
    if (welcomeHero) welcomeHero.style.display = 'flex';
}

// ===== STATS =====
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/stats`);
        const data = await response.json();

        animateCountUp('bookCount', data.total_books || 0);
        animateCountUp('queryCount', data.total_queries || 0);
    } catch (error) {
        console.error('Stats error:', error);
    }
}

function animateCountUp(elementId, target, duration = 1200) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const start = 0;
    const startTime = performance.now();

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + (target - start) * eased);
        el.textContent = current;
        if (progress < 1) {
            requestAnimationFrame(step);
        }
    }
    requestAnimationFrame(step);
}

function updateStats() {
    loadStats();
}

// ===== PANEL TOGGLES =====
function toggleHistory() {
    const panel = document.getElementById('historyPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function toggleSettings() {
    const panel = document.getElementById('settingsPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function toggleMobileSidebar() {
    const historyPanel = document.getElementById('historyPanel');
    if (historyPanel) {
        historyPanel.classList.toggle('mobile-open');
    }
}

// ===== UTILITIES =====
function scrollToBottom() {
    const chatContainer = document.getElementById('chatContainer');
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
}

function getModelLabel(model) {
    const labels = {
        'llama-3.3-70b-versatile': 'Llama 3.3 70B',
        'llama-3.1-8b-instant': 'Llama 3.1 8B',
        'mixtral-8x7b-32768': 'Mixtral 8x7B',
        'gemini-2.0-flash': 'Gemini 2.0 Flash',
        'gemini-1.5-pro': 'Gemini 1.5 Pro'
    };
    return labels[model] || model;
}

// ===== OPD PATIENT MANAGEMENT =====
let opdPatients = safeJSONParse('opdPatients', []);
let currentViewingPatientId = null;

function toggleOPD() {
    const panel = document.getElementById('opdPanel');
    if (panel.style.display === 'none') {
        panel.style.display = 'flex';
        showPatientList();
        lucide.createIcons();
    } else {
        panel.style.display = 'none';
        // Hide FAB when OPD panel is closed
        const fab = document.getElementById('opdFab');
        if (fab) fab.style.display = 'none';
        // Hide chat widget too
        const widget = document.getElementById('opdChatWidget');
        if (widget) widget.style.display = 'none';
    }
}

function showPatientList() {
    document.getElementById('opdListView').style.display = '';
    document.getElementById('opdFormView').style.display = 'none';
    document.getElementById('opdDetailView').style.display = 'none';
    renderPatientList();
    // Hide FAB in patient list view
    const fab = document.getElementById('opdFab');
    if (fab) fab.style.display = 'none';
    lucide.createIcons();
}

function showPatientForm(patientId = null) {
    document.getElementById('opdListView').style.display = 'none';
    document.getElementById('opdFormView').style.display = '';
    document.getElementById('opdDetailView').style.display = 'none';
    document.getElementById('opdAddBtn').style.display = 'none';
    document.getElementById('opdHeaderLeft').querySelector('h2').textContent = patientId ? 'Edit Patient' : 'New Patient';

    // Clear form
    document.getElementById('patientForm').reset();

    // If editing, populate form
    if (patientId) {
        const p = opdPatients.find(x => x.id === patientId);
        if (p) {
            document.getElementById('pName').value = p.name || '';
            document.getElementById('pAge').value = p.age || '';
            document.getElementById('pSex').value = p.sex || 'Male';
            document.getElementById('pOpNumber').value = p.opNumber || '';
            document.getElementById('pChiefComplaint').value = p.chiefComplaint || '';
            document.getElementById('pHPI').value = p.hpi || '';
            document.getElementById('pPastHistory').value = p.pastHistory || '';
            document.getElementById('pDrugHistory').value = p.drugHistory || '';
            document.getElementById('pFamilyHistory').value = p.familyHistory || '';
            document.getElementById('pAddress').value = p.address || '';
            
            // For editing, show the first visit notes if available
            if (p.visits && p.visits.length > 0) {
                document.getElementById('vBP').value = p.visits[0].bp || '';
                document.getElementById('vSugar').value = p.visits[0].sugar || '';
                document.getElementById('vPulse').value = p.visits[0].pulse || '';
                document.getElementById('vHeight').value = p.visits[0].height || '';
                document.getElementById('vWeight').value = p.visits[0].weight || '';
                document.getElementById('vTemp').value = p.visits[0].temp || '';
                document.getElementById('vComplaint').value = p.visits[0].complaint || '';
                document.getElementById('vTabletHistory').value = p.visits[0].tabletHistory || '';
                document.getElementById('pVisitNotes').value = p.visits[0].notes || '';
            } else {
                document.getElementById('vBP').value = '';
                document.getElementById('vSugar').value = '';
                document.getElementById('vPulse').value = '';
                document.getElementById('vHeight').value = '';
                document.getElementById('vWeight').value = '';
                document.getElementById('vTemp').value = '';
                document.getElementById('vComplaint').value = '';
                document.getElementById('vTabletHistory').value = '';
                document.getElementById('pVisitNotes').value = '';
            }
        }
        document.getElementById('patientForm').dataset.editId = patientId;
    } else {
        delete document.getElementById('patientForm').dataset.editId;
        // Date-based sequential OP Number logic (e.g., 13001)
        const now = new Date();
        const datePrefix = now.getDate().toString(); // e.g., "13"
        
        // Find existing patients added TODAY and get the highest sequence
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const todaysPatients = opdPatients.filter(p => new Date(p.createdAt).getTime() >= todayStart);
        
        let nextSeq = 1;
        if (todaysPatients.length > 0) {
            // Extract the sequence part from existing OP numbers that match the datePrefix
            const sequences = todaysPatients
                .map(p => {
                    const op = p.opNumber || '';
                    if (op.startsWith(datePrefix) && op.length > datePrefix.length) {
                        return parseInt(op.substring(datePrefix.length)) || 0;
                    }
                    return 0;
                });
            nextSeq = Math.max(...sequences, 0) + 1;
        }
        
        const sequenceStr = nextSeq.toString().padStart(3, '0');
        const finalOp = datePrefix + sequenceStr;
        document.getElementById('pOpNumber').value = finalOp;
    }
    // Hide FAB in form view
    const fab = document.getElementById('opdFab');
    if (fab) fab.style.display = 'none';
    lucide.createIcons();
}

function savePatient() {
    const name = document.getElementById('pName').value.trim();
    const age = document.getElementById('pAge').value.trim();
    if (!name || !age) {
        alert('Please fill in at least Patient Name and Age.');
        return;
    }

    const bp = document.getElementById('vBP').value.trim();
    const sugar = document.getElementById('vSugar').value.trim();
    const pulse = document.getElementById('vPulse').value.trim();
    const height = document.getElementById('vHeight').value.trim();
    const weight = document.getElementById('vWeight').value.trim();
    const temp = document.getElementById('vTemp').value.trim();
    const complaint = document.getElementById('vComplaint').value.trim();
    const tabletHistory = document.getElementById('vTabletHistory').value.trim();
    const visitNotes = document.getElementById('pVisitNotes').value.trim();

    const patientData = {
        id: document.getElementById('patientForm').dataset.editId || Date.now().toString(),
        name: name,
        age: parseInt(age),
        sex: document.getElementById('pSex').value,
        opNumber: document.getElementById('pOpNumber').value.trim(),
        address: document.getElementById('pAddress').value.trim(),
        pastHistory: document.getElementById('pPastHistory').value.trim(),
        drugHistory: document.getElementById('pDrugHistory').value.trim(),
        familyHistory: document.getElementById('pFamilyHistory').value.trim(),
        visits: [],
        createdAt: new Date().toISOString()
    };
    
    // Add initial visit if editing a new case
    if (visitNotes || complaint || bp || sugar) {
        patientData.visits.push({
            date: new Date().toISOString(),
            bp: bp,
            sugar: sugar,
            pulse: pulse,
            height: height,
            weight: weight,
            temp: temp,
            complaint: complaint,
            tabletHistory: tabletHistory,
            notes: visitNotes
        });
    }

    // Update or insert
    const existingIdx = opdPatients.findIndex(x => x.id === patientData.id);
    if (existingIdx >= 0) {
        opdPatients[existingIdx] = patientData;
    } else {
        opdPatients.unshift(patientData);
    }

    localStorage.setItem('opdPatients', JSON.stringify(opdPatients));
    showPatientList();
}

function renderPatientList() {
    const listEl = document.getElementById('opdPatientList');
    const emptyEl = document.getElementById('opdEmpty');

    if (opdPatients.length === 0) {
        listEl.innerHTML = '';
        emptyEl.style.display = '';
        return;
    }
    emptyEl.style.display = 'none';

    listEl.innerHTML = opdPatients.map(p => {
        const initials = p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        const dateStr = new Date(p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        return `
            <div class="opd-patient-card" onclick="viewPatient('${p.id}')">
                <div class="opd-patient-avatar">${initials}</div>
                <div class="opd-patient-info">
                    <div class="opd-patient-name">${p.name}</div>
                    <div class="opd-patient-meta">
                        <span>${p.age}/${p.sex[0]}</span>
                        ${p.opNumber ? `<span>${p.opNumber}</span>` : ''}
                    </div>
                    ${p.visits && p.visits.length > 0 ? `<div class="opd-patient-complaint">${p.visits[0].notes.substring(0, 60)}...</div>` : ''}
                </div>
                <div class="opd-patient-date">${dateStr}</div>
            </div>
        `;
    }).join('');
}

function viewPatient(id) {
    const p = opdPatients.find(x => x.id === id);
    if (!p) return;

    currentViewingPatientId = id;

    document.getElementById('opdListView').style.display = 'none';
    document.getElementById('opdFormView').style.display = 'none';
    document.getElementById('opdDetailView').style.display = '';
    document.getElementById('opdAddBtn').style.display = 'none';
    document.getElementById('opdHeaderLeft').querySelector('h2').textContent = p.name;
    
    // Ensure chat widget is closed when opening a patient but show the FAB
    document.getElementById('opdChatWidget').style.display = 'none';
    const fab = document.getElementById('opdFab');
    if (fab) fab.style.display = 'flex';

    // Build timeline UI
    let visitsHtml = '';
    if (p.visits && p.visits.length > 0) {
        let cards = p.visits.map((msg, i) => {
            const vDate = new Date(msg.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            return `
                <div class="opd-visit-card">
                    <div class="opd-visit-header">
                        <span>Visit ${i + 1}</span>
                        <span>${vDate}</span>
                    </div>
                    ${msg.complaint ? `<div style="font-size: 0.9em; margin-top: 0.5rem;"><strong>Complaint:</strong> ${msg.complaint}</div>` : ''}
                    <div class="opd-vitals-row" style="margin-top: 0.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                        ${msg.bp ? `<span class="opd-vital-badge" style="padding: 2px 8px; font-size: 0.8em;">BP: ${msg.bp}</span>` : ''}
                        ${msg.sugar ? `<span class="opd-vital-badge" style="padding: 2px 8px; font-size: 0.8em;">Sugar: ${msg.sugar}</span>` : ''}
                        ${msg.pulse ? `<span class="opd-vital-badge" style="padding: 2px 8px; font-size: 0.8em;">Pulse: ${msg.pulse}</span>` : ''}
                        ${msg.temp ? `<span class="opd-vital-badge" style="padding: 2px 8px; font-size: 0.8em;">Temp: ${msg.temp}</span>` : ''}
                        ${msg.weight ? `<span class="opd-vital-badge" style="padding: 2px 8px; font-size: 0.8em;">Wt: ${msg.weight}kg</span>` : ''}
                        ${msg.height ? `<span class="opd-vital-badge" style="padding: 2px 8px; font-size: 0.8em;">Ht: ${msg.height}cm</span>` : ''}
                    </div>
                    ${msg.tabletHistory ? `<div style="font-size: 0.9em; margin-top: 0.5rem;"><strong>Rx:</strong> ${msg.tabletHistory}</div>` : ''}
                    ${msg.notes ? `<div class="opd-visit-notes" style="margin-top: 0.5rem;">${msg.notes}</div>` : ''}
                </div>
            `;
        }).join('');
        
        visitsHtml = `
            <div class="opd-detail-section" style="background: transparent; border: none; padding: 0;">
                <h4 style="margin-bottom: 0;">Visit History</h4>
                <div class="opd-visit-history">
                    ${cards}
                </div>
            </div>
        `;
    }

    document.getElementById('opdDetailContent').innerHTML = `
        <div class="opd-detail-section">
            <h4>Basic Information</h4>
            <p><strong>${p.name}</strong> | ${p.age} yrs | ${p.sex} ${p.opNumber ? '| ' + p.opNumber : ''}</p>
            ${p.address ? `<p style="font-size: 0.85em; color: var(--text-secondary); margin-top: 0.25rem;">${p.address}</p>` : ''}
        </div>
        ${p.pastHistory || p.drugHistory || p.familyHistory ? `
            <div class="opd-detail-section">
                <h4>Past & Drug History</h4>
                ${p.pastHistory ? `<p><strong>PMH:</strong> ${p.pastHistory}</p>` : ''}
                ${p.drugHistory ? `<p><strong>Drugs:</strong> ${p.drugHistory}</p>` : ''}
                ${p.familyHistory ? `<p><strong>Family:</strong> ${p.familyHistory}</p>` : ''}
            </div>
        ` : ''}
        ${visitsHtml}
    `;
    
    // Clear the followup text box
    document.getElementById('fBP').value = '';
    document.getElementById('fSugar').value = '';
    document.getElementById('fPulse').value = '';
    document.getElementById('fHeight').value = '';
    document.getElementById('fWeight').value = '';
    document.getElementById('fTemp').value = '';
    document.getElementById('fComplaint').value = '';
    document.getElementById('fTabletHistory').value = '';
    document.getElementById('pFollowUpNotes').value = '';
    
    lucide.createIcons();
}

function addFollowUp() {
    if (!currentViewingPatientId) return;
    const bp = document.getElementById('fBP').value.trim();
    const sugar = document.getElementById('fSugar').value.trim();
    const pulse = document.getElementById('fPulse').value.trim();
    const height = document.getElementById('fHeight').value.trim();
    const weight = document.getElementById('fWeight').value.trim();
    const temp = document.getElementById('fTemp').value.trim();
    const complaint = document.getElementById('fComplaint').value.trim();
    const tabletHistory = document.getElementById('fTabletHistory').value.trim();
    const notes = document.getElementById('pFollowUpNotes').value.trim();

    if (!notes && !complaint && !bp && !sugar) {
        alert("Please enter at least some follow-up information.");
        return;
    }
    
    const idx = opdPatients.findIndex(x => x.id === currentViewingPatientId);
    if (idx === -1) return;
    
    if (!opdPatients[idx].visits) opdPatients[idx].visits = [];
    
    opdPatients[idx].visits.push({
        date: new Date().toISOString(),
        bp: bp,
        sugar: sugar,
        pulse: pulse,
        height: height,
        weight: weight,
        temp: temp,
        complaint: complaint,
        tabletHistory: tabletHistory,
        notes: notes
    });
    
    localStorage.setItem('opdPatients', JSON.stringify(opdPatients));
    
    // Re-render the detail view
    viewPatient(currentViewingPatientId);
}

function deleteCurrentPatient() {
    if (!currentViewingPatientId) return;
    if (!confirm('Are you sure you want to delete this patient?')) return;
    opdPatients = opdPatients.filter(x => x.id !== currentViewingPatientId);
    localStorage.setItem('opdPatients', JSON.stringify(opdPatients));
    currentViewingPatientId = null;
    showPatientList();
}

function buildClinicalSummary(p) {
    let summary = `CLINICAL CASE FOR ANALYSIS:\n`;
    summary += `Patient: ${p.name}, ${p.age} year old ${p.sex}\n`;
    if (p.opNumber) summary += `OP Number: ${p.opNumber}\n`;
    if (p.pastHistory) summary += `Past Medical History: ${p.pastHistory}\n`;
    if (p.drugHistory) summary += `Drug History: ${p.drugHistory}\n`;
    if (p.familyHistory) summary += `Family History: ${p.familyHistory}\n`;
    
    if (p.visits && p.visits.length > 0) {
        summary += `\n--- VISIT HISTORY ---\n`;
        p.visits.forEach((v, i) => {
            const dateStr = new Date(v.date).toLocaleDateString('en-IN');
            summary += `[Visit ${i + 1} - ${dateStr}]:\n`;
            if (v.complaint) summary += `  Complaint: ${v.complaint}\n`;
            if (v.bp || v.sugar || v.pulse || v.temp || v.weight || v.height) {
                summary += `  Vitals: `;
                if (v.bp) summary += `BP ${v.bp}, `;
                if (v.sugar) summary += `Sugar ${v.sugar}, `;
                if (v.pulse) summary += `Pulse ${v.pulse}, `;
                if (v.temp) summary += `Temp ${v.temp}, `;
                if (v.weight) summary += `Wt ${v.weight}kg, `;
                if (v.height) summary += `Ht ${v.height}cm`;
                summary += `\n`;
            }
            if (v.notes) summary += `  Notes: ${v.notes}\n`;
            if (v.tabletHistory) summary += `  Prescribed/Rx: ${v.tabletHistory}\n`;
        });
    }
    
    summary += `\nPlease provide your clinical assessment based on this history.`;
    return summary;
}

function analyzeWithAI() {
    // Build from current form
    const name = document.getElementById('pName').value.trim();
    const age = document.getElementById('pAge').value.trim();
    if (!name || !age) {
        alert('Please fill in at least Patient Name and Age before analyzing.');
        return;
    }

    // Save first
    savePatient();

    const latest = opdPatients[0];
    if (!latest) return;

    runOPDAnalysis(latest);
}

function analyzePatientWithAI() {
    if (!currentViewingPatientId) return;
    const p = opdPatients.find(x => x.id === currentViewingPatientId);
    if (!p) return;

    runOPDAnalysis(p);
}

let currentPatientChatHistory = [];

function toggleOPDChatWidget() {
    if (!currentViewingPatientId) {
        alert("Please save or view a patient first.");
        return;
    }
    const widget = document.getElementById('opdChatWidget');
    const fab = document.getElementById('opdFab');
    const isHidden = widget.style.display === 'none' || widget.style.display === '';
    
    if (isHidden) {
        widget.style.display = 'flex';
        if (fab) fab.style.display = 'none'; // Hide FAB when chat is open
        // Initialize if empty
        if (currentPatientChatHistory.length === 0) {
            clearPatientChat();
        }
    } else {
        widget.style.display = 'none';
        if (fab) fab.style.display = 'flex'; // Show FAB when chat is closed
    }
}

function clearPatientChat() {
    currentPatientChatHistory = [];
    document.getElementById('opdChatMessages').innerHTML = `
        <div class="message assistant-message">
            Hi! Click "Analyze with AI" for a quick assessment, or ask me anything.
        </div>
    `;
    document.getElementById('chatWidgetQuickReplies').style.display = 'flex';
    document.getElementById('opdChatInput').value = '';
}

async function generatePatientAnalysis() {
    const patient = opdPatients.find(x => x.id === currentViewingPatientId);
    if (!patient) return;
    
    // Hide quick replies
    document.getElementById('chatWidgetQuickReplies').style.display = 'none';
    
    const summary = buildClinicalSummary(patient);
    
    // Push a focused, concise prompt as the system/user message
    const shortPrompt = `You are a bedside clinical assistant. Be very brief and practical.

Patient: ${patient.name}, ${patient.age}yr ${patient.sex}
${patient.pastHistory ? `Past History: ${patient.pastHistory}` : ''}
${patient.drug_history ? `Drug History: ${patient.drug_history}` : ''}

Visit Complaints:
${(patient.visits || []).map((v, i) => `Visit ${i+1}: ${v.complaint || ''} ${v.notes ? '| Notes: ' + v.notes : ''}`).join('\n')}

Reply in EXACTLY this format. Each on a NEW LINE. No extra text:

**🩺 Problem:** [one short sentence]

**📋 History:** [one short sentence or "None"]

**💊 Suggest:** [2-3 tablets only]`;

    currentPatientChatHistory.push({ role: "user", content: shortPrompt });
    
    // Visually show the user asked for analysis
    appendOPDMessage('user', '🔍 Analyze with AI');
    
    await streamOPDResponse();
}

function appendOPDMessage(role, content, msgId = null, isStreaming = false) {
    const chatContainer = document.getElementById('opdChatMessages');
    let msgDiv;
    
    if (msgId) {
        msgDiv = document.getElementById(msgId);
    }
    
    if (!msgDiv) {
        msgDiv = document.createElement('div');
        msgDiv.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}`;
        if (msgId) msgDiv.id = msgId;
        
        chatContainer.appendChild(msgDiv);
    }

    if (isStreaming) {
        msgDiv.innerHTML = '<div class="typing-dots">' +
            '<div class="typing-dot" style="animation-delay: 0s"></div>' +
            '<div class="typing-dot" style="animation-delay: 0.2s"></div>' +
            '<div class="typing-dot" style="animation-delay: 0.4s"></div>' +
            '</div>';
    } else {
        // For clinical analysis responses with known emoji section markers,
        // split and render each section as its own paragraph with bold green label.
        const hasSections = content.includes('🩺') || content.includes('📋') || content.includes('💊');
        if (role === 'assistant' && hasSections) {
            const clean = content.replace(/\*\*/g, ''); // Remove any ** markers
            // Split on the known emoji section starters (use alternation, not char class)
            const parts = clean.split(/(?=🩺|📋|💊)/).filter(p => p.trim());
            const labelColor = '#06d6a0';
            msgDiv.innerHTML = parts.map(part => {
                // Match emoji, then label, then colon, then the content
                const m = part.match(/^(🩺|📋|💊)\s*([^:]+):\s*([\s\S]*)/u);
                if (m) {
                    return `<p><strong style="color:${labelColor}">${m[1]} ${m[2].trim()}:</strong> ${m[3].trim()}</p>`;
                }
                return `<p>${part.trim()}</p>`;
            }).join('');
        } else {
            msgDiv.innerHTML = typeof marked !== 'undefined' ? marked.parse(content) : content.replace(/\n/g, '<br>');
        }
    }
    
    chatContainer.scrollTop = chatContainer.scrollHeight;
    lucide.createIcons();
    return msgDiv.id;
}

async function streamOPDResponse() {
    // Add loading indicator for AI
    const msgId = 'opd_msg_' + Date.now();
    appendOPDMessage('assistant', '', msgId, true);
    
    try {
        const response = await fetch(`${API_BASE}/ask-question-stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: currentPatientChatHistory[currentPatientChatHistory.length - 1].content,
                search_mode: searchMode,
                persona: 'student',
                history: currentPatientChatHistory.slice(0, -1),
                provider: currentProvider,
                model: currentModel,
                tool: 'clinical'
            })
        });

        if (!response.ok) {
            throw new Error(`Server returned status ${response.status}: ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep the incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (typeof data === 'string') {
                            fullText += data;
                            appendOPDMessage('assistant', fullText, msgId, false);
                        }
                    } catch (e) { /* skip non-JSON */ }
                }
            }
        }
        
        // Save the full response to history
        currentPatientChatHistory.push({ role: 'assistant', content: fullText });
        
    } catch (err) {
        appendOPDMessage('assistant', `<span style="color: var(--error);">Error: ${err.message}. Please try again.</span>`, msgId, false);
    }
}

async function sendPatientChatMessage() {
    const inputEl = document.getElementById('opdChatInput');
    const msg = inputEl.value.trim();
    if (!msg) return;

    // Add User Message to UI natively
    inputEl.value = '';
    inputEl.style.height = 'auto'; // Reset height
    
    appendOPDMessage('user', msg);
    currentPatientChatHistory.push({ role: "user", content: msg });
    
    await streamOPDResponse();
}

function toggleMobileSidebar() {
    const historyPanel = document.getElementById('historyPanel');
    if (historyPanel) {
        historyPanel.classList.toggle('mobile-open');
    }
}