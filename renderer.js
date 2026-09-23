// --- ELECTRON DOM CONTROLLER & RENDER ENGINE ---
const chatContainer = document.getElementById('chat-container');
const chatInput = document.getElementById('chat-input');
const inputCapsule = document.getElementById('input-capsule-dropzone');
const statusMode = document.getElementById('status-mode');
const workingIndicator = document.getElementById('working-indicator');
const workingText = document.getElementById('working-text');
const reactorCanvas = document.getElementById('reactor-canvas');
const reactorCtx = reactorCanvas ? reactorCanvas.getContext('2d') : null;
const suggestionsPopup = document.getElementById('suggestions-popup');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const drawerRecentsList = document.getElementById('drawer-recents-list');
const btnToggleAllSessions = document.getElementById('btn-toggle-all-sessions');
const welcomeHero = document.getElementById('welcome-hero');
const headerAgentDropdown = document.getElementById('header-agent-dropdown');
const dropdownAgentsList = document.getElementById('dropdown-agents-list');
const headerAgentSearch = document.getElementById('header-agent-search');

let reactorAnimId = null;
let reactorAngle = 0;
let reactorColor = "#3ddbd9";
const workingAgentsMap = new Map();

let sessionToken = null;
let currentCallId = null;
let currentSuggestions = [];
let selectedSuggestionIdx = -1;
let currentPrefix = "";
let cachedUserName = localStorage.getItem("federaide-username") || "User";
let cachedUserColor = localStorage.getItem("federaide-usercolor") || "#dda0dd";
let cachedAgents = [];
let activeAgentName = "Rita";
let defaultAgentName = null;
let contextMenuTargetAgent = null;
let cachedSessions = [];
let showAllSessions = false;
let activeAIMessageBlock = null;
let activeAIMessageBody = null;
let pendingAttachments = [];

let activeToolContainer = null;
let activeToolImages = null;
let activeToolReadout = null;
let activeToolCard = null;

// --- STARTUP SPLASH ANIMATION ENGINE ---
const splashLoader = document.getElementById('app-splash-loader');
const splashCanvas = document.getElementById('splash-canvas');
const splashCtx = splashCanvas ? splashCanvas.getContext('2d') : null;
let splashAnimId = null;
let splashAngle = 0;

function drawSplashFrame() {
    if (!splashCtx || !splashLoader || splashLoader.classList.contains('hidden')) return;
    const w = 160, h = 160, cx = 80, cy = 80;
    splashCtx.clearRect(0, 0, w, h);
    splashAngle += 0.045;

    const coreRadius = 5.5 + Math.sin(splashAngle * 3) * 1.2;
    splashCtx.beginPath();
    splashCtx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    splashCtx.fillStyle = '#ffffff';
    splashCtx.shadowColor = '#3ddbd9';
    splashCtx.shadowBlur = 16;
    splashCtx.fill();
    splashCtx.shadowBlur = 0;

    const orbits = [
        { tilt: 0, rx: 62, ry: 22, speed: 1.0, offset: 0, color: '#3ddbd9' },
        { tilt: Math.PI / 3, rx: 62, ry: 22, speed: 1.3, offset: 2.1, color: '#f2a813' },
        { tilt: (2 * Math.PI) / 3, rx: 62, ry: 22, speed: -1.1, offset: 4.2, color: '#da6057' }
    ];

    const trailSegments = 28;
    const maxTrailAngle = Math.PI * 1.2;

    orbits.forEach(orb => {
        splashCtx.save();
        splashCtx.translate(cx, cy);
        splashCtx.rotate(orb.tilt + Math.sin(splashAngle * 0.5) * 0.1);

        const currentPhase = splashAngle * orb.speed + orb.offset;
        const direction = orb.speed >= 0 ? 1 : -1;

        for (let i = 0; i < trailSegments; i++) {
            const frac1 = i / trailSegments;
            const frac2 = (i + 1) / trailSegments;
            const t1 = currentPhase - direction * (frac1 * maxTrailAngle);
            const t2 = currentPhase - direction * (frac2 * maxTrailAngle);
            const alpha = Math.pow(1 - frac1, 2.0) * 0.9;
            const lineWidth = Math.max(0.8, (1 - frac1) * 2.8);

            splashCtx.beginPath();
            splashCtx.ellipse(0, 0, orb.rx, orb.ry, 0, direction > 0 ? t2 : t1, direction > 0 ? t1 : t2, false);
            splashCtx.strokeStyle = hexToRgba(orb.color, alpha);
            splashCtx.lineWidth = lineWidth;
            splashCtx.stroke();
        }

        const ex = orb.rx * Math.cos(currentPhase);
        const ey = orb.ry * Math.sin(currentPhase);
        splashCtx.beginPath();
        splashCtx.arc(ex, ey, 2.8, 0, Math.PI * 2);
        splashCtx.fillStyle = '#ffffff';
        splashCtx.shadowColor = orb.color;
        splashCtx.shadowBlur = 12;
        splashCtx.fill();
        splashCtx.restore();
    });

    splashAnimId = requestAnimationFrame(drawSplashFrame);
}

function startSplashAnimation() {
    if (splashCanvas && !splashAnimId) drawSplashFrame();
}

function dismissSplash() {
    if (splashLoader && !splashLoader.classList.contains('hidden')) {
        splashLoader.classList.add('hidden');
        setTimeout(() => {
            if (splashAnimId) {
                cancelAnimationFrame(splashAnimId);
                splashAnimId = null;
            }
            splashLoader.style.display = 'none';
        }, 600);
    }
}

startSplashAnimation();

// --- ZERO-DEPENDENCY SYNTH SOUND EFFECTS ---
let audioCtx = null;
function getAudioCtx() {
    if (!audioCtx) {
        const AudioClass = window.AudioContext || window.webkitAudioContext;
        if (AudioClass) audioCtx = new AudioClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}
['click', 'touchstart', 'keydown'].forEach(evt => {
    document.addEventListener(evt, () => getAudioCtx(), { once: true });
});

const soundFX = {
    send: () => {
        try {
            const ctx = getAudioCtx(); if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(280, now);
            osc.frequency.exponentialRampToValueAtTime(750, now + 0.10);
            gain.gain.setValueAtTime(0.45, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(now); osc.stop(now + 0.10);
        } catch(e) {}
    },
    toolCall: () => {
        try {
            const ctx = getAudioCtx(); if (!ctx) return;
            const now = ctx.currentTime;
            [840, 1150].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const start = now + (i * 0.06);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, start);
                gain.gain.setValueAtTime(0.14, start);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.06);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(start); osc.stop(start + 0.06);
            });
        } catch(e) {}
    },
    toolResult: () => {
        try {
            const ctx = getAudioCtx(); if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(540, now);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(now); osc.stop(now + 0.12);
        } catch(e) {}
    },
    agentChime: () => {
        try {
            const ctx = getAudioCtx(); if (!ctx) return;
            const now = ctx.currentTime;
            [659.25, 987.77, 1318.51].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const start = now + (i * 0.07);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, start);
                gain.gain.setValueAtTime(0.16, start);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(start); osc.stop(start + 0.35);
            });
        } catch(e) {}
    }
};

function hexToRgba(hex, alpha = 1) {
    let c = (hex || '#3ddbd9').replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16) || 0;
    return 'rgba(' + ((num >> 16) & 255) + ',' + ((num >> 8) & 255) + ',' + (num & 255) + ',' + alpha + ')';
}

function drawReactorFrame() {
    if (!reactorCtx) return;
    const w = 36, h = 36, cx = 18, cy = 18;
    reactorCtx.clearRect(0, 0, w, h);
    reactorAngle += 0.07;

    const nucleusPulse = 2.0 + Math.sin(reactorAngle * 2.5) * 0.4;
    reactorCtx.beginPath();
    reactorCtx.arc(cx, cy, nucleusPulse, 0, Math.PI * 2);
    reactorCtx.fillStyle = '#ffffff';
    reactorCtx.shadowColor = reactorColor;
    reactorCtx.shadowBlur = 8;
    reactorCtx.fill();
    reactorCtx.shadowBlur = 0;

    const orbits = [
        { tilt: 0, rx: 13.5, ry: 4.8, speed: 1.0, offset: 0 },
        { tilt: Math.PI / 3, rx: 13.5, ry: 4.8, speed: 1.2, offset: 2.1 },
        { tilt: (2 * Math.PI) / 3, rx: 13.5, ry: 4.8, speed: -1.1, offset: 4.2 }
    ];

    const trailSegments = 20;
    const maxTrailAngle = Math.PI;

    orbits.forEach(orb => {
        reactorCtx.save();
        reactorCtx.translate(cx, cy);
        reactorCtx.rotate(orb.tilt);

        const currentPhase = reactorAngle * orb.speed + orb.offset;
        const direction = orb.speed >= 0 ? 1 : -1;

        for (let i = 0; i < trailSegments; i++) {
            const frac1 = i / trailSegments;
            const frac2 = (i + 1) / trailSegments;
            const t1 = currentPhase - direction * (frac1 * maxTrailAngle);
            const t2 = currentPhase - direction * (frac2 * maxTrailAngle);
            const alpha = Math.pow(1 - frac1, 2.2) * 0.85;
            const lineWidth = Math.max(0.5, (1 - frac1) * 1.8);

            reactorCtx.beginPath();
            reactorCtx.ellipse(0, 0, orb.rx, orb.ry, 0, direction > 0 ? t2 : t1, direction > 0 ? t1 : t2, false);
            reactorCtx.strokeStyle = hexToRgba(reactorColor, alpha);
            reactorCtx.lineWidth = lineWidth;
            reactorCtx.stroke();
        }

        const ex = orb.rx * Math.cos(currentPhase);
        const ey = orb.ry * Math.sin(currentPhase);
        reactorCtx.beginPath();
        reactorCtx.arc(ex, ey, 1.5, 0, Math.PI * 2);
        reactorCtx.fillStyle = '#ffffff';
        reactorCtx.shadowColor = reactorColor;
        reactorCtx.shadowBlur = 8;
        reactorCtx.fill();
        reactorCtx.restore();
    });

    reactorAnimId = requestAnimationFrame(drawReactorFrame);
}

function startReactorAnimation(color = "#3ddbd9") {
    reactorColor = color;
    if (!reactorAnimId) drawReactorFrame();
}

function stopReactorAnimation() {
    if (reactorAnimId) {
        cancelAnimationFrame(reactorAnimId);
        reactorAnimId = null;
    }
}

function updateMultiAgentWorkingState(agentName, isWorking, color) {
    if (!agentName) return;
    if (isWorking) {
        workingAgentsMap.set(agentName, color || getAgentColor(agentName));
    } else {
        workingAgentsMap.delete(agentName);
    }

    const activeList = Array.from(workingAgentsMap.entries());
    const inputDockEl = document.getElementById('input-dock');
    if (activeList.length === 0) {
        workingIndicator.style.display = "none";
        if (inputDockEl) inputDockEl.classList.remove('working-dock');
        stopReactorAnimation();
        workingText.innerHTML = "";
        updateSendButtonState();
        return;
    }

    if (inputDockEl) inputDockEl.classList.add('working-dock');
    workingIndicator.style.display = "flex";
    const primaryColor = activeList[0][1] || "var(--brand-teal)";
    startReactorAnimation(primaryColor);

    if (activeList.length === 1) {
        const [name, c] = activeList[0];
        workingText.innerHTML = `<span style="color:${c}; font-weight:600;">${window.electronAPI.escapeHtml(name)}</span> is working...`;
    } else {
        workingText.innerHTML = `<span style="color:var(--brand-primary); font-weight:600;">${activeList.length} agents</span> are collaborating...`;
    }
    updateSendButtonState();
}

