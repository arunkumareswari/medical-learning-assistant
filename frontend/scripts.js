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
            </div>
            <div class="source-title">${escapeHtml(source.title)}</div>
            <div class="source-preview">${escapeHtml((source.text || source.snippet || '').substring(0, 150))}...</div>
            ${source.metadata ? `
                <div class="source-meta">
                    ${source.metadata.authors ? `Authors: ${escapeHtml(source.metadata.authors)}<br>` : ''}
                    ${source.metadata.year ? `Year: ${escapeHtml(source.metadata.year)}` : ''}
                </div>
            ` : ''}
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
    let sessions = JSON.parse(localStorage.getItem('medrag_sessions') || '[]');

    // Migration from old format
    if (sessions.length === 0) {
        let oldHistory = JSON.parse(localStorage.getItem('medrag_history') || '[]');
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

function loadHistory() {
    let sessions = JSON.parse(localStorage.getItem('medrag_sessions') || '[]');
    const historyList = document.getElementById('historyList');

    // Migration fallback
    if (sessions.length === 0 && localStorage.getItem('medrag_history')) {
        let oldHistory = JSON.parse(localStorage.getItem('medrag_history') || '[]');
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

        const timeAgo = getTimeAgo(session.timestamp);

        div.innerHTML = `
            <div class="history-item-title">${escapeHtml(session.title)}</div>
            <div class="history-item-time">${timeAgo}</div>
        `;

        historyList.appendChild(div);
    });
}

function loadSession(id) {
    const sessions = JSON.parse(localStorage.getItem('medrag_sessions') || '[]');
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

    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        toggleHistory();
    }

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

    // On mobile, close sidebar after clicking new chat
    if (window.innerWidth <= 768) {
        toggleHistory();
    }
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
let opdPatients = JSON.parse(localStorage.getItem('opdPatients') || '[]');
let currentViewingPatientId = null;

function toggleOPD() {
    const panel = document.getElementById('opdPanel');
    if (panel.style.display === 'none') {
        panel.style.display = 'flex';
        showPatientList();
        lucide.createIcons();
    } else {
        panel.style.display = 'none';
    }
}

function showPatientList() {
    document.getElementById('opdListView').style.display = '';
    document.getElementById('opdFormView').style.display = 'none';
    document.getElementById('opdDetailView').style.display = 'none';
    document.getElementById('opdAddBtn').style.display = '';
    document.getElementById('opdHeaderLeft').querySelector('h2').textContent = 'OPD Patients';
    renderPatientList();
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
            document.getElementById('pBP').value = p.vitals?.bp || '';
            document.getElementById('pPulse').value = p.vitals?.pulse || '';
            document.getElementById('pTemp').value = p.vitals?.temp || '';
            document.getElementById('pSpO2').value = p.vitals?.spo2 || '';
            document.getElementById('pRR').value = p.vitals?.rr || '';
            document.getElementById('pGeneralExam').value = p.generalExam || '';
            document.getElementById('pCVS').value = p.systemicExam?.cvs || '';
            document.getElementById('pRS').value = p.systemicExam?.rs || '';
            document.getElementById('pPA').value = p.systemicExam?.pa || '';
            document.getElementById('pCNS').value = p.systemicExam?.cns || '';
            document.getElementById('pDiagnosis').value = p.provisionalDiagnosis || '';
        }
        document.getElementById('patientForm').dataset.editId = patientId;
    } else {
        delete document.getElementById('patientForm').dataset.editId;
    }
    lucide.createIcons();
}

