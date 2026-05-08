/**
 * Nearsec Arcade Shared Logic
 * Handles session fetching, latency pings, and grid rendering.
 */

const API_URL = 'https://nearsec.cutefame.net/api/arcade/sessions';
const POLL_INTERVAL = 6000;

let sessions = [];
let filteredSessions = [];
let activeSession = null;
let latencyMap = {};

// --- Polling & Data Fetching ---
async function fetchSessions() {
    try {
        const res = await fetch(API_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        sessions = await res.json();
        updateLiveDot(true);
    } catch (e) {
        console.warn('[Arcade] Fetch error:', e.message);
        updateLiveDot(false);
    }
    filterCards();
}

function updateLiveDot(ok) {
    const dot = document.getElementById('liveDot');
    if (!dot) return;
    if (ok) {
        dot.style.background = 'var(--green)';
        dot.style.boxShadow = '0 0 8px var(--green)';
    } else {
        dot.style.background = 'var(--red)';
        dot.style.boxShadow = 'none';
    }
}

// --- Latency Logic ---
async function pingSession(session) {
    if (latencyMap[session.id]) return;
    try {
        const t0 = performance.now();
        await fetch(session.url + '/ping', { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
        const ms = Math.round(performance.now() - t0);
        let color = ms < 60 ? 'green' : ms < 120 ? 'yellow' : 'red';
        latencyMap[session.id] = { ms, color };
    } catch {
        latencyMap[session.id] = { ms: null, color: 'pending' };
    }
    const tag = document.getElementById('lat-' + session.id);
    if (tag) updateLatencyTag(tag, session.id);
}

function updateLatencyTag(el, id) {
    const l = latencyMap[id];
    if (!l) return;
    el.className = 'latency-tag ' + (l.color || 'pending');
    el.textContent = l.ms !== null ? l.ms + 'ms' : '?';
}

// --- Rendering ---
function filterCards() {
    const searchInput = document.getElementById('searchInput');
    const q = (searchInput ? searchInput.value : '').toLowerCase();
    filteredSessions = sessions.filter(s =>
    !q || s.game.toLowerCase().includes(q) || (s.region || '').toLowerCase().includes(q)
    );
    renderGrid();
}

function renderGrid() {
    const grid = document.getElementById('clientGrid');
    const empty = document.getElementById('emptyState');
    const countEl = document.getElementById('liveCount');

    if (countEl) {
        countEl.textContent = sessions.length === 0 ? 'No sessions' :
        sessions.length === 1 ? '1 session live' :
        sessions.length + ' sessions live';
    }

    if (filteredSessions.length === 0) {
        [...grid.children].forEach(c => { if (c !== empty) c.remove(); });
        if (empty) empty.style.display = 'flex';
        return;
    }
    if (empty) empty.style.display = 'none';

    const existing = {};
    [...grid.children].forEach(c => { if (c.dataset.id) existing[c.dataset.id] = c; });

    filteredSessions.forEach((s, i) => {
        if (existing[s.id]) {
            updateLatencyTag(document.getElementById('lat-' + s.id), s.id);
            delete existing[s.id];
        } else {
            const card = buildCard(s, i);
            grid.appendChild(card);
            pingSession(s);
        }
    });
    Object.values(existing).forEach(c => c.remove());
}

function buildCard(s, index) {
    const card = document.createElement('div');
    card.className = 'client-card';
    card.dataset.id = s.id;
    card.style.animationDelay = Math.min(index * 40, 200) + 'ms';
    card.onclick = () => openJoin(s);

    const latency = latencyMap[s.id];
    const latClass = latency ? latency.color : 'pending';
    const latLabel = latency ? (latency.ms !== null ? latency.ms + 'ms' : '?') : '…';

    const thumbHtml = s.thumbnail
    ? `<div class="thumb" style="background-image:url(${JSON.stringify(s.thumbnail)})">
    <div class="latency-tag ${latClass}" id="lat-${s.id}">${latLabel}</div>
    </div>`
    : `<div class="thumb no-img">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    <div class="latency-tag ${latClass}" id="lat-${s.id}">${latLabel}</div>
    </div>`;

    card.innerHTML = thumbHtml + `
    <div class="card-body">
    <div class="card-title">${escHtml(s.game)}</div>
    <div class="card-info">
    ${s.region ? `<span class="tag">${escHtml(s.region)}</span>` : ''}
    <span class="tag">${s.hasPin ? 'PIN Required' : 'Public'}</span>
    </div>
    </div>`;
    return card;
}

function escHtml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// --- Modal & Navigation ---
function openJoin(session) {
    activeSession = session;
    const mThumb = document.getElementById('mThumb');
    if (session.thumbnail) {
        mThumb.style.backgroundImage = `url(${JSON.stringify(session.thumbnail)})`;
        mThumb.classList.remove('no-img');
    } else {
        mThumb.style.backgroundImage = '';
        mThumb.classList.add('no-img');
    }

    document.getElementById('mTitle').textContent = session.game;
    const meta = document.getElementById('mMeta');
    meta.innerHTML = '';

    // Add tags to modal...
    [session.region, (latencyMap[session.id]?.ms ? latencyMap[session.id].ms + 'ms' : null), (session.hasPin ? '🔒 PIN Required' : '🌐 Open')]
    .filter(val => val)
    .forEach(text => {
        const t = document.createElement('div');
        t.className = 'modal-tag'; t.textContent = text;
        meta.appendChild(t);
    });

    document.getElementById('pinSection').classList.toggle('show', !!session.hasPin);
    document.getElementById('joinModal').classList.add('open');
}

function closeJoin() {
    document.getElementById('joinModal').classList.remove('open');
    activeSession = null;
}

async function joinSession() {
    if (!activeSession || !activeSession.url) return;
    let joinUrl = activeSession.url;
    if (activeSession.hasPin) {
        const pin = document.getElementById('pinInput').value.trim();
        if (!pin) {
            document.getElementById('pinInput').style.borderColor = 'var(--red)';
            setTimeout(() => document.getElementById('pinInput').style.borderColor = '', 800);
            return;
        }
        joinUrl += (joinUrl.includes('?') ? '&' : '?') + 'pin=' + encodeURIComponent(pin);
    }
    closeJoin();
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (_) {}
    location.href = joinUrl;
}

// Initialize
fetchSessions();
setInterval(fetchSessions, POLL_INTERVAL);