function updateSendButtonState() {
    const btn = document.getElementById('btn-send');
    if (!btn) return;
    const isWorking = workingAgentsMap.size > 0;
    const hasText = (chatInput.value.trim().length > 0 || pendingAttachments.length > 0);

    btn.classList.remove('btn-abort-mode', 'btn-interrupt-mode');

    if (isWorking && !hasText) {
        btn.classList.add('btn-abort-mode');
        btn.title = "Abort Execution (Ctrl+A)";
        btn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>`;
    } else if (isWorking && hasText) {
        btn.classList.add('btn-interrupt-mode');
        btn.title = "Interrupt & Override (Enter)";
        btn.innerHTML = `<svg viewBox="0 0 100 100" style="width: 18px; height: 18px;">
            <defs>
                <path id="interrupt-arrow-seg" d="M 77.2 27.2 A 35.5 35.5 0 0 1 77.2 72.8 L 83.6 74.4 L 66.7 76.7 L 65.2 65.2 L 71.1 67.7 A 27.5 27.5 0 0 0 71.1 32.3 Z" fill="currentColor"/>
            </defs>
            <use href="#interrupt-arrow-seg"/>
            <use href="#interrupt-arrow-seg" transform="rotate(120 50 50)"/>
            <use href="#interrupt-arrow-seg" transform="rotate(240 50 50)"/>
        </svg>`;
    } else {
        btn.title = "Send (Enter)";
        btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
    }
}

function sendToPython(payload) {
    if (sessionToken) {
        payload.session_token = sessionToken;
    }
    window.electronAPI.sendToPython(payload);
}

function stripRichTags(text) {
    if (!text) return "";
    return text.replace(/\[\/?(bold|dim|italic|underline|\#[a-fA-F0-9]{6}|[a-zA-Z]+)(?:\s+[a-zA-Z0-9#_]+)?\]/g, "");
}

function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
    headerAgentDropdown.classList.remove('open');
    if (typeof resetScheduleForm === 'function') resetScheduleForm();
    chatInput.focus();
}

// Verbatim Code Copy Handler
window.copyCodeBlock = function(btn) {
    const wrapper = btn.closest('.code-block-wrapper');
    const codeEl = wrapper.querySelector('pre code');
    const textToCopy = codeEl.innerText || codeEl.textContent;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy);
    } else {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);
    }

    const span = btn.querySelector('span');
    if (span) span.innerText = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
        if (span) span.innerText = 'Copy';
        btn.classList.remove('copied');
    }, 2000);
};

// KaTeX Post-processing
function applyLatexPass(element) {
    if (window.renderMathInElement && element) {
        try {
            window.renderMathInElement(element, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '\\begin{bmatrix}', right: '\\end{bmatrix}', display: true },
                    { left: '\\begin{pmatrix}', right: '\\end{pmatrix}', display: true },
                    { left: '\\begin{matrix}', right: '\\end{matrix}', display: true },
                    { left: '\\begin{aligned}', right: '\\end{aligned}', display: true },
                    { left: '\\begin{equation}', right: '\\end{equation}', display: true },
                    { left: '\\begin{cases}', right: '\\end{cases}', display: true },
                    { left: '\\begin{align}', right: '\\end{align}', display: true }
                ],
                throwOnError: false
            });
        } catch (e) {
            console.error("KaTeX Auto-Render error:", e);
        }
    }
}

// --- ONBOARDING MODAL ENGINE ---
function showOnboardingModal() {
    const modal = document.getElementById('onboarding-modal');
    if (!modal) return;

    const keyringModal = document.getElementById('keyring-modal');
    if (keyringModal) keyringModal.style.display = 'none';

    syncColorPicker('onboard-color-picker', 'onboard-color', '#3ddbd9');

    const presetSelect = document.getElementById('onboard-base-preset');
    const baseUrlInput = document.getElementById('onboard-base-url');
    const modelInput = document.getElementById('onboard-model');
    const authBtn = document.getElementById('btn-onboard-chatgpt-auth');
    const apiKeyInput = document.getElementById('onboard-api-key');
    const apiKeyLabel = document.getElementById('onboard-api-key-label');
    const statusEl = document.getElementById('onboard-chatgpt-status');

    function updateOnboardPreset(val) {
        if (val !== 'custom') {
            baseUrlInput.value = val;
        }
        if (val === "https://generativelanguage.googleapis.com/v1beta/openai/") {
            modelInput.value = "gemini-2.5-flash";
        } else if (val === "https://openrouter.ai/api/v1") {
            modelInput.value = "google/gemini-2.5-flash";
        } else if (val === "https://api.openai.com/v1/") {
            modelInput.value = "gpt-5.5";
        } else if (val === "https://api.anthropic.com/v1/") {
            modelInput.value = "claude-3-5-sonnet";
        } else if (val === "https://chatgpt.com/backend-api/codex") {
            modelInput.value = "gpt-5.5";
        }

        if (val === "https://chatgpt.com/backend-api/codex") {
            authBtn.style.display = "block";
            apiKeyInput.style.display = "none";
            apiKeyLabel.style.display = "none";
            if (statusEl) statusEl.style.display = "block";
        } else {
            authBtn.style.display = "none";
            apiKeyInput.style.display = "block";
            apiKeyLabel.style.display = "block";
            if (statusEl) {
                statusEl.style.display = "none";
                statusEl.innerHTML = '';
            }
        }
    }

    if (presetSelect && !presetSelect._hasListener) {
        presetSelect.addEventListener('change', (e) => updateOnboardPreset(e.target.value));
        presetSelect._hasListener = true;
    }

    if (authBtn && !authBtn._hasListener) {
        authBtn.onclick = () => {
            authBtn.disabled = true;
            authBtn.innerText = '⏳ Waiting for browser sign-in...';
            if (statusEl) statusEl.innerHTML = '<span style="color: var(--brand-teal);">Please complete sign-in in your browser...</span>';
            sendToPython({ action: "start_chatgpt_oauth" });
        };
        authBtn._hasListener = true;
    }

    modal.style.display = 'flex';
    setTimeout(() => { document.getElementById('onboard-api-key')?.focus(); }, 100);
}

document.addEventListener('DOMContentLoaded', () => {
    const btnSubmit = document.getElementById('btn-onboard-submit');
    if (btnSubmit) {
        btnSubmit.onclick = () => {
            const name = (document.getElementById('onboard-name')?.value || '').trim();
            const model = (document.getElementById('onboard-model')?.value || '').trim();
            const baseUrl = (document.getElementById('onboard-base-url')?.value || '').trim();
            let apiKey = (document.getElementById('onboard-api-key')?.value || '').trim();
            const preset = document.getElementById('onboard-base-preset')?.value;
            const statusMsg = document.getElementById('onboard-status-msg');

            if (preset === "https://chatgpt.com/backend-api/codex" && !apiKey) {
                apiKey = "CHATGPT_OAUTH_ACTIVE";
            }

            if (!apiKey) {
                if (statusMsg) statusMsg.innerHTML = '<span style="color: var(--brand-red);">API Key cannot be empty.</span>';
                return;
            }
            if (!name) {
                if (statusMsg) statusMsg.innerHTML = '<span style="color: var(--brand-red);">Agent name cannot be empty.</span>';
                return;
            }

            btnSubmit.disabled = true;
            btnSubmit.innerText = '⏳ Verifying Credentials & Translating...';
            if (statusMsg) statusMsg.innerHTML = '<span style="color: var(--brand-yellow);">Testing API connection & backstory...</span>';

            const fields = {
                name: name,
                color: (document.getElementById('onboard-color')?.value || '#3ddbd9').trim(),
                backstory: (document.getElementById('onboard-backstory')?.value || '').trim(),
                model: model,
                reasoning_effort: 'none',
                temperature: 1.0,
                base_url: baseUrl,
                api_key: apiKey,
                tts_voice: 'af_sarah',
                pronouns: 'she/her',
                is_capable_vision: true,
                disable_all_tools: false,
                use_backup: false,
                backup_model: '',
                backup_base_url: '',
                backup_api_key: '',
                enabled_tools: ["read_file", "fetch_url"],
                disabled_tools: ["visual_computer_operation", "send_file_to_telegram"]
            };

            sendToPython({
                action: "save_agent_data",
                fields,
                is_new: false,
                old_name: name
            });
        };
    }
});

function toggleDrawer(open) {
    if (open) {
        sidebar.classList.add('open');
        sidebarOverlay.classList.add('active');
        sendToPython({ action: "get_sessions" });
    } else {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('active');
    }
}

function adjustTextareaHeight() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
}

function setPromptText(text) {
    chatInput.value = text;
    adjustTextareaHeight();
    chatInput.focus();
}

document.addEventListener('click', (e) => {
    const ctxMenu = document.getElementById('agent-context-menu');
    if (ctxMenu) ctxMenu.style.display = 'none';

    if (!e.target.closest('#btn-header-agent-pill') && !e.target.closest('#header-agent-dropdown')) {
        headerAgentDropdown.classList.remove('open');
    }
    const link = e.target.closest('a');
    if (link && link.href) {
        const href = link.getAttribute('href') || link.href;
        if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
            e.preventDefault();
            window.electronAPI.openExternal(link.href);
        }
    }
});

// Theme Toggle
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('federaide-theme', theme); } catch(e) {}
    const sunIcon = document.getElementById('theme-sun-icon');
    const moonIcon = document.getElementById('theme-moon-icon');
    if (theme === 'light') {
        if (sunIcon) sunIcon.style.display = 'none';
        if (moonIcon) moonIcon.style.display = 'block';
    } else {
        if (sunIcon) sunIcon.style.display = 'block';
        if (moonIcon) moonIcon.style.display = 'none';
    }
}

function initTheme() {
    let savedTheme = 'dark';
    try { savedTheme = localStorage.getItem('federaide-theme') || 'dark'; } catch(e) {}
    applyTheme(savedTheme);
}

const btnHeaderNewChat = document.getElementById('btn-header-new-chat');
if (btnHeaderNewChat) {
    btnHeaderNewChat.onclick = () => {
        sendToPython({ action: "clear_all" });
    };
}

const btnHeaderNovnc = document.getElementById('btn-header-novnc');
if (btnHeaderNovnc) {
    btnHeaderNovnc.onclick = () => {
        if (window.electronAPI && window.electronAPI.openNoVnc) {
            window.electronAPI.openNoVnc('http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=remote');
        }
    };
}

document.getElementById('btn-theme-toggle').onclick = (e) => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const nextTheme = current === 'dark' ? 'light' : 'dark';

    if (!document.startViewTransition) {
        applyTheme(nextTheme);
        return;
    }

    const btn = document.getElementById('btn-theme-toggle');
    const rect = btn.getBoundingClientRect();
    const x = e.clientX || (rect.left + rect.width / 2);
    const y = e.clientY || (rect.top + rect.height / 2);
    const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
        applyTheme(nextTheme);
    });

    transition.ready.then(() => {
        document.documentElement.animate(
            {
                clipPath: [
                    `circle(0px at ${x}px ${y}px)`,
                    `circle(${endRadius}px at ${x}px ${y}px)`
                ]
            },
            {
                duration: 450,
                easing: 'ease-out',
                pseudoElement: '::view-transition-new(root)'
            }
        );
    });
};

initTheme();

// Header Agent Dropdown
function renderHeaderAgentDropdown(filter = "") {
    dropdownAgentsList.innerHTML = '';
    const q = filter.toLowerCase().trim();
    const agentsList = (cachedAgents && cachedAgents.length > 0) 
        ? cachedAgents 
        : [{ name: activeAgentName || "Rita", color: "var(--brand-teal)", model: "Default" }];
        
    const filtered = agentsList.filter(a => a.name.toLowerCase().includes(q));

    filtered.forEach(a => {
        const isActive = (a.name.toLowerCase() === activeAgentName.toLowerCase());
        const isDefault = (defaultAgentName && a.name.toLowerCase() === defaultAgentName.toLowerCase());
        const item = document.createElement('div');
        item.className = 'dropdown-agent-item ' + (isActive ? 'active' : '');
        item.innerHTML = '<div style="display:flex; align-items:center; gap:8px;">' +
            '<span style="width:10px; height:10px; border-radius:50%; background:' + (a.color || 'var(--brand-teal)') + '; flex-shrink:0;"></span>' +
            '<span style="font-weight:' + (isActive ? '700' : '500') + ';">' + a.name + (isDefault ? ' <span title="Default Agent" style="color:var(--brand-yellow); font-size:0.75rem;">★</span>' : '') + '</span>' +
            '</div>' +
            '<span style="font-size:0.75rem; color:var(--text-dim);">' + (a.model ? (a.model.split('/')[1] || a.model) : '') + (isActive ? ' ✓' : '') + '</span>';
        
        item.onclick = (e) => {
            e.stopPropagation();
            activeAgentName = a.name;
            updateHeaderAgentPill(a.name, a.color);
            sendToPython({ action: "select_agent", name: a.name });
            headerAgentDropdown.classList.remove('open');
            sendToPython({ action: "get_agent_data", name: a.name });
        };

        item.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            contextMenuTargetAgent = a.name;
            const menu = document.getElementById('agent-context-menu');
            if (menu) {
                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';
                menu.style.display = 'block';
            }
        };

        dropdownAgentsList.appendChild(item);
    });
}

const btnSetDefault = document.getElementById('btn-set-default-agent');
if (btnSetDefault) {
    btnSetDefault.onclick = (e) => {
        e.stopPropagation();
        if (contextMenuTargetAgent) {
            sendToPython({ action: "set_default_agent", name: contextMenuTargetAgent });
            defaultAgentName = contextMenuTargetAgent;
            renderHeaderAgentDropdown(headerAgentSearch.value);
        }
        const ctxMenu = document.getElementById('agent-context-menu');
        if (ctxMenu) ctxMenu.style.display = 'none';
    };
}

const btnManageContextAgent = document.getElementById('btn-manage-context-agent');
if (btnManageContextAgent) {
    btnManageContextAgent.onclick = (e) => {
        e.stopPropagation();
        const target = contextMenuTargetAgent;
        const ctxMenu = document.getElementById('agent-context-menu');
        if (ctxMenu) ctxMenu.style.display = 'none';
        headerAgentDropdown.classList.remove('open');
        if (target) {
            openAgentConfig(target, false); // Opens Manage dialog specifically for the right-clicked agent
        }
    };
}

document.getElementById('btn-header-agent-pill').onclick = (e) => {
    e.stopPropagation();
    headerAgentDropdown.classList.toggle('open');
    if (headerAgentDropdown.classList.contains('open')) {
        sendToPython({ action: "get_status" });
        sendToPython({ action: "get_agent_data" });
        renderHeaderAgentDropdown(headerAgentSearch.value);
        headerAgentSearch.focus();
    }
};

headerAgentSearch.addEventListener('input', (e) => renderHeaderAgentDropdown(e.target.value));

document.getElementById('btn-dropdown-manage-agents').onclick = (e) => {
    e.stopPropagation();
    headerAgentDropdown.classList.remove('open');
    openAgentConfig(activeAgentName, true); // Opens in "Add Agent" mode (cleared name/backstory, Save As New only)
};

// Drawer Controls
document.getElementById('btn-open-drawer').onclick = () => toggleDrawer(true);
document.getElementById('btn-close-drawer').onclick = () => toggleDrawer(false);
sidebarOverlay.onclick = () => toggleDrawer(false);

document.getElementById('btn-tray-new-chat').onclick = () => {
    sendToPython({ action: "clear_all" });
    toggleDrawer(false);
};
document.getElementById('btn-tray-settings').onclick = () => {
    toggleDrawer(false);
    openGlobalSettings();
};
document.getElementById('btn-tray-agent-edit').onclick = () => {
    toggleDrawer(false);
    openAgentConfig();
};
document.getElementById('btn-tray-schedules').onclick = () => {
    toggleDrawer(false);
    openSchedulesModal();
};

let currentWorkspaceRelPath = "";
let pendingDeleteItem = null;

function openWorkspaceModal(relPath = "") {
    currentWorkspaceRelPath = relPath;
    document.getElementById('ws-breadcrumb').innerText = "FederateWorkspace" + (relPath ? "/" + relPath : "");
    sendToPython({ action: "list_workspace", path: relPath });
    document.getElementById('workspace-modal').style.display = 'flex';
}

document.getElementById('btn-ws-up').onclick = () => {
    if (!currentWorkspaceRelPath) return;
    const parts = currentWorkspaceRelPath.split("/").filter(Boolean);
    parts.pop();
    openWorkspaceModal(parts.join("/"));
};

document.getElementById('btn-tray-directory').onclick = () => {
    toggleDrawer(false);
    openWorkspaceModal("");
};

document.getElementById('btn-ws-clear-cache').onclick = () => {
    const btn = document.getElementById('btn-ws-clear-cache');
    if (btn) {
        btn.classList.add('btn-clearing');
        const txt = btn.querySelector('.btn-text');
        if (txt) txt.innerText = 'Sweeping...';
    }
    sendToPython({ action: "clear_workspace_cache" });
};

document.getElementById('btn-confirm-delete').onclick = () => {
    if (pendingDeleteItem) {
        sendToPython({
            action: "delete_workspace_item",
            path: pendingDeleteItem.path,
            is_folder: pendingDeleteItem.is_folder
        });
        document.getElementById('delete-confirm-modal').style.display = 'none';
        pendingDeleteItem = null;
    }
};

function renderDrawerRecents() {
    drawerRecentsList.innerHTML = '';
    const namedSessions = cachedSessions.filter(s => s.name && !s.name.startsWith("sess_"));
    const displayList = showAllSessions ? cachedSessions : namedSessions.slice(0, 10);

    if (displayList.length === 0) {
        const empty = document.createElement('div');
        empty.style.color = 'var(--text-dim)';
        empty.style.fontSize = '0.8rem';
        empty.style.padding = '0.5rem 0';
        empty.innerText = 'No conversations yet.';
        drawerRecentsList.appendChild(empty);
        btnToggleAllSessions.style.display = 'none';
        return;
    }

    displayList.forEach(s => {
        const item = document.createElement('div');
        item.className = 'recent-chat-item';
        item.innerText = s.name || s.id;
        item.title = s.name || s.id;
        item.onclick = () => {
            sendToPython({ action: "load_session", path: s.path });
            toggleDrawer(false);
        };
        drawerRecentsList.appendChild(item);
    });

    btnToggleAllSessions.style.display = cachedSessions.length > 10 ? 'block' : 'none';
    btnToggleAllSessions.innerText = showAllSessions ? "Show less" : "... View all conversations";
}

btnToggleAllSessions.onclick = () => {
    showAllSessions = !showAllSessions;
    renderDrawerRecents();
};

// --- IPC BRIDGE LISTENER ---
window.electronAPI.onPythonMessage((msg) => {
    try {
        switch (msg.type) {
            case "init":
                dismissSplash();
                if (msg.session_token) sessionToken = msg.session_token;
                if (msg.default_agent) defaultAgentName = msg.default_agent;
                if (msg.agents && msg.agents.length > 0) {
                    cachedAgents = msg.agents;
                }
                if (msg.active_agent) {
                    activeAgentName = msg.active_agent;
                }
                const currentAgent = cachedAgents.find(a => a.name === activeAgentName);
                updateHeaderAgentPill(activeAgentName, currentAgent ? currentAgent.color : null);
                renderHeaderAgentDropdown(headerAgentSearch.value);

                if (msg.needs_onboarding) {
                    showOnboardingModal();
                }
                sendToPython({ action: "get_sessions" });
                break;

            case "keyring_unlock_required":
                dismissSplash();
                document.getElementById('keyring-modal').style.display = 'flex';
                document.getElementById('keyring-password-input').focus();
                break;

            case "keyring_unlock_success":
                document.getElementById('keyring-modal').style.display = 'none';
                document.getElementById('keyring-password-input').value = '';
                document.getElementById('keyring-error-msg').innerText = '';
                break;

            case "keyring_unlock_failed":
                document.getElementById('keyring-error-msg').innerText = msg.error || "Unlock failed.";
                break;

            case "agent_selected":
                activeAgentName = msg.name;
                updateHeaderAgentPill(msg.name, msg.color);
                break;

            case "default_agent_set":
                defaultAgentName = msg.name;
                renderHeaderAgentDropdown(headerAgentSearch.value);
                break;

            case "open_external_url":
                if (msg.url) {
                    window.electronAPI.openExternal(msg.url);
                }
                break;

            case "open_novnc":
                if (window.electronAPI && window.electronAPI.openNoVnc) {
                    window.electronAPI.openNoVnc(msg.url);
                } else if (msg.url) {
                    window.electronAPI.openExternal(msg.url);
                }
                break;

            case "chatgpt_oauth_status": {
                const authBtn = document.getElementById('btn-chatgpt-auth');
                const statusEl = document.getElementById('chatgpt-auth-status');
                const apiKeyInput = document.getElementById('cfg-agent-api-key');

                const onboardAuthBtn = document.getElementById('btn-onboard-chatgpt-auth');
                const onboardStatusEl = document.getElementById('onboard-chatgpt-status');
                const onboardApiKeyInput = document.getElementById('onboard-api-key');

                if (msg.status === "success") {
                    if (authBtn) {
                        authBtn.disabled = false;
                        authBtn.innerText = '✓ Authenticated with ChatGPT';
                        authBtn.style.background = 'var(--brand-green)';
                    }
                    if (statusEl) statusEl.innerHTML = '<span style="color: var(--brand-green);">✓ ' + window.electronAPI.escapeHtml(msg.message) + '</span>';
                    if (apiKeyInput) apiKeyInput.value = 'CHATGPT_OAUTH_ACTIVE';

                    if (onboardAuthBtn) {
                        onboardAuthBtn.disabled = false;
                        onboardAuthBtn.innerText = '✓ Authenticated with ChatGPT';
                        onboardAuthBtn.style.background = 'var(--brand-green)';
                    }
                    if (onboardStatusEl) onboardStatusEl.innerHTML = '<span style="color: var(--brand-green);">✓ ' + window.electronAPI.escapeHtml(msg.message) + '</span>';
                    if (onboardApiKeyInput) onboardApiKeyInput.value = 'CHATGPT_OAUTH_ACTIVE';
                } else if (msg.status === "failed") {
                    if (authBtn) {
                        authBtn.disabled = false;
                        authBtn.innerText = 'Authenticate with ChatGPT (OAuth)';
                        authBtn.style.background = 'var(--brand-primary)';
                    }
                    if (statusEl) statusEl.innerHTML = '<span style="color: var(--brand-red);">✗ ' + window.electronAPI.escapeHtml(msg.message) + '</span>';
                    if (onboardAuthBtn) {
                        onboardAuthBtn.disabled = false;
                        onboardAuthBtn.innerText = 'Authenticate with ChatGPT (OAuth)';
                    }
                    if (onboardStatusEl) onboardStatusEl.innerHTML = '<span style="color: var(--brand-red);">✗ ' + window.electronAPI.escapeHtml(msg.message) + '</span>';
                }
                break;
            }

            case "log":
                appendLog(msg.content, msg.is_markdown);
                break;

            case "message_block":
                appendMessageBlock(msg.header, msg.content, msg.color, msg.is_markdown, !!msg.silent);
                break;

            case "mount_progress":
                mountProgress(msg.tasks);
                break;

            case "update_progress":
                updateProgress(msg.task, msg.percent, msg.log);
                break;

            case "hide_progress":
                hideProgress();
                break;

            case "mount_ai_box":
                mountAIBox(msg.agent_name, msg.color);
                break;

            case "update_ai_box":
                updateAIBox(msg.content);
                break;

            case "tool_result":
                appendToolResult("Result", msg.agent, msg.color, msg.summary, false, !!msg.silent);
                break;

            case "tool_error":
                appendToolResult("Error", msg.agent, msg.color, msg.summary, true, !!msg.silent);
                break;

            case "spinner":
                updateMultiAgentWorkingState(msg.agent, !!msg.show, msg.color);
                break;

            case "status_bar":
                updateStatusBar(msg);
                break;

            case "clear_chat":
                chatContainer.innerHTML = '';
                if (welcomeHero) {
                    welcomeHero.style.display = 'block';
                    chatContainer.appendChild(welcomeHero);
                }
                activeAIMessageBlock = null;
                activeAIMessageBody = null;
                activeToolContainer = null;
                workingAgentsMap.clear();
                workingIndicator.style.display = "none";
                stopReactorAnimation();
                break;

            case "confirm_tool":
                showToolModal(msg);
                break;

            case "suggestions":
                renderSuggestions(msg);
                break;

            case "agent_data":
                populateAgentModal(msg.data, msg.all_tools, msg.all_agent_names);
                break;

            case "agent_save_status": {
                const saveBtn = document.getElementById('btn-save-agent');
                const saveNewBtn = document.getElementById('btn-save-as-new');
                const onboardBtn = document.getElementById('btn-onboard-submit');
                const onboardStatus = document.getElementById('onboard-status-msg');
                const onboardModal = document.getElementById('onboarding-modal');

                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerText = 'Save Changes'; }
                if (saveNewBtn) { saveNewBtn.disabled = false; saveNewBtn.innerText = 'Save As New'; }
                if (onboardBtn) { onboardBtn.disabled = false; onboardBtn.innerText = '🚀 Initialize Agent & Start'; }

                if (msg.status === "success") {
                    closeModals();
                    const hero = document.getElementById('welcome-hero');
                    if (hero) hero.style.display = 'block';
                } else if (msg.status === "failed") {
                    if (onboardStatus && onboardModal && onboardModal.style.display === 'flex') {
                        onboardStatus.innerHTML = '<span style="color: var(--brand-red);">✗ Verification failed: ' + window.electronAPI.escapeHtml(msg.error || 'Check key & model.') + '</span>';
                    } else {
                        appendLog('[bold red]Agent verification failed:[/] ' + window.electronAPI.escapeHtml(msg.error || 'Please check your API key, model name, and base URL.'), false);
                    }
                }
                break;
            }

            case "global_settings_data":
                if (msg.data) {
                    if (msg.data.user_name) {
                        cachedUserName = msg.data.user_name;
                        localStorage.setItem("federaide-username", cachedUserName);
                    }
                    if (msg.data.user_color) {
                        cachedUserColor = msg.data.user_color;
                        localStorage.setItem("federaide-usercolor", cachedUserColor);
                    }
                    populateGlobalSettingsModal(msg.data);
                }
                break;

            case "sessions_list_data":
                cachedSessions = msg.sessions || [];
                renderDrawerRecents();
                break;

            case "schedules_data":
                renderSchedulesList(msg.tasks || []);
                break;

            case "workspace_list": {
                const listEl = document.getElementById('ws-file-list');
                listEl.innerHTML = '';
                if (!msg.items || msg.items.length === 0) {
                    listEl.innerHTML = '<div style="color:var(--text-dim);font-size:0.82rem;padding:0.5rem 0;">Directory is empty.</div>';
                    break;
                }
                msg.items.forEach(item => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:6px 8px; border-radius:8px; background:var(--bg-card);';
                    
                    const nameSpan = document.createElement('span');
                    nameSpan.style.cssText = 'cursor:pointer; font-size:0.85rem; display:flex; align-items:center; gap:6px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                    nameSpan.innerHTML = (item.is_dir ? '📁 ' : '📄 ') + window.electronAPI.escapeHtml(item.name) + (!item.is_dir ? ' <span style="font-size:0.7rem;color:var(--text-dim);">(' + (item.size > 1048576 ? (item.size/1048576).toFixed(1) + 'MB' : (item.size/1024).toFixed(1) + 'KB') + ')</span>' : '');
                    
                    if (item.is_dir) {
                        nameSpan.onclick = () => openWorkspaceModal(msg.current_path ? msg.current_path + "/" + item.name : item.name);
                    }

                    const itemFullPath = msg.current_path ? msg.current_path + "/" + item.name : item.name;

                    const btnGroup = document.createElement('div');
                    btnGroup.style.cssText = 'display:flex; gap:4px; align-items:center;';

                    const delBtn = document.createElement('button');
                    delBtn.className = 'modal-btn btn-secondary';
                    delBtn.style.cssText = 'padding:3px 6px; font-size:0.72rem; color:var(--brand-red);';
                    delBtn.innerText = '🗑️';
                    delBtn.title = 'Delete';
                    delBtn.onclick = () => {
                        pendingDeleteItem = { path: itemFullPath, is_folder: item.is_dir };
                        document.getElementById('del-item-name').innerText = (item.is_dir ? '📁 ' : '📄 ') + itemFullPath;
                        document.getElementById('delete-confirm-modal').style.display = 'flex';
                    };

                    btnGroup.appendChild(delBtn);
                    row.appendChild(nameSpan);
                    row.appendChild(btnGroup);
                    listEl.appendChild(row);
                });
                break;
            }

            case "workspace_cache_cleared": {
                const btn = document.getElementById('btn-ws-clear-cache');
                if (btn) {
                    btn.classList.remove('btn-clearing');
                    btn.classList.add('btn-cleared');
                    const count = msg.count || 0;
                    btn.innerHTML = '<span class="sweep-icon">✨</span> <span class="btn-text">Cleared (' + count + ')</span>';
                    setTimeout(() => {
                        btn.classList.remove('btn-cleared');
                        btn.innerHTML = '<span class="sweep-icon">🧹</span> <span class="btn-text">Clear Cache</span>';
                    }, 2000);
                }
                appendLog('[bold green]🧹 Workspace cache cleared successfully.[/bold green]', false);
                break;
            }
        }
    } catch (err) {
        console.error("IPC Message Handler Error:", err);
    }
});

function updateHeaderAgentPill(name, color) {
    const label = document.getElementById('header-agent-name');
    const dot = document.getElementById('header-agent-dot');
    if (label) label.innerText = name;
    if (dot && color) dot.style.background = color;

    const safeColor = color || '#3ddbd9';
    document.documentElement.style.setProperty('--active-agent-color', safeColor);
    document.documentElement.style.setProperty('--active-agent-glow', hexToRgba(safeColor, 0.15));
    document.documentElement.style.setProperty('--active-agent-glow-strong', hexToRgba(safeColor, 0.35));
}

let currentAgentMode = "PLAN";

function updateStatusBar(msg) {
    if (msg.mode) {
        currentAgentMode = msg.mode;
    }
    const label = document.getElementById('tray-cwd-label');
    if (label && msg.cwd) {
        const parts = msg.cwd.split(/[/\\]/);
        label.innerText = parts[parts.length - 1] || msg.cwd;
    }
    const modeMap = { PLAN: "SAFE", INTERMEDIATE: "SEMI-AUTO", EXECUTE: "FULL-AUTO" };
    const displayMode = modeMap[currentAgentMode] || currentAgentMode;
    statusMode.innerText = '[' + displayMode + ']';
    statusMode.className = 'badge-pill ' + (displayMode === "SAFE" ? "mode-plan" : (displayMode === "SEMI-AUTO" ? "mode-intermediate" : "mode-execute"));
}

function hideWelcomeHero() {
    const hero = document.getElementById('welcome-hero');
    if (hero) hero.style.display = 'none';
}

function getAgentColor(name) {
    const found = cachedAgents.find(a => a.name.toLowerCase() === (name || "").toLowerCase());
    return found ? found.color : "var(--brand-teal)";
}

function appendLog(text, isMarkdown) {
    const clean = stripRichTags(text);
    if (clean.includes("ALL CONTEXTS CLEARED") || clean.includes("Fresh multiagent session")) {
        if (welcomeHero) welcomeHero.style.display = 'block';
        return;
    }
    hideWelcomeHero();
    
    if (activeToolContainer && activeToolReadout) {
        const line = document.createElement('div');
        line.style.wordBreak = 'break-word';
        line.style.marginTop = '4px';
        line.style.color = 'var(--text-muted)';
        line.innerHTML = isMarkdown ? window.electronAPI.renderMarkdown(clean) : window.electronAPI.escapeHtml(clean).replace(/\n/g, '<br>');
        activeToolReadout.appendChild(line);
        if (activeToolCard && !activeToolCard.isExpanded) {
            setTimeout(() => { activeToolReadout.scrollTop = activeToolReadout.scrollHeight; }, 10);
        }
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return;
    }

    const div = document.createElement('div');
    div.style.color = 'var(--text-dim)';
    div.style.fontSize = '0.82rem';
    div.style.margin = '0.3rem 0';
    div.innerHTML = isMarkdown ? window.electronAPI.renderMarkdown(clean) : window.electronAPI.escapeHtml(clean).replace(/\n/g, '<br>');
    chatContainer.appendChild(div);
    applyLatexPass(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function appendMessageBlock(header, content, color, isMarkdown, silent = false) {
    hideWelcomeHero();
    const cleanHead = stripRichTags(header);
    const cleanBody = stripRichTags(content);
    
    const isToolCall = cleanHead.toLowerCase().includes("tool call");
    const senderName = cleanHead.replace(/:\s*$/, '').replace(/\(to .*\):?\s*$/, '').replace(/\(tool call\)/i, '').trim();
    
    const isExplicitUser = (
        senderName.toLowerCase() === (cachedUserName || "user").toLowerCase() ||
        senderName.toLowerCase() === "user" ||
        senderName.toLowerCase().startsWith("telegram")
    );
    const isAI = isToolCall || (!isExplicitUser && senderName.toLowerCase() !== "system");
    const isUser = isExplicitUser;

    if (!silent) {
        if (isToolCall) {
            soundFX.toolCall();
        } else if (isAI) {
            soundFX.agentChime();
        }
    }

    const block = document.createElement('div');
    block.className = 'message-block ai-block';

    let agentAccent = isToolCall ? getAgentColor(senderName) : (color || (isUser ? (cachedUserColor || '#dda0dd') : getAgentColor(senderName)));
    block.style.setProperty('--agent-accent', agentAccent);

    const card = document.createElement('div');
    card.className = 'ai-bubble-card' + (isToolCall ? ' tool-call-card' : '');
    card.dataset.sender = senderName;
    card.dataset.isToolCall = isToolCall ? "true" : "false";
    
    if (isToolCall) {
        let images = [];
        let processedBody = cleanBody.replace(/\[ImageBase64:\s*(data:image\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+)\]/g, (match, b64) => {
            images.push(b64); return '';
        });

        if (activeToolContainer && activeToolContainer.dataset.sender === senderName) {
            let _imgIdx = 0;
            const appendChunk = () => {
                const chunk = images.slice(_imgIdx, _imgIdx + 3);
                if (!chunk.length) return;
                chunk.forEach(b64 => {
                    const img = document.createElement('img');
                    img.decoding = 'async';
                    img.loading = 'lazy';
                    img.src = b64;
                    img.style.cssText = 'width: 100%; height: auto; border-radius: 8px; margin-bottom: 8px; display: block;';
                    activeToolImages.appendChild(img);
                });
                _imgIdx += 3;
                setTimeout(appendChunk, 15);
            };
            appendChunk();

            if (processedBody.trim()) {
                const line = document.createElement('div');
                line.style.wordBreak = 'break-word';
                line.style.marginTop = '4px';
                line.style.color = 'var(--text-muted)';
                line.innerHTML = '<pre style="margin:0; font-family:var(--font-mono); white-space:pre-wrap; font-size:0.82rem;">' + window.electronAPI.escapeHtml(processedBody.trim()) + '</pre>';
                activeToolReadout.appendChild(line);
            }
            if (!activeToolCard.isExpanded) {
                setTimeout(() => { activeToolReadout.scrollTop = activeToolReadout.scrollHeight; }, 10);
            }
            chatContainer.scrollTop = chatContainer.scrollHeight;
            return;
        }

        activeToolContainer = block;
        activeToolContainer.dataset.sender = senderName;
        card.className = 'tool-result-box';
        card.style.cssText = 'border: 2px dashed ' + agentAccent + '; border-radius: 16px !important; display: flex; flex-direction: column; overflow: hidden; transition: all 0.2s ease; margin: 0;';
        
        const head = document.createElement('div');
        head.className = 'message-header';
        head.style.color = agentAccent;
        head.innerHTML = '<span>✦</span> <span>' + window.electronAPI.escapeHtml(cleanHead) + '</span>';
        
        activeToolImages = document.createElement('div');
        
        activeToolReadout = document.createElement('div');
        activeToolReadout.style.cssText = 'font-size: 0.82rem; line-height: 1.4; display: block; max-height: 1.4em; overflow: hidden; margin-top: 4px; scroll-behavior: auto;';
        
        const expander = document.createElement('div');
        expander.style.cssText = 'font-size: 0.75rem; color: ' + agentAccent + '; margin-top: 6px; font-weight: bold; pointer-events: none;';
        expander.innerText = 'Click to expand';
        
        activeToolCard = card;
        activeToolCard.isExpanded = false;
        activeToolCard.onclick = () => {
            activeToolCard.isExpanded = !activeToolCard.isExpanded;
            if (activeToolCard.isExpanded) {
                activeToolReadout.style.maxHeight = 'none';
                expander.innerText = 'Click to collapse';
            } else {
                activeToolReadout.style.maxHeight = '1.4em';
                setTimeout(() => { activeToolReadout.scrollTop = activeToolReadout.scrollHeight; }, 10);
                expander.innerText = 'Click to expand';
            }
        };
        
        card.appendChild(head);
        card.appendChild(activeToolImages);
        card.appendChild(activeToolReadout);
        card.appendChild(expander);
        block.appendChild(card);
        
        chatContainer.appendChild(block);
        
        let _imgIdx = 0;
        const appendChunk = () => {
            const chunk = images.slice(_imgIdx, _imgIdx + 3);
            if (!chunk.length) return;
            chunk.forEach(b64 => {
                const img = document.createElement('img');
                img.decoding = 'async';
                img.loading = 'lazy';
                img.src = b64;
                img.style.cssText = 'width: 100%; height: auto; border-radius: 8px; margin-bottom: 8px; display: block;';
                activeToolImages.appendChild(img);
            });
            _imgIdx += 3;
            setTimeout(appendChunk, 15);
        };
        appendChunk();
        
        if (processedBody.trim()) {
            const line = document.createElement('div');
            line.style.wordBreak = 'break-word';
            line.style.marginTop = '4px';
            line.style.color = 'var(--text-muted)';
            line.innerHTML = '<pre style="margin:0; font-family:var(--font-mono); white-space:pre-wrap; font-size:0.82rem;">' + window.electronAPI.escapeHtml(processedBody.trim()) + '</pre>';
            activeToolReadout.appendChild(line);
        }
        
        if (!activeToolCard.isExpanded) {
            setTimeout(() => { activeToolReadout.scrollTop = activeToolReadout.scrollHeight; }, 10);
        }
        
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return;
    } else {
        activeToolContainer = null;
        if (isUser) {
            card.style.cssText = 'border-radius: 18px 18px 4px 18px !important;';
        } else {
            card.style.cssText = 'border-radius: 18px 18px 18px 4px !important;';
        }

        const head = document.createElement('div');
        head.className = 'message-header';
        head.style.color = agentAccent;
        head.innerHTML = '<span>✦</span> <span>' + window.electronAPI.escapeHtml(cleanHead) + '</span>';

        const body = document.createElement('div');
        body.className = 'message-body';
        
        let images = [];
        let processedBody = cleanBody.replace(/\[ImageBase64:\s*(data:image\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+)\]/g, (match, b64) => {
            images.push(b64);
            return '';
        });

        body.innerHTML = isMarkdown ? window.electronAPI.renderMarkdown(processedBody) : '<pre>' + window.electronAPI.escapeHtml(processedBody) + '</pre>';

        let _imgIdx = 0;
        const appendChunk = () => {
            const chunk = images.slice(_imgIdx, _imgIdx + 3);
            if (!chunk.length) return;
            chunk.forEach(b64 => {
                const img = document.createElement('img');
                img.decoding = 'async';
                img.loading = 'lazy';
                img.src = b64;
                img.style.cssText = 'width: 100%; height: auto; border-radius: 8px; margin-top: 12px; display: block;';
                body.appendChild(img);
            });
            _imgIdx += 3;
            setTimeout(appendChunk, 15);
        };
        appendChunk();

        card.appendChild(head);
        card.appendChild(body);
        block.appendChild(card);

        chatContainer.appendChild(block);
        applyLatexPass(block);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        activeAIMessageBlock = null;
        activeAIMessageBody = null;
    }
}

// --- DEEP RESEARCH SWARM HUD ENGINE ---
function formatSwarmLogLine(rawMsg) {
    let clean = stripRichTags(String(rawMsg || ''));
    clean = window.electronAPI.escapeHtml(clean);
    clean = clean.replace(/\[SEARCH\]/g, '<span style="color: var(--brand-teal); font-weight: 700;">[SEARCH]</span>');
    clean = clean.replace(/\[FETCH\]/g, '<span style="color: var(--brand-yellow); font-weight: 700;">[FETCH]</span>');
    clean = clean.replace(/\[TARGET REACHED\]/g, '<span style="color: var(--brand-green); font-weight: 700;">[TARGET REACHED]</span>');
    clean = clean.replace(/\[PIVOT\]/g, '<span style="color: var(--brand-orange); font-weight: 700;">[PIVOT]</span>');
    clean = clean.replace(/\[RECOVERY\]/g, '<span style="color: var(--brand-red); font-weight: 700;">[RECOVERY]</span>');
    clean = clean.replace(/\[ENFORCER\]/g, '<span style="color: var(--brand-red); font-weight: 700;">[ENFORCER]</span>');
    clean = clean.replace(/\[SWARM INIT\]/g, '<span style="color: var(--brand-teal); font-weight: 700;">[SWARM INIT]</span>');
    clean = clean.replace(/\[POST-PROCESS\]/g, '<span style="color: var(--brand-green); font-weight: 700;">[POST-PROCESS]</span>');
    clean = clean.replace(/\[MASTER ORCHESTRATOR\]/g, '<span style="color: var(--brand-green); font-weight: 700;">[MASTER ORCHESTRATOR]</span>');
    clean = clean.replace(/(\[\d+\/\d+\])/g, '<span style="color: var(--brand-yellow); font-weight: 700;">$1</span>');
    clean = clean.replace(/\b(ANNEXURE [A-Z])\b/g, '<span style="color: var(--brand-teal); font-weight: 700;">$1</span>');
    return clean;
}

function mountProgress(tasks) {
    hideWelcomeHero();

    let hud = document.getElementById('research-swarm-hud');
    if (!hud) {
        hud = document.createElement('div');
        hud.id = 'research-swarm-hud';
    }

    let tasksHtml = '';
    (tasks || []).forEach(function(t) {
        const safeId = 'task_' + String(t || '').replace(/[^a-zA-Z0-9]/g, '_');

        tasksHtml += '<div class="swarm-task-card" id="card-' + safeId + '">' +
            '<div class="swarm-task-header">' +
                '<div class="swarm-task-left">' +
                    '<div class="swarm-spinner" id="spin-' + safeId + '"></div>' +
                    '<span class="swarm-task-name">' + window.electronAPI.escapeHtml(t) + '</span>' +
                '</div>' +
                '<span class="swarm-task-pct" id="pct-' + safeId + '">0%</span>' +
            '</div>' +
            '<div class="swarm-progress-track">' +
                '<div class="swarm-progress-fill" id="fill-' + safeId + '" style="width: 0%;"></div>' +
            '</div>' +
        '</div>';
    });

    const taskCount = tasks ? tasks.length : 0;
    hud.innerHTML = '<div class="swarm-header">' +
        '<div class="swarm-title">' +
            '<span>🛸</span>' +
            '<span>DEEP RESEARCH SWARM</span>' +
        '</div>' +
    '</div>' +
    '<div class="swarm-body">' +
        '<div class="swarm-tasks-list">' + tasksHtml + '</div>' +
        '<div class="swarm-log-header">' +
            '<span>📟 LIVE SWARM TELEMETRY STREAM</span>' +
            '<span style="color: var(--brand-green); font-size: 0.68rem;">● Live</span>' +
        '</div>' +
        '<div class="swarm-log-container" id="swarm-log-feed">' +
            '<div class="swarm-log-line" style="color: var(--brand-teal);">[SWARM INIT] Master Orchestrator deployed ' + taskCount + ' parallel research agents...</div>' +
        '</div>' +
    '</div>';

    hud.style.display = 'flex';
    hud.style.flexShrink = '0';
    chatContainer.appendChild(hud);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function updateProgress(task, percent, logMsg) {
    const safeId = 'task_' + String(task || '').replace(/[^a-zA-Z0-9]/g, '_');

    const fillEl = document.getElementById('fill-' + safeId);
    const pctEl = document.getElementById('pct-' + safeId);
    const cardEl = document.getElementById('card-' + safeId);
    const spinEl = document.getElementById('spin-' + safeId);

    if (percent !== null && percent !== undefined) {
        const rawPct = (percent <= 5) ? 0 : percent;
        const cleanPct = Math.min(Math.max(Math.round(rawPct), 0), 100);
        if (fillEl) fillEl.style.width = cleanPct + '%';
        if (pctEl) {
            pctEl.innerText = cleanPct >= 100 ? '✓ Done' : (cleanPct + '%');
            if (cleanPct >= 100) pctEl.style.color = 'var(--brand-green)';
        }
        if (cleanPct >= 100) {
            if (spinEl) {
                spinEl.className = 'swarm-spinner done';
                spinEl.innerText = '✓';
            }
            if (cardEl) {
                cardEl.classList.add('completed');
            }
        }
    }

    if (logMsg) {
        const feed = document.getElementById('swarm-log-feed');
        if (feed) {
            const line = document.createElement('div');
            line.className = 'swarm-log-line';
            line.innerHTML = formatSwarmLogLine(logMsg);
            feed.appendChild(line);
            feed.scrollTop = feed.scrollHeight;
        }
    }
}

function hideProgress() {
    const hud = document.getElementById('research-swarm-hud');
    if (hud) {
        const feed = document.getElementById('swarm-log-feed');
        if (feed) {
            const line = document.createElement('div');
            line.className = 'swarm-log-line';
            line.style.color = 'var(--brand-green)';
            line.style.fontWeight = 'bold';
            line.innerHTML = '✨ [MASTER ORCHESTRATOR] All annexures gathered. Generating master report & rendering PDF...';
            feed.appendChild(line);
            feed.scrollTop = feed.scrollHeight;
        }
    }
}

function mountAIBox(agentName, color) {
    activeToolContainer = null;
    hideWelcomeHero();
    soundFX.agentChime();
    const agentAccent = color || getAgentColor(agentName);

    const block = document.createElement('div');
    block.className = 'message-block ai-block';
    block.style.setProperty('--agent-accent', agentAccent);

    const card = document.createElement('div');
    card.className = 'ai-bubble-card';

    const head = document.createElement('div');
    head.className = 'message-header';
    head.innerHTML = '<span>✦</span> <span>' + window.electronAPI.escapeHtml(agentName) + '</span>';

    activeAIMessageBody = document.createElement('div');
    activeAIMessageBody.className = 'message-body';

    card.appendChild(head);
    card.appendChild(activeAIMessageBody);
    block.appendChild(card);

    chatContainer.appendChild(block);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    activeAIMessageBlock = block;
}

function updateAIBox(content) {
    if (!activeAIMessageBody) {
        mountAIBox(activeAgentName || "Agent", getAgentColor(activeAgentName));
    }
    if (activeAIMessageBody) {
        let images = [];
        let cleanContent = (content || "").replace(/\[ImageBase64:\s*(data:image\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+)\]/g, (match, b64) => {
            images.push(b64);
            return '';
        });
        
        activeAIMessageBody.innerHTML = window.electronAPI.renderMarkdown(stripRichTags(cleanContent));
        
        let _imgIdx = 0;
        const appendChunk = () => {
            const chunk = images.slice(_imgIdx, _imgIdx + 3);
            if (!chunk.length) return;
            chunk.forEach(b64 => {
                const img = document.createElement('img');
                img.decoding = 'async';
                img.loading = 'lazy';
                img.src = b64;
                img.style.cssText = 'width: 100%; height: auto; border-radius: 8px; margin-top: 12px; display: block;';
                activeAIMessageBody.appendChild(img);
            });
            _imgIdx += 3;
            setTimeout(appendChunk, 15);
        };
        appendChunk();
        
        applyLatexPass(activeAIMessageBody);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

function appendToolResult(type, agent, color, summary, isError = false, silent = false) {
    hideWelcomeHero();
    if (!silent) {
        soundFX.toolResult();
    }
    const accent = isError ? "var(--brand-red)" : (color || getAgentColor(agent));

    let rawText = stripRichTags(summary);
    let images = [];
    rawText = rawText.replace(/\[ImageBase64:\s*(data:image\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+)\]/g, (match, b64) => {
        images.push(b64);
        return '';
    }).trim();

    if (activeToolContainer && activeToolReadout && activeToolImages && activeToolCard && activeToolContainer.dataset.sender === agent) {
        let _imgIdx = 0;
        const appendChunk = () => {
            const chunk = images.slice(_imgIdx, _imgIdx + 3);
            if (!chunk.length) return;
            chunk.forEach(b64 => {
                const img = document.createElement('img');
                img.decoding = 'async';
                img.loading = 'lazy';
                img.src = b64;
                img.style.cssText = 'width: 100%; height: auto; border-radius: 8px; margin-bottom: 8px; display: block;';
                activeToolImages.appendChild(img);
            });
            _imgIdx += 3;
            setTimeout(appendChunk, 15);
        };
        appendChunk();

        if (rawText) {
            const line = document.createElement('div');
            line.style.wordBreak = 'break-word';
            line.style.marginTop = '4px';
            line.style.color = 'var(--text-muted)';
            line.innerHTML = '<pre style="margin:0; font-family:var(--font-mono); white-space:pre-wrap; font-size:0.82rem;">' + window.electronAPI.escapeHtml(rawText) + '</pre>';
            activeToolReadout.appendChild(line);
        }

        if (!activeToolCard.isExpanded) {
            setTimeout(() => { activeToolReadout.scrollTop = activeToolReadout.scrollHeight; }, 10);
        }

        if (isError) {
            activeToolCard.style.borderColor = 'var(--brand-red)';
            activeToolContainer.style.setProperty('--agent-accent', 'var(--brand-red)');
        }

        chatContainer.scrollTop = chatContainer.scrollHeight;
        return;
    }

    const block = document.createElement('div');
    block.className = 'message-block ai-block';
    block.style.setProperty('--agent-accent', accent);

    const card = document.createElement('div');
    card.className = 'tool-result-box';

    const head = document.createElement('div');
    head.className = 'message-header';
    head.innerHTML = '<span>✦</span> <span>' + window.electronAPI.escapeHtml(type + ' (' + agent + ')') + '</span>';

    const body = document.createElement('div');
    body.className = 'message-body';

    const lines = rawText.split('\n');

    if (lines.length > 6) {
        const first3 = lines.slice(0, 3).join('\n');
        const last3 = lines.slice(-3).join('\n');
        const collapsedHtml = window.electronAPI.escapeHtml(first3) + '\n\n<b><i>Shortened for brevity, click to toggle.</i></b>\n\n' + window.electronAPI.escapeHtml(last3);
        const fullHtml = window.electronAPI.escapeHtml(rawText);
        let isExpanded = false;
        body.innerHTML = collapsedHtml;
        card.onclick = function() {
            isExpanded = !isExpanded;
            body.innerHTML = isExpanded ? fullHtml : collapsedHtml;
        };
    } else {
        body.innerText = rawText;
    }

    card.appendChild(head);

    let _imgIdx = 0;
    const appendChunk = () => {
        const chunk = images.slice(_imgIdx, _imgIdx + 3);
        if (!chunk.length) return;
        chunk.forEach(b64 => {
            const img = document.createElement('img');
            img.decoding = 'async';
            img.loading = 'lazy';
            img.src = b64;
            img.style.cssText = 'width: 100%; height: auto; border-radius: 8px; margin-top: 6px; display: block;';
            card.insertBefore(img, body); // Insert above text instead of end-of-card
        });
        _imgIdx += 3;
        setTimeout(appendChunk, 15);
    };
    appendChunk();

    card.appendChild(body);
    block.appendChild(card);

    chatContainer.appendChild(block);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Suggestions
function renderSuggestions(msg) {
    currentSuggestions = msg.matches || [];
    currentPrefix = msg.prefix || "";
    selectedSuggestionIdx = currentSuggestions.length > 0 ? 0 : -1;

    if (currentSuggestions.length === 0) {
        suggestionsPopup.style.display = 'none';
        return;
    }

    suggestionsPopup.innerHTML = '';
    currentSuggestions.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'suggestion-item ' + (idx === 0 ? 'selected' : '');
        row.innerHTML = '<span>' + window.electronAPI.escapeHtml(item.match) + '</span><span style="color:var(--text-dim); font-size:0.75rem;">' + window.electronAPI.escapeHtml(item.desc) + '</span>';
        row.onclick = () => applySuggestion(item.match);
        suggestionsPopup.appendChild(row);
    });
    suggestionsPopup.style.display = 'block';
}

function applySuggestion(matchText) {
    chatInput.value = currentPrefix + matchText;
    suggestionsPopup.style.display = 'none';
    currentSuggestions = [];
    adjustTextareaHeight();
    chatInput.focus();
}

chatInput.addEventListener('input', () => {
    adjustTextareaHeight();
    updateSendButtonState();
    sendToPython({ action: "get_suggestions", value: chatInput.value });
});

chatInput.addEventListener('keydown', (e) => {
    if (suggestionsPopup.style.display === 'block' && currentSuggestions.length > 0) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSuggestionIdx = (selectedSuggestionIdx + 1) % currentSuggestions.length;
            updateSelectedSuggestion();
            return;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSuggestionIdx = (selectedSuggestionIdx - 1 + currentSuggestions.length) % currentSuggestions.length;
            updateSelectedSuggestion();
            return;
        } else if (e.key === 'Tab' || e.key === 'ArrowRight') {
            e.preventDefault();
            applySuggestion(currentSuggestions[selectedSuggestionIdx].match);
            return;
        } else if (e.key === 'Escape') {
            suggestionsPopup.style.display = 'none';
            return;
        }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitPrompt();
    }
});

function updateSelectedSuggestion() {
    const items = suggestionsPopup.querySelectorAll('.suggestion-item');
    items.forEach((item, idx) => {
        item.classList.toggle('selected', idx === selectedSuggestionIdx);
    });
}

// --- ATTACHMENTS & DRAG/DROP ---
const filePickerInput = document.getElementById('file-picker-input');
const pendingAttachmentsBar = document.getElementById('pending-attachments-bar');

function sanitizeAttachmentName(originalName, defaultExt = '.jpg') {
    let name = originalName || 'file';
    let clean = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = Date.now();
    const dotIdx = clean.lastIndexOf('.');
    if (dotIdx !== -1 && dotIdx < clean.length - 1) {
        const baseName = clean.substring(0, dotIdx);
        const ext = clean.substring(dotIdx);
        return baseName + '_' + timestamp + ext;
    }
    return clean + '_' + timestamp + defaultExt;
}

function handleSelectedFiles(files) {
    if (!files || files.length === 0) return;
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            let fallbackExt = '.jpg';
            if (file.type) {
                const sub = file.type.split('/')[1];
                if (sub) fallbackExt = '.' + sub.replace(/[^a-zA-Z0-9]/g, '');
            }
            const savedName = sanitizeAttachmentName(file.name, fallbackExt);
            pendingAttachments.push({
                name: savedName,
                data: e.target.result
            });
            renderPendingAttachments();
        };
        reader.readAsDataURL(file);
    });
}

if (filePickerInput) {
    filePickerInput.onchange = (e) => {
        handleSelectedFiles(e.target.files);
        e.target.value = '';
    };
}

window.removeAttachment = function(idx) {
    pendingAttachments.splice(idx, 1);
    renderPendingAttachments();
};

function renderPendingAttachments() {
    if (!pendingAttachmentsBar) return;
    if (pendingAttachments.length === 0) {
        pendingAttachmentsBar.style.display = 'none';
        pendingAttachmentsBar.innerHTML = '';
        updateSendButtonState();
        return;
    }
    pendingAttachmentsBar.innerHTML = '';
    pendingAttachmentsBar.style.display = 'flex';
    pendingAttachments.forEach((att, idx) => {
        const chip = document.createElement('div');
        chip.className = 'attachment-chip';
        const isImg = att.data && /^data:image\/[a-zA-Z0-9+.-]+;base64,/.test(att.data);
        const preview = isImg 
            ? '<img src="' + window.electronAPI.escapeHtml(att.data) + '" style="height:16px;width:16px;border-radius:3px;object-fit:cover;vertical-align:middle;margin-right:4px;">' 
            : '📎 ';
            
        chip.innerHTML = '<span>' + preview + window.electronAPI.escapeHtml(att.name) + '</span><button type="button" onclick="removeAttachment(' + idx + ')">×</button>';
        pendingAttachmentsBar.appendChild(chip);
    });
    updateSendButtonState();
}

// Drag & Drop
['dragenter', 'dragover'].forEach(eventName => {
    document.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputCapsule.classList.add('drag-over');
    }, false);
});

['dragleave', 'drop'].forEach(eventName => {
    document.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputCapsule.classList.remove('drag-over');
    }, false);
});

document.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleSelectedFiles(e.dataTransfer.files);
    }
});

function submitPrompt() {
    const isWorking = workingAgentsMap.size > 0;
    const text = chatInput.value.trim();
    const hasText = (text.length > 0 || pendingAttachments.length > 0);

    if (isWorking && !hasText) {
        sendToPython({ action: "abort" });
        workingAgentsMap.clear();
        workingIndicator.style.display = "none";
        stopReactorAnimation();
        updateSendButtonState();
        appendLog("[bold red]Operation Aborted by User.[/bold red]", false);
        return;
    }

    if (!hasText) return;

    soundFX.send();

    pendingAttachments.forEach(att => {
        sendToPython({
            action: "save_attachment",
            filename: att.name,
            data: att.data
        });
    });

    let fullText = text;
    if (pendingAttachments.length > 0) {
        const attachmentTags = pendingAttachments.map(a => '&' + a.name).join(' ');
        fullText = (fullText ? fullText + ' ' : '') + attachmentTags;
    }

    sendToPython({ action: "input", text: fullText });

    chatInput.value = '';
    chatInput.style.height = 'auto';
    suggestionsPopup.style.display = 'none';
    pendingAttachments = [];
    renderPendingAttachments();
    updateSendButtonState();
    chatInput.focus();
}

document.getElementById('btn-send').onclick = submitPrompt;

statusMode.onclick = () => {
    sendToPython({ action: "cycle_mode" });
};

// --- SCHEDULES MODAL ENGINE ---
let currentlyEditingTaskId = null;
let lastLoadedSchedules = [];

function resetScheduleForm() {
    currentlyEditingTaskId = null;
    const timeEl = document.getElementById('sched-time-input');
    const dateEl = document.getElementById('sched-date-input');
    const promptEl = document.getElementById('sched-prompt-input');
    const btnEl = document.getElementById('btn-create-schedule');
    if (timeEl) timeEl.value = '';
    if (dateEl) dateEl.value = '';
    if (promptEl) promptEl.value = '';
    if (btnEl) btnEl.innerText = '+ Add Task Routine';
}

function renderSchedulesList(tasks) {
    lastLoadedSchedules = tasks || [];
    const listEl = document.getElementById('sched-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const visibleTasks = lastLoadedSchedules.filter(t => t.id !== currentlyEditingTaskId);

    if (!visibleTasks || visibleTasks.length === 0) {
        listEl.innerHTML = '<div style="color: var(--text-dim); font-size: 0.8rem; padding: 6px 0;">' +
            (currentlyEditingTaskId ? 'Editing staged task above...' : 'No active scheduled routines.') +
            '</div>';
        return;
    }

    visibleTasks.forEach(t => {
        const row = document.createElement('div');
        row.style.cssText = 'background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px; cursor: pointer; transition: all 0.2s ease;';

        const info = document.createElement('div');
        info.style.cssText = 'flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: 2px;';

        const headerLine = document.createElement('div');
        headerLine.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 0.78rem; font-weight: 700; font-family: var(--font-mono);';
        const agentCol = getAgentColor(t.agent_name);
        const repeatCap = (t.repeat || 'daily').charAt(0).toUpperCase() + (t.repeat || 'daily').slice(1);
        headerLine.innerHTML = '<span style="color:' + agentCol + ';">@' + window.electronAPI.escapeHtml(t.agent_name) + '</span>' +
            '<span style="color: var(--brand-yellow);">⏰ ' + window.electronAPI.escapeHtml(t.time_str) + '</span>' +
            '<span style="color: var(--text-dim); font-size: 0.72rem;">[' + repeatCap + (t.date_str ? ' • ' + window.electronAPI.escapeHtml(t.date_str) : '') + ']</span>' +
            '<span style="font-size: 0.7rem; color: var(--brand-teal); margin-left: auto;">✏️ Edit</span>';

        const promptLine = document.createElement('div');
        promptLine.style.cssText = 'color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
        promptLine.innerText = t.prompt;

        info.appendChild(headerLine);
        info.appendChild(promptLine);

        row.onclick = (e) => {
            if (e.target.closest('.sched-del-btn')) return;
            currentlyEditingTaskId = t.id;

            const agentSelect = document.getElementById('sched-agent-select');
            const timeInput = document.getElementById('sched-time-input');
            const dateInput = document.getElementById('sched-date-input');
            const repeatSelect = document.getElementById('sched-repeat-select');
            const promptInput = document.getElementById('sched-prompt-input');
            const btn = document.getElementById('btn-create-schedule');

            if (agentSelect) agentSelect.value = t.agent_name;
            if (timeInput) timeInput.value = t.time_str || '';
            if (dateInput) dateInput.value = t.date_str || '';
            if (repeatSelect) repeatSelect.value = t.repeat || 'daily';
            if (promptInput) promptInput.value = t.prompt || '';
            if (btn) btn.innerText = '✓ Save Changes to Task';

            renderSchedulesList(lastLoadedSchedules);
            if (promptInput) promptInput.focus();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'modal-btn btn-secondary sched-del-btn';
        delBtn.style.cssText = 'padding: 3px 6px; font-size: 0.72rem; color: var(--brand-red); flex-shrink: 0;';
        delBtn.innerText = '🗑️';
        delBtn.title = 'Delete schedule';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (currentlyEditingTaskId === t.id) resetScheduleForm();
            sendToPython({ action: "delete_schedule", id: t.id });
        };

        row.appendChild(info);
        row.appendChild(delBtn);
        listEl.appendChild(row);
    });
}

function openSchedulesModal() {
    resetScheduleForm();
    const select = document.getElementById('sched-agent-select');
    select.innerHTML = '';
    cachedAgents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.innerText = a.name;
        select.appendChild(opt);
    });
    sendToPython({ action: "get_schedules" });
    document.getElementById('schedule-modal').style.display = 'flex';
}

document.getElementById('btn-create-schedule').onclick = () => {
    const agent = document.getElementById('sched-agent-select').value;
    const time_str = document.getElementById('sched-time-input').value.trim();
    const date_str = document.getElementById('sched-date-input').value.trim();
    const repeat = document.getElementById('sched-repeat-select').value;
    const prompt_text = document.getElementById('sched-prompt-input').value.trim();

    if (!time_str || !prompt_text) {
        alert("Please provide both a scheduled time and a task prompt.");
        return;
    }

    if (currentlyEditingTaskId) {
        sendToPython({ action: "delete_schedule", id: currentlyEditingTaskId });
    }

    const scheduleCommand = '/schedule ' + agent + ' ' + time_str + (date_str ? ' ' + date_str : '') + ' ' + repeat + ' ' + prompt_text;
    sendToPython({ action: "input", text: scheduleCommand });

    resetScheduleForm();
    setTimeout(() => {
        sendToPython({ action: "get_schedules" });
    }, 200);
};

// --- GLOBAL KEYBOARD SHORTCUTS ---
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        sendToPython({ action: "abort" });
    } else if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        sendToPython({ action: "clear_all" });
    } else if (e.ctrlKey && e.key.toLowerCase() === 't') {
        sendToPython({ action: "cycle_mode" });
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openFindReplaceModal();
    } else if (e.key === 'F2') {
        e.preventDefault();
        toggleDrawer(true);
    } else if (e.key === 'F3') {
        e.preventDefault();
        openGlobalSettings();
    } else if (e.key === 'F4') {
        e.preventDefault();
        openAgentConfig();
    } else if (e.key === 'F8') {
        e.preventDefault();
        openWorkspaceModal("");
    } else if (e.key === 'Escape') {
        closeModals();
        toggleDrawer(false);
    }
});

// Color Picker Sync
function syncColorPicker(pickerId, textId, defaultColor = "#3ddbd9") {
    const picker = document.getElementById(pickerId);
    const text = document.getElementById(textId);
    if (!picker || !text) return;

    if (!picker._hasSyncListener) {
        picker.addEventListener('input', () => { text.value = picker.value; });
        text.addEventListener('input', () => {
            let val = text.value.trim();
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) picker.value = val;
        });
        picker._hasSyncListener = true;
    }

    let currentVal = text.value.trim() || defaultColor;
    if (/^#[0-9A-Fa-f]{6}$/.test(currentVal)) {
        picker.value = currentVal;
    }
}

function openGlobalSettings() {
    sendToPython({ action: "get_global_settings" });
    syncColorPicker('cfg-user-color-picker', 'cfg-user-color', cachedUserColor);
    document.getElementById('global-settings-modal').style.display = 'flex';
}

let isConfigAddMode = false;

function openAgentConfig(targetName, isAddMode = false) {
    isConfigAddMode = isAddMode;
    sendToPython({ action: "get_agent_data", name: targetName || activeAgentName });
    syncColorPicker('cfg-agent-color-picker', 'cfg-agent-color', '#3ddbd9');
    document.getElementById('agent-config-modal').style.display = 'flex';
}

function updateAuthButtonVisibility(presetValue) {
    const authBtn = document.getElementById('btn-chatgpt-auth');
    const apiKeyInput = document.getElementById('cfg-agent-api-key');
    const apiKeyLabel = document.getElementById('cfg-agent-api-key-label');
    const statusEl = document.getElementById('chatgpt-auth-status');
    if (presetValue === "https://chatgpt.com/backend-api/codex") {
        authBtn.style.display = "block";
        apiKeyInput.style.display = "none";
        apiKeyLabel.style.display = "none";
        if (statusEl) statusEl.style.display = "block";
    } else {
        authBtn.style.display = "none";
        apiKeyInput.style.display = "block";
        apiKeyLabel.style.display = "block";
        if (statusEl) {
            statusEl.style.display = "none";
            statusEl.innerHTML = '';
        }
    }
}

document.getElementById('cfg-agent-base-preset').addEventListener('change', (e) => {
    if (e.target.value !== 'custom') {
        document.getElementById('cfg-agent-base-url').value = e.target.value;
    }
    updateAuthButtonVisibility(e.target.value);
});

document.getElementById('btn-chatgpt-auth').onclick = () => {
    const authBtn = document.getElementById('btn-chatgpt-auth');
    const statusEl = document.getElementById('chatgpt-auth-status');
    authBtn.disabled = true;
    authBtn.innerText = '⏳ Waiting for browser sign-in...';
    if (statusEl) statusEl.innerHTML = '<span style="color: var(--brand-teal);">Please complete sign-in in your browser...</span>';
    sendToPython({ action: "start_chatgpt_oauth" });
};

// Agent Configuration Modal
function populateAgentModal(agent, allTools, allAgentNames) {
    document.getElementById('cfg-agent-name').value = isConfigAddMode ? "" : (agent.name || "");
    document.getElementById('cfg-agent-color').value = agent.color || "#3ddbd9";
    syncColorPicker('cfg-agent-color-picker', 'cfg-agent-color', agent.color || "#3ddbd9");
    document.getElementById('cfg-agent-backstory').value = isConfigAddMode ? "" : (agent.backstory || "");

    const saveBtn = document.getElementById('btn-save-agent');
    const deleteBtn = document.getElementById('btn-delete-agent');
    if (saveBtn) saveBtn.style.display = isConfigAddMode ? 'none' : 'inline-block';
    if (deleteBtn) deleteBtn.style.display = isConfigAddMode ? 'none' : 'inline-block';

    if (isConfigAddMode) {
        setTimeout(() => document.getElementById('cfg-agent-name')?.focus(), 100);
    }
    document.getElementById('cfg-agent-model').value = agent.model || "";
    document.getElementById('cfg-agent-reasoning').value = agent.reasoning_effort || "none";
    document.getElementById('cfg-agent-temp').value = agent.temperature !== undefined ? agent.temperature : 1.0;

    const bUrl = agent.base_url || "https://openrouter.ai/api/v1";
    document.getElementById('cfg-agent-base-url').value = bUrl;

    const presetSelect = document.getElementById('cfg-agent-base-preset');
    let matched = "custom";
    for (let opt of presetSelect.options) {
        if (opt.value === bUrl) {
            matched = bUrl;
            break;
        }
    }
    presetSelect.value = matched;
    updateAuthButtonVisibility(matched);

    document.getElementById('cfg-agent-api-key').value = agent.api_key || "";
    document.getElementById('cfg-agent-voice').value = agent.tts_voice || "af_sarah";
    document.getElementById('cfg-agent-pronouns').value = agent.pronouns || "she/her";

    document.getElementById('cfg-agent-vision').checked = !!agent.is_capable_vision;
    document.getElementById('cfg-agent-disable-all').checked = !!agent.disable_all_tools;

    document.getElementById('cfg-agent-use-backup').checked = !!agent.use_backup;
    document.getElementById('cfg-agent-backup-model').value = agent.backup_model || "";
    document.getElementById('cfg-agent-backup-base').value = agent.backup_base_url || "";
    document.getElementById('cfg-agent-backup-key').value = agent.backup_api_key || "";

    const copySelect = document.getElementById('cfg-copy-from-agent');
    copySelect.innerHTML = '<option value="">Manual Entry</option>';
    (allAgentNames || []).forEach(name => {
        if (name !== agent.name) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.innerText = name;
            copySelect.appendChild(opt);
        }
    });

    copySelect.onchange = (e) => {
        if (!e.target.value) return;
        const target = cachedAgents.find(a => a.name === e.target.value);
        if (target) {
            document.getElementById('cfg-agent-backup-model').value = target.model || "";
            document.getElementById('cfg-agent-backup-base').value = target.base_url || "";
        }
    };

    const tbody = document.getElementById('abilities-table-body');
    tbody.innerHTML = '';
    const enabled = agent.enabled_tools || [];
    const disabled = agent.disabled_tools || [];

    (allTools || []).forEach(t => {
        const row = document.createElement('tr');
        const isEn = enabled.includes(t);
        const isDis = disabled.includes(t);
        const escapedTool = window.electronAPI.escapeHtml(t);
        row.innerHTML = `
            <td>${escapedTool}</td>
            <td><input type="checkbox" class="tool-enable-cb" data-tool="${escapedTool}" ${isEn ? 'checked' : ''}></td>
            <td><input type="checkbox" class="tool-disable-cb" data-tool="${escapedTool}" ${isDis ? 'checked' : ''}></td>
        `;
        tbody.appendChild(row);
    });
}

document.getElementById('btn-save-agent').onclick = () => saveAgent(false);
document.getElementById('btn-save-as-new').onclick = () => saveAgent(true);
document.getElementById('btn-delete-agent').onclick = () => {
    const name = document.getElementById('cfg-agent-name').value;
    sendToPython({ action: "delete_agent", name });
    closeModals();
};

function saveAgent(isNew) {
    const enabled = [];
    document.querySelectorAll('.tool-enable-cb:checked').forEach(cb => enabled.push(cb.dataset.tool));
    const disabled = [];
    document.querySelectorAll('.tool-disable-cb:checked').forEach(cb => disabled.push(cb.dataset.tool));

    const name = document.getElementById('cfg-agent-name').value.trim();
    const statusEl = document.getElementById('cfg-agent-status-msg');
    if (!name) {
        if (statusEl) statusEl.innerHTML = '<span style="color: var(--brand-red);">Agent name cannot be empty.</span>';
        return;
    }

    const saveBtn = document.getElementById('btn-save-agent');
    const saveNewBtn = document.getElementById('btn-save-as-new');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerText = 'Verifying...'; }
    if (saveNewBtn) { saveNewBtn.disabled = true; }
    if (statusEl) statusEl.innerHTML = '<span style="color: var(--brand-yellow);">⏳ Verifying model & translating backstory...</span>';

    const fields = {
        name: name,
        color: document.getElementById('cfg-agent-color').value.trim(),
        backstory: document.getElementById('cfg-agent-backstory').value.trim(),
        model: document.getElementById('cfg-agent-model').value.trim(),
        reasoning_effort: document.getElementById('cfg-agent-reasoning').value,
        temperature: parseFloat(document.getElementById('cfg-agent-temp').value) || 1.0,
        base_url: document.getElementById('cfg-agent-base-url').value.trim(),
        api_key: document.getElementById('cfg-agent-api-key').value.trim(),
        tts_voice: document.getElementById('cfg-agent-voice').value,
        pronouns: document.getElementById('cfg-agent-pronouns').value,
        is_capable_vision: document.getElementById('cfg-agent-vision').checked,
        disable_all_tools: document.getElementById('cfg-agent-disable-all').checked,
        use_backup: document.getElementById('cfg-agent-use-backup').checked,
        backup_model: document.getElementById('cfg-agent-backup-model').value.trim(),
        backup_base_url: document.getElementById('cfg-agent-backup-base').value.trim(),
        backup_api_key: document.getElementById('cfg-agent-backup-key').value.trim(),
        enabled_tools: enabled,
        disabled_tools: disabled
    };

    sendToPython({ action: "save_agent_data", fields, is_new: isNew, old_name: name });
}

// Global Settings Modal
function populateGlobalSettingsModal(data) {
    document.getElementById('cfg-user-name').value = data.user_name || "User";
    document.getElementById('cfg-user-color').value = data.user_color || "#dda0dd";
    syncColorPicker('cfg-user-color-picker', 'cfg-user-color', data.user_color || "#dda0dd");
    document.getElementById('cfg-search-delay').value = data.search_pacing_delay !== undefined ? data.search_pacing_delay : 65.0;
    document.getElementById('cfg-max-search-results').value = data.max_search_results || 10;
    document.getElementById('cfg-scraper-max-bytes').value = data.scraper_max_bytes || 1000000;
    document.getElementById('cfg-scraper-timeout').value = data.scraper_timeout || 120.0;
    document.getElementById('cfg-scraper-max-tokens').value = data.scraper_max_tokens || 30000;
    document.getElementById('cfg-autoupdate-on-launch').checked = !!data.autoupdate_on_launch;
    document.getElementById('cfg-max-api-retries').value = data.max_api_retries || 20;
    document.getElementById('cfg-api-retry-delay').value = data.api_retry_delay || 15.0;
    document.getElementById('cfg-quota-retry-delay').value = data.quota_retry_delay || 120.0;
    document.getElementById('cfg-max-research-agents').value = data.max_research_agents || 4;
    document.getElementById('cfg-research-context-tokens').value = data.research_context_tokens || 28000;
    document.getElementById('cfg-research-min-length').value = data.research_min_length || 5000;
    document.getElementById('cfg-max-shrink-attempts').value = data.max_shrink_attempts || 15;
    document.getElementById('cfg-pdf-dpi').value = data.pdf_dpi || 150;
    document.getElementById('cfg-pdf-footer-text').value = data.pdf_footer_text || "FEDERATE RESEARCH REPORT";
    document.getElementById('cfg-research-image-enabled').checked = !!data.research_image_system_enabled;
    document.getElementById('cfg-research-images-max').value = data.research_images_max || 10;
    document.getElementById('cfg-research-image-retries').value = data.research_image_retries || 1;
    document.getElementById('cfg-research-images-links').checked = !data.research_images_as_links;
    document.getElementById('cfg-tool-vis').value = data.tool_result_visibility || "private";
    document.getElementById('cfg-keep-verbatim-count').value = data.keep_verbatim_count !== undefined ? data.keep_verbatim_count : 2;
}

document.getElementById('btn-save-global').onclick = () => {
    const settings = {
        user_name: document.getElementById('cfg-user-name').value.trim(),
        user_color: document.getElementById('cfg-user-color').value.trim(),
        search_pacing_delay: parseFloat(document.getElementById('cfg-search-delay').value) || 65.0,
        max_search_results: parseInt(document.getElementById('cfg-max-search-results').value) || 10,
        scraper_max_bytes: parseInt(document.getElementById('cfg-scraper-max-bytes').value) || 1000000,
        scraper_timeout: parseFloat(document.getElementById('cfg-scraper-timeout').value) || 120.0,
        scraper_max_tokens: parseInt(document.getElementById('cfg-scraper-max-tokens').value) || 30000,
        autoupdate_on_launch: document.getElementById('cfg-autoupdate-on-launch').checked,
        max_api_retries: parseInt(document.getElementById('cfg-max-api-retries').value) || 20,
        api_retry_delay: parseFloat(document.getElementById('cfg-api-retry-delay').value) || 15.0,
        quota_retry_delay: parseFloat(document.getElementById('cfg-quota-retry-delay').value) || 120.0,
        max_research_agents: parseInt(document.getElementById('cfg-max-research-agents').value) || 4,
        research_context_tokens: parseInt(document.getElementById('cfg-research-context-tokens').value) || 28000,
        research_min_length: parseInt(document.getElementById('cfg-research-min-length').value) || 5000,
        max_shrink_attempts: parseInt(document.getElementById('cfg-max-shrink-attempts').value) || 15,
        pdf_dpi: parseInt(document.getElementById('cfg-pdf-dpi').value) || 150,
        pdf_footer_text: document.getElementById('cfg-pdf-footer-text').value.trim(),
        research_image_system_enabled: document.getElementById('cfg-research-image-enabled').checked,
        research_images_max: parseInt(document.getElementById('cfg-research-images-max').value) || 10,
        research_image_retries: parseInt(document.getElementById('cfg-research-image-retries').value) || 1,
        research_images_as_links: !document.getElementById('cfg-research-images-links').checked,
        tool_result_visibility: document.getElementById('cfg-tool-vis').value,
        keep_verbatim_count: parseInt(document.getElementById('cfg-keep-verbatim-count').value) || 2
    };
    sendToPython({ action: "save_global_settings", settings });
    closeModals();
};

function showToolModal(msg) {
    currentCallId = msg.call_id;
    const titleEl = document.getElementById('modal-tool-title');
    const descEl = document.getElementById('modal-tool-desc');
    const argsEl = document.getElementById('modal-tool-args');
    const clarifyBox = document.getElementById('clarify-input-box');
    const clarifyInput = document.getElementById('clarify-user-input');
    const optionsBox = document.getElementById('clarify-options-container');
    const approveBtn = document.getElementById('btn-approve');

    optionsBox.innerHTML = '';

    if (msg.tool_name === "get_user_clarification") {
        titleEl.style.color = 'var(--brand-teal)';
        titleEl.innerText = 'Clarification Required: ' + msg.agent_name;
        descEl.innerText = 'Select an option or provide a custom response for ' + msg.agent_name + ':';
        argsEl.style.display = 'none';

        const options = (msg.arguments && msg.arguments.options) ? msg.arguments.options : [];
        if (options.length > 0) {
            optionsBox.style.display = 'flex';
            options.forEach(function(opt) {
                const pill = document.createElement('div');
                pill.style.cssText = 'background: var(--bg-card); border: 1px solid var(--brand-teal); border-radius: 8px; padding: 9px 12px; font-size: 0.84rem; color: var(--text-main); cursor: pointer; font-weight: 500; transition: all 0.2s ease;';
                pill.innerHTML = '<span> ' + window.electronAPI.escapeHtml(opt) + '</span>';
                pill.onclick = function() {
                    document.getElementById('tool-modal').style.display = 'none';
                    sendToPython({
                        action: "tool_response",
                        call_id: currentCallId,
                        approved: true,
                        response: opt
                    });
                };
                optionsBox.appendChild(pill);
            });
        } else {
            optionsBox.style.display = 'none';
        }

        clarifyBox.style.display = 'block';
        clarifyInput.value = '';
        approveBtn.innerText = 'Submit Response';
        setTimeout(function() { clarifyInput.focus(); }, 120);
    } else {
        titleEl.style.color = 'var(--brand-yellow)';
        titleEl.innerText = 'Tool Authorization: ' + msg.tool_name + ' (' + msg.agent_name + ')';
        descEl.innerText = msg.diff ? 'Review proposed file modifications (diff):' : 'The agent has requested execution of the following action:';
        argsEl.style.display = 'block';
        if (msg.diff) {
            argsEl.style.whiteSpace = 'pre';
            argsEl.style.wordBreak = 'normal';
            argsEl.innerHTML = msg.diff.split('\n').map(line => {
                const esc = window.electronAPI.escapeHtml(line);
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    return `<span style="color: #8cc84b;">${esc}</span>`;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    return `<span style="color: #da6057;">${esc}</span>`;
                } else if (line.startsWith('@@')) {
                    return `<span style="color: #3ddbd9; font-weight: bold;">${esc}</span>`;
                } else if (line.startsWith('---') || line.startsWith('+++')) {
                    return `<span style="color: var(--text-muted); font-weight: bold;">${esc}</span>`;
                }
                return `<span>${esc}</span>`;
            }).join('\n');
            argsEl.scrollLeft = 0;
            argsEl.scrollTop = 0;
        } else {
            argsEl.style.whiteSpace = 'pre-wrap';
            argsEl.innerText = JSON.stringify(msg.arguments, null, 2);
        }
        optionsBox.style.display = 'none';
        clarifyBox.style.display = 'none';
        approveBtn.innerText = 'Approve';
    }

    document.getElementById('tool-modal').style.display = 'flex';
}

document.getElementById('btn-approve').onclick = function() {
    document.getElementById('tool-modal').style.display = 'none';
    const clarifyVal = document.getElementById('clarify-user-input').value.trim();
    sendToPython({ 
        action: "tool_response", 
        call_id: currentCallId, 
        approved: true,
        response: clarifyVal || true
    });
};

document.getElementById('btn-reject').onclick = function() {
    document.getElementById('tool-modal').style.display = 'none';
    sendToPython({ action: "tool_response", call_id: currentCallId, approved: false, response: false });
};

document.getElementById('btn-modal-abort').onclick = function() {
    document.getElementById('tool-modal').style.display = 'none';
    sendToPython({ action: "tool_response", call_id: currentCallId, approved: false, response: false });
    sendToPython({ action: "abort" });
    workingAgentsMap.clear();
    workingIndicator.style.display = "none";
    stopReactorAnimation();
    appendLog("[bold red]Operation Aborted by User.[/bold red]", false);
};

// Keyring Unlock Handlers
document.getElementById('btn-keyring-unlock').onclick = () => {
    const pwd = document.getElementById('keyring-password-input').value;
    sendToPython({ action: "keyring_unlock", password: pwd });
};

document.getElementById('btn-keyring-reset').onclick = () => {
    const pwd = document.getElementById('keyring-password-input').value;
    if (!pwd) {
        document.getElementById('keyring-error-msg').innerText = "Please enter a password to reset.";
        return;
    }
    sendToPython({ action: "keyring_reset", password: pwd });
};

document.getElementById('keyring-password-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-keyring-unlock').click();
});

// --- FIND & REPLACE CONTROLLER ---
function openFindReplaceModal() {
    document.getElementById('find-replace-modal').style.display = 'flex';
    document.getElementById('fr-find-input').focus();
}

let activeMatchIdx = -1;
function performSearch(direction = 1) {
    const searchTerm = document.getElementById('fr-find-input').value;
    const matchCase = document.getElementById('fr-case-cb').checked;
    const statusEl = document.getElementById('fr-status-msg');

    if (!searchTerm) {
        statusEl.innerText = "Please enter search text.";
        return;
    }

    document.querySelectorAll('mark.fr-highlight').forEach(el => {
        el.outerHTML = el.innerHTML;
    });

    const contentEl = document.getElementById('chat-container');
    const treeWalker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (treeWalker.nextNode()) textNodes.push(treeWalker.currentNode);

    let matches = [];
    textNodes.forEach(node => {
        const text = matchCase ? node.nodeValue : node.nodeValue.toLowerCase();
        const query = matchCase ? searchTerm : searchTerm.toLowerCase();
        let pos = text.indexOf(query);
        while (pos !== -1) {
            matches.push({ node, pos, len: query.length });
            pos = text.indexOf(query, pos + query.length);
        }
    });

    if (matches.length === 0) {
        statusEl.innerText = "String not found.";
        return;
    }

    statusEl.innerText = 'Found ' + matches.length + ' matches.';

    matches.forEach(m => {
        const range = document.createRange();
        range.setStart(m.node, m.pos);
        range.setEnd(m.node, m.pos + m.len);
        const mark = document.createElement('mark');
        mark.className = 'fr-highlight';
        mark.style.backgroundColor = '#f2a813';
        mark.style.color = '#000';
        mark.style.borderRadius = '2px';
        range.surroundContents(mark);
    });

    const allMarks = document.querySelectorAll('mark.fr-highlight');
    if (allMarks.length > 0) {
        activeMatchIdx = (activeMatchIdx + direction + allMarks.length) % allMarks.length;
        allMarks.forEach((m, idx) => {
            m.style.backgroundColor = (idx === activeMatchIdx) ? '#3ddbd9' : '#f2a813';
        });
        allMarks[activeMatchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

document.getElementById('fr-btn-next').onclick = () => performSearch(1);
document.getElementById('fr-btn-prev').onclick = () => performSearch(-1);

document.getElementById('fr-btn-replace').onclick = () => {
    const allMarks = document.querySelectorAll('mark.fr-highlight');
    const replaceText = document.getElementById('fr-replace-input').value;
    if (activeMatchIdx >= 0 && activeMatchIdx < allMarks.length) {
        allMarks[activeMatchIdx].outerHTML = replaceText;
        performSearch(0);
    }
};

document.getElementById('fr-btn-all').onclick = () => {
    const allMarks = document.querySelectorAll('mark.fr-highlight');
    const replaceText = document.getElementById('fr-replace-input').value;
    const count = allMarks.length;
    allMarks.forEach(mark => {
        mark.outerHTML = replaceText;
    });
    document.getElementById('fr-status-msg').innerText = 'Replaced ' + count + ' occurrences.';
};

// Initial bootstrap trigger
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        sendToPython({ action: "get_status" });
        sendToPython({ action: "get_global_settings" });
        sendToPython({ action: "get_agent_data" });
        sendToPython({ action: "get_sessions" });
    }, 100);
});