function savePatient() {
    const name = document.getElementById('pName').value.trim();
    const age = document.getElementById('pAge').value.trim();
    if (!name || !age) {
        alert('Please fill in at least Patient Name and Age.');
        return;
    }

    const patientData = {
        id: document.getElementById('patientForm').dataset.editId || Date.now().toString(),
        name: name,
        age: parseInt(age),
        sex: document.getElementById('pSex').value,
        opNumber: document.getElementById('pOpNumber').value.trim(),
        chiefComplaint: document.getElementById('pChiefComplaint').value.trim(),
        hpi: document.getElementById('pHPI').value.trim(),
        pastHistory: document.getElementById('pPastHistory').value.trim(),
        drugHistory: document.getElementById('pDrugHistory').value.trim(),
        familyHistory: document.getElementById('pFamilyHistory').value.trim(),
        vitals: {
            bp: document.getElementById('pBP').value.trim(),
            pulse: document.getElementById('pPulse').value.trim(),
            temp: document.getElementById('pTemp').value.trim(),
            spo2: document.getElementById('pSpO2').value.trim(),
            rr: document.getElementById('pRR').value.trim()
        },
        generalExam: document.getElementById('pGeneralExam').value.trim(),
        systemicExam: {
            cvs: document.getElementById('pCVS').value.trim(),
            rs: document.getElementById('pRS').value.trim(),
            pa: document.getElementById('pPA').value.trim(),
            cns: document.getElementById('pCNS').value.trim()
        },
        provisionalDiagnosis: document.getElementById('pDiagnosis').value.trim(),
        createdAt: new Date().toISOString()
    };

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
                    ${p.chiefComplaint ? `<div class="opd-patient-complaint">${p.chiefComplaint}</div>` : ''}
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

    const v = p.vitals || {};
    const s = p.systemicExam || {};

    document.getElementById('opdDetailContent').innerHTML = `
        <div class="opd-detail-section">
            <h4>Basic Information</h4>
            <p><strong>${p.name}</strong> | ${p.age} yrs | ${p.sex} ${p.opNumber ? '| ' + p.opNumber : ''}</p>
        </div>
        ${p.chiefComplaint ? `<div class="opd-detail-section"><h4>Chief Complaint</h4><p>${p.chiefComplaint}</p></div>` : ''}
        ${p.hpi ? `<div class="opd-detail-section"><h4>History of Present Illness</h4><p>${p.hpi}</p></div>` : ''}
        ${p.pastHistory || p.drugHistory || p.familyHistory ? `
            <div class="opd-detail-section">
                <h4>Past & Drug History</h4>
                ${p.pastHistory ? `<p><strong>PMH:</strong> ${p.pastHistory}</p>` : ''}
                ${p.drugHistory ? `<p><strong>Drugs:</strong> ${p.drugHistory}</p>` : ''}
                ${p.familyHistory ? `<p><strong>Family:</strong> ${p.familyHistory}</p>` : ''}
            </div>
        ` : ''}
        ${v.bp || v.pulse || v.temp || v.spo2 || v.rr ? `
            <div class="opd-detail-section">
                <h4>Vitals</h4>
                <div class="opd-vitals-row">
                    ${v.bp ? `<div class="opd-vital-badge"><div class="vital-label">BP</div><div class="vital-value">${v.bp}</div></div>` : ''}
                    ${v.pulse ? `<div class="opd-vital-badge"><div class="vital-label">Pulse</div><div class="vital-value">${v.pulse}</div></div>` : ''}
                    ${v.temp ? `<div class="opd-vital-badge"><div class="vital-label">Temp</div><div class="vital-value">${v.temp}°F</div></div>` : ''}
                    ${v.spo2 ? `<div class="opd-vital-badge"><div class="vital-label">SpO2</div><div class="vital-value">${v.spo2}%</div></div>` : ''}
                    ${v.rr ? `<div class="opd-vital-badge"><div class="vital-label">RR</div><div class="vital-value">${v.rr}</div></div>` : ''}
                </div>
            </div>
        ` : ''}
        ${p.generalExam ? `<div class="opd-detail-section"><h4>General Examination</h4><p>${p.generalExam}</p></div>` : ''}
        ${s.cvs || s.rs || s.pa || s.cns ? `
            <div class="opd-detail-section">
                <h4>Systemic Examination</h4>
                ${s.cvs ? `<p><strong>CVS:</strong> ${s.cvs}</p>` : ''}
                ${s.rs ? `<p><strong>RS:</strong> ${s.rs}</p>` : ''}
                ${s.pa ? `<p><strong>P/A:</strong> ${s.pa}</p>` : ''}
                ${s.cns ? `<p><strong>CNS:</strong> ${s.cns}</p>` : ''}
            </div>
        ` : ''}
        ${p.provisionalDiagnosis ? `<div class="opd-detail-section"><h4>Provisional Diagnosis</h4><p>${p.provisionalDiagnosis}</p></div>` : ''}
    `;
    lucide.createIcons();
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
    const v = p.vitals || {};
    const s = p.systemicExam || {};
    let summary = `CLINICAL CASE FOR ANALYSIS:\n`;
    summary += `Patient: ${p.name}, ${p.age} year old ${p.sex}\n`;
    if (p.opNumber) summary += `OP Number: ${p.opNumber}\n`;
    if (p.chiefComplaint) summary += `Chief Complaint: ${p.chiefComplaint}\n`;
    if (p.hpi) summary += `History of Present Illness: ${p.hpi}\n`;
    if (p.pastHistory) summary += `Past Medical History: ${p.pastHistory}\n`;
    if (p.drugHistory) summary += `Drug History: ${p.drugHistory}\n`;
    if (p.familyHistory) summary += `Family History: ${p.familyHistory}\n`;
    if (v.bp || v.pulse || v.temp || v.spo2 || v.rr) {
        summary += `Vitals: BP ${v.bp || 'N/A'}, Pulse ${v.pulse || 'N/A'}, Temp ${v.temp || 'N/A'}F, SpO2 ${v.spo2 || 'N/A'}%, RR ${v.rr || 'N/A'}/min\n`;
    }
    if (p.generalExam) summary += `General Examination: ${p.generalExam}\n`;
    if (s.cvs || s.rs || s.pa || s.cns) {
        summary += `Systemic Examination:\n`;
        if (s.cvs) summary += `  CVS: ${s.cvs}\n`;
        if (s.rs) summary += `  RS: ${s.rs}\n`;
        if (s.pa) summary += `  P/A: ${s.pa}\n`;
        if (s.cns) summary += `  CNS: ${s.cns}\n`;
    }
    if (p.provisionalDiagnosis) summary += `Student's Provisional Diagnosis: ${p.provisionalDiagnosis}\n`;
    summary += `\nPlease provide your clinical assessment.`;
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

let lastAnalyzedPatientId = null;

function backFromAnalysis() {
    if (lastAnalyzedPatientId) {
        viewPatient(lastAnalyzedPatientId);
    } else {
        showPatientList();
    }
}

async function runOPDAnalysis(patient) {
    lastAnalyzedPatientId = patient.id;

    // Show analysis view
    document.getElementById('opdListView').style.display = 'none';
    document.getElementById('opdFormView').style.display = 'none';
    document.getElementById('opdDetailView').style.display = 'none';
    document.getElementById('opdAnalysisView').style.display = '';
    document.getElementById('opdAddBtn').style.display = 'none';
    document.getElementById('opdHeaderLeft').querySelector('h2').textContent = 'AI Clinical Analysis';

    // Show patient bar
    document.getElementById('opdAnalysisPatientBar').innerHTML = `
        <strong>${patient.name}</strong> | ${patient.age}/${patient.sex[0]} 
        ${patient.chiefComplaint ? '| ' + patient.chiefComplaint : ''}
    `;

    // Show loading, hide result
    document.getElementById('opdAnalysisLoading').style.display = 'flex';
    document.getElementById('opdAnalysisResult').innerHTML = '';
    lucide.createIcons();

    const summary = buildClinicalSummary(patient);

    try {
        const response = await fetch(`${API_BASE}/query/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: summary,
                search_mode: searchMode,
                persona: 'student',
                history: [],
                provider: currentProvider,
                model: currentModel,
                tool: 'clinical'
            })
        });

        // Hide loading
        document.getElementById('opdAnalysisLoading').style.display = 'none';

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (typeof data === 'string') {
                            fullText += data;
                            document.getElementById('opdAnalysisResult').innerHTML =
                                typeof marked !== 'undefined' ? marked.parse(fullText) : fullText.replace(/\n/g, '<br>');
                        }
                    } catch (e) { /* skip non-JSON */ }
                }
            }
        }
    } catch (err) {
        document.getElementById('opdAnalysisLoading').style.display = 'none';
        document.getElementById('opdAnalysisResult').innerHTML = `
            <p style="color: var(--error);">Error: Could not analyze. Please check your connection and try again.</p>
            <p style="color: var(--text-muted);">${err.message}</p>
        `;
    }
}