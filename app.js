/**
 * app.js - Harmonia Music Player
 */

const GOOGLE_CLIENT_ID = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
const SYNC_FOLDER_NAME = 'WebMusicPlayer_Sync';
const DB_NAME = 'MusicPlayerDB';
const DB_VERSION = 4;
let db = null;

const audioPlayer = new Audio();
let currentObjectUrl = null;
let tokenClient = null;
let gapiAccessToken = null;
let playbackStartTime = 0;
let logChartInstance = null;
let logPieChartInstance = null;

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
let currentSpeedIndex = 2;

const appState = {
    tracks: [],
    playlists: [],
    currentQueue: [],
    currentTrackIndex: -1,
    isPlaying: false,
    allKnownTags: new Map(),
    currentPlaylistId: null,
    searchQueryMain: '',
    sortModeMain: 'manual',
    selectedMainTracks: new Set(),
    searchQueryEdit: '',
    isLoggedIn: false,
    user: null,
    isSyncing: false,
    isStreaming: false,
    loopMode: 'none',
    isShuffled: false,
    isQueueOpen: false,
    currentLogCategory: 'total',
    currentLogPeriod: 'all',
};

document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initAuthUI();
    initDragAndDrop();
    initPlayerControls();
    initPlaylists();
    initSearchAndSort();
    initBulkActions();
    initEditPage();
    initPlaylistPlaybackControls();
    initSettings();
    initLogControls();
    initKeyboardShortcuts();
    initQueuePanel();
    initFullscreenPlayer();
    initMiniPlayer();

    try {
        await initDB();
        await loadLibrary();
        await loadPlaylists();
    } catch (error) {
        console.error('DB初期化エラー:', error);
    }

    window.addEventListener('beforeunload', stopPlaybackTracking);
});

// ─────────────────────────────────────────────
// トースト通知
// ─────────────────────────────────────────────
function showToast(message, type = '', duration = 2800) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.25s forwards';
        setTimeout(() => toast.remove(), 260);
    }, duration);
}

// ─────────────────────────────────────────────
// ナビゲーション
// ─────────────────────────────────────────────
function initNavigation() {
    function switchPage(targetId) {
        document.querySelectorAll('.sidenav-btn').forEach(b =>
            b.classList.toggle('active', b.getAttribute('data-target') === targetId));
        document.querySelectorAll('.page-section').forEach(p =>
            p.classList.toggle('active', p.id === targetId));
        document.querySelectorAll('.bottom-nav-btn').forEach(b =>
            b.classList.toggle('active', b.getAttribute('data-target') === targetId));

        appState.selectedMainTracks.clear();
        updateBulkActionBar();

        if (targetId === 'edit') renderEditLibraryList();
        if (targetId === 'log') updateLogPage();
    }

    document.querySelectorAll('.sidenav-btn, .bottom-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchPage(btn.getAttribute('data-target')));
    });

    const libraryAllBtn = document.getElementById('library-all-btn');
    if (libraryAllBtn) {
        libraryAllBtn.addEventListener('click', () => {
            appState.currentPlaylistId = null;
            document.getElementById('current-playlist-name').textContent = 'すべての曲';
            appState.selectedMainTracks.clear();
            updateMainQueue();
            document.querySelectorAll('.playlist-tab').forEach(el => el.classList.remove('active'));
            libraryAllBtn.classList.add('active');
        });
    }
}

// ─────────────────────────────────────────────
// 設定
// ─────────────────────────────────────────────
function initSettings() {
    const isStreamingSaved = localStorage.getItem('isStreaming');
    if (isStreamingSaved !== null) appState.isStreaming = isStreamingSaved === 'true';
    const checkbox = document.getElementById('setting-streaming');
    if (checkbox) {
        checkbox.checked = appState.isStreaming;
        checkbox.addEventListener('change', (e) => {
            appState.isStreaming = e.target.checked;
            localStorage.setItem('isStreaming', appState.isStreaming);
            if (!appState.isStreaming && appState.isLoggedIn) autoSync();
        });
    }

    const clearLogsBtn = document.getElementById('clear-logs-btn');
    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', async () => {
            if (!confirm('すべての再生ログをリセットしますか？この操作は元に戻せません。')) return;
            await clearAllLogs();
            showToast('再生ログをリセットしました');
        });
    }
}

function clearAllLogs() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['logs'], 'readwrite');
        const req = tx.objectStore('logs').clear();
        req.onsuccess = () => resolve();
        req.onerror = e => reject(e.target.error);
    });
}

// ─────────────────────────────────────────────
// キーボードショートカット
// ─────────────────────────────────────────────
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        switch (e.code) {
            case 'Space': e.preventDefault(); togglePlay(); break;
            case 'ArrowRight': e.preventDefault(); playNext(); break;
            case 'ArrowLeft': e.preventDefault(); playPrev(); break;
            case 'ArrowUp': e.preventDefault(); adjustVolume(5); break;
            case 'ArrowDown': e.preventDefault(); adjustVolume(-5); break;
            case 'KeyL': cycleLoopMode(); break;
            case 'KeyS': toggleShuffle(); break;
        }
    });
}

function adjustVolume(delta) {
    const bar = document.getElementById('volume-bar');
    if (!bar) return;
    let val = Math.min(100, Math.max(0, parseInt(bar.value) + delta));
    bar.value = val;
    const fpBar = document.getElementById('fp-volume-bar');
    if (fpBar) fpBar.value = val;
    audioPlayer.volume = val / 100;
    updateVolumeIcon(val);
}

function updateVolumeIcon(val) {
    const btn = document.getElementById('ctrl-mute');
    if (!btn) return;
    const icon = btn.querySelector('.material-symbols-rounded');
    if (!icon) return;
    if (val === 0) icon.textContent = 'volume_off';
    else if (val < 50) icon.textContent = 'volume_down';
    else icon.textContent = 'volume_up';
}

// ─────────────────────────────────────────────
// 再生キューパネル
// ─────────────────────────────────────────────
function initQueuePanel() {
    const queueBtn = document.getElementById('ctrl-queue');
    const fpQueueBtn = document.getElementById('fp-queue-btn');
    const closeBtn = document.getElementById('close-queue-btn');
    const overlay = document.getElementById('queue-overlay');

    if (queueBtn) queueBtn.addEventListener('click', toggleQueuePanel);
    if (fpQueueBtn) fpQueueBtn.addEventListener('click', toggleQueuePanel);
    if (closeBtn) closeBtn.addEventListener('click', closeQueuePanel);
    if (overlay) overlay.addEventListener('click', closeQueuePanel);
}

function toggleQueuePanel() {
    appState.isQueueOpen = !appState.isQueueOpen;
    const panel = document.getElementById('queue-panel');
    const overlay = document.getElementById('queue-overlay');
    if (panel) panel.classList.toggle('open', appState.isQueueOpen);
    if (overlay) overlay.classList.toggle('show', appState.isQueueOpen);
    if (appState.isQueueOpen) renderQueuePanel();
}

function closeQueuePanel() {
    appState.isQueueOpen = false;
    const panel = document.getElementById('queue-panel');
    const overlay = document.getElementById('queue-overlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
}

function renderQueuePanel() {
    const list = document.getElementById('queue-list');
    if (!list) return;
    list.innerHTML = '';
    appState.currentQueue.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'queue-item' + (index === appState.currentTrackIndex ? ' current' : '');
        const thumb = document.createElement('div');
        thumb.className = 'queue-thumb';
        if (track.thumbnailDataUrl) {
            thumb.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
            thumb.style.backgroundSize = 'cover';
        } else {
            thumb.innerHTML = '<span class="material-symbols-rounded">music_note</span>';
        }
        const info = document.createElement('div');
        info.className = 'queue-item-info';
        info.innerHTML = `<div class="queue-item-title">${track.title}</div><div class="queue-item-artist">${track.artist || '-'}</div>`;
        li.innerHTML = `<span class="queue-item-num">${index + 1}</span>`;
        li.appendChild(thumb);
        li.appendChild(info);
        li.addEventListener('click', () => playTrack(index));
        list.appendChild(li);
    });
    const currentEl = list.querySelector('.current');
    if (currentEl) currentEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ─────────────────────────────────────────────
// フルスクリーンプレイヤー（スマホ）
// ─────────────────────────────────────────────
function initFullscreenPlayer() {
    const closeBtn = document.getElementById('fp-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeFullscreenPlayer);

    const fpPlay = document.getElementById('fp-play');
    const fpPrev = document.getElementById('fp-prev');
    const fpNext = document.getElementById('fp-next');
    const fpSeek = document.getElementById('fp-seek-bar');
    const fpVolume = document.getElementById('fp-volume-bar');
    const fpLoop = document.getElementById('fp-loop');
    const fpShuffle = document.getElementById('fp-shuffle');
    const fpSpeed = document.getElementById('fp-speed');

    if (fpPlay) fpPlay.addEventListener('click', togglePlay);
    if (fpPrev) fpPrev.addEventListener('click', playPrev);
    if (fpNext) fpNext.addEventListener('click', playNext);
    if (fpLoop) fpLoop.addEventListener('click', cycleLoopMode);
    if (fpShuffle) fpShuffle.addEventListener('click', toggleShuffle);
    if (fpSpeed) fpSpeed.addEventListener('click', cycleSpeed);
    if (fpSeek) fpSeek.addEventListener('input', (e) => {
        if (audioPlayer.duration) audioPlayer.currentTime = (e.target.value / 100) * audioPlayer.duration;
    });
    if (fpVolume) fpVolume.addEventListener('input', (e) => {
        audioPlayer.volume = e.target.value / 100;
        const mainVol = document.getElementById('volume-bar');
        if (mainVol) mainVol.value = e.target.value;
        updateVolumeIcon(e.target.value);
    });
}

function openFullscreenPlayer() {
    const player = document.getElementById('fullscreen-player');
    if (player) player.classList.add('open');
}

function closeFullscreenPlayer() {
    const player = document.getElementById('fullscreen-player');
    if (player) player.classList.remove('open');
}

function updateFullscreenPlayer(track) {
    const artwork = document.getElementById('fp-artwork');
    const fpBg = document.getElementById('fp-bg');
    const title = document.getElementById('fp-title');
    const artist = document.getElementById('fp-artist');
    if (title) title.textContent = track ? track.title : '未選択';
    if (artist) artist.textContent = track ? (track.artist || '-') : '-';
    if (artwork) {
        if (track && track.thumbnailDataUrl) {
            artwork.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
            artwork.innerHTML = '';
            if (fpBg) fpBg.style.background = `linear-gradient(180deg, var(--bg-sub) 0%, var(--bg) 100%)`;
        } else {
            artwork.style.backgroundImage = 'none';
            artwork.innerHTML = '<span class="material-symbols-rounded">music_note</span>';
            if (fpBg) fpBg.style.background = '';
        }
    }
}

// ─────────────────────────────────────────────
// ミニプレイヤー（スマホ）
// ─────────────────────────────────────────────
function initMiniPlayer() {
    const miniPlayer = document.getElementById('mini-player');
    const miniPlayBtn = document.getElementById('mini-play');
    const miniPrevBtn = document.getElementById('mini-prev');
    const miniNextBtn = document.getElementById('mini-next');

    if (miniPlayBtn) miniPlayBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
    if (miniPrevBtn) miniPrevBtn.addEventListener('click', (e) => { e.stopPropagation(); playPrev(); });
    if (miniNextBtn) miniNextBtn.addEventListener('click', (e) => { e.stopPropagation(); playNext(); });

    // ミニプレイヤークリックでフルスクリーン展開
    if (miniPlayer) {
        miniPlayer.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            openFullscreenPlayer();
        });
    }
}

function updateMiniPlayer(track) {
    const miniThumb = document.getElementById('mini-thumb');
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');

    if (miniTitle) miniTitle.textContent = track ? track.title : '未選択';
    if (miniArtist) miniArtist.textContent = track ? (track.artist || '-') : '-';
    if (miniThumb) {
        if (track && track.thumbnailDataUrl) {
            miniThumb.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
            miniThumb.innerHTML = '';
        } else {
            miniThumb.style.backgroundImage = 'none';
            miniThumb.innerHTML = '<span class="material-symbols-rounded">music_note</span>';
        }
    }
}

function updateMiniPlayButton() {
    const btn = document.getElementById('mini-play');
    if (btn) {
        const icon = btn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = appState.isPlaying ? 'pause' : 'play_arrow';
    }
}

// ─────────────────────────────────────────────
// ループ / シャッフル / 速度
// ─────────────────────────────────────────────
function cycleLoopMode() {
    const modes = ['none', 'all', 'one'];
    const idx = modes.indexOf(appState.loopMode);
    appState.loopMode = modes[(idx + 1) % modes.length];
    updateLoopUI();
    const labels = { none: 'ループなし', all: '全曲ループ', one: '1曲リピート' };
    showToast(labels[appState.loopMode]);
}

function updateLoopUI() {
    const btns = [document.getElementById('ctrl-loop'), document.getElementById('fp-loop')];
    btns.forEach(btn => {
        if (!btn) return;
        btn.classList.toggle('active', appState.loopMode !== 'none');
        const icon = btn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = appState.loopMode === 'one' ? 'repeat_one' : 'repeat';
    });
}

function toggleShuffle() {
    appState.isShuffled = !appState.isShuffled;
    [document.getElementById('ctrl-shuffle'), document.getElementById('fp-shuffle')].forEach(btn => {
        if (btn) btn.classList.toggle('active', appState.isShuffled);
    });
    showToast(appState.isShuffled ? 'シャッフルON' : 'シャッフルOFF');
    const sortSelect = document.getElementById('main-sort-select');
    if (sortSelect) {
        sortSelect.value = appState.isShuffled ? 'random' : 'manual';
    }
    appState.sortModeMain = appState.isShuffled ? 'random' : 'manual';
    updateMainQueue();
}

function cycleSpeed() {
    currentSpeedIndex = (currentSpeedIndex + 1) % SPEED_OPTIONS.length;
    const speed = SPEED_OPTIONS[currentSpeedIndex];
    audioPlayer.playbackRate = speed;
    const label = speed === 1 ? '1x' : speed + 'x';
    [document.getElementById('ctrl-speed'), document.getElementById('fp-speed')].forEach(btn => {
        if (btn) {
            btn.textContent = label;
            btn.classList.toggle('active', speed !== 1);
        }
    });
    showToast(`再生速度: ${label}`);
}

// ─────────────────────────────────────────────
// 再生ログ
// ─────────────────────────────────────────────
function startPlaybackTracking() {
    if (appState.currentTrackIndex >= 0 && appState.isPlaying) {
        playbackStartTime = Date.now();
    }
}

function stopPlaybackTracking() {
    if (playbackStartTime > 0 && appState.currentTrackIndex >= 0) {
        const elapsedSeconds = (Date.now() - playbackStartTime) / 1000;
        if (elapsedSeconds > 2) {
            const track = appState.currentQueue[appState.currentTrackIndex];
            if (track) {
                saveLogToDB({
                    trackId: track.id,
                    title: track.title,
                    artist: track.artist || '不明',
                    tags: track.tags || [],
                    date: track.date || '',
                    duration: elapsedSeconds,
                    timestamp: Date.now()
                });
            }
        }
        playbackStartTime = 0;
    }
}

function saveLogToDB(logEntry) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['logs'], 'readwrite');
        const req = tx.objectStore('logs').add(logEntry);
        req.onsuccess = () => resolve();
        req.onerror = e => reject(e.target.error);
    });
}

function getAllLogsFromDB() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['logs'], 'readonly');
        const req = tx.objectStore('logs').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = e => reject(e.target.error);
    });
}

// ─────────────────────────────────────────────
// ログ画面
// ─────────────────────────────────────────────
function initLogControls() {
    document.querySelectorAll('#log-category .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#log-category .seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            appState.currentLogCategory = btn.getAttribute('data-value');
            updateLogPage();
        });
    });
    document.querySelectorAll('#log-period .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#log-period .seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            appState.currentLogPeriod = btn.getAttribute('data-value');
            updateLogPage();
        });
    });
}

async function updateLogPage() {
    const logs = await getAllLogsFromDB();
    const period = appState.currentLogPeriod;
    const category = appState.currentLogCategory;

    const totalSeconds = logs.reduce((sum, l) => sum + l.duration, 0);
    document.getElementById('stat-total-time').textContent = formatLogTime(totalSeconds);
    document.getElementById('stat-total-tracks').textContent = `${appState.tracks.length} 曲`;

    // 最多再生曲
    const trackTimes = {};
    logs.forEach(l => { trackTimes[l.title || l.trackId] = (trackTimes[l.title || l.trackId] || 0) + l.duration; });
    const topTrack = Object.entries(trackTimes).sort((a, b) => b[1] - a[1])[0];
    document.getElementById('stat-top-track').textContent = topTrack ? topTrack[0] : '-';

    // 最多アーティスト
    const artistTimes = {};
    logs.forEach(l => { if (l.artist) artistTimes[l.artist] = (artistTimes[l.artist] || 0) + l.duration; });
    const topArtist = Object.entries(artistTimes).sort((a, b) => b[1] - a[1])[0];
    const topArtistEl = document.getElementById('stat-top-artist');
    if (topArtistEl) topArtistEl.textContent = topArtist ? topArtist[0] : '-';

    // フィルタリング
    const now = Date.now();
    let filteredLogs = [...logs];
    if (period === 'day') filteredLogs = logs.filter(l => now - l.timestamp <= 86400000);
    else if (period === 'week') filteredLogs = logs.filter(l => now - l.timestamp <= 7 * 86400000);
    else if (period === 'month') filteredLogs = logs.filter(l => now - l.timestamp <= 30 * 86400000);
    else if (period === 'year') filteredLogs = logs.filter(l => now - l.timestamp <= 365 * 86400000);

    renderBarChart(filteredLogs, period, category);
    renderPieChart(filteredLogs, category);
    renderRanking(filteredLogs, category);
}

function filterPeriodKey(log, period) {
    const d = new Date(log.timestamp);
    if (period === 'day') return `${d.getHours()}時`;
    if (period === 'week' || period === 'month') return `${d.getMonth()+1}/${d.getDate()}`;
    return `${d.getFullYear()}年${d.getMonth()+1}月`;
}

function groupLogsByCategory(logs, category) {
    const grouped = {};
    logs.forEach(l => {
        let key;
        if (category === 'artist') key = l.artist || '不明';
        else if (category === 'tag') {
            if (l.tags && l.tags.length > 0) {
                l.tags.forEach(t => {
                    const text = typeof t === 'string' ? t : t.text;
                    grouped[text] = (grouped[text] || 0) + l.duration;
                });
                return;
            } else key = 'タグなし';
        } else if (category === 'decade') {
            const m = (l.date || '').match(/\d{4}/);
            key = m ? `${Math.floor(parseInt(m[0]) / 10) * 10}年代` : '不明';
        }
        if (key !== undefined) grouped[key] = (grouped[key] || 0) + l.duration;
    });
    return grouped;
}

function renderBarChart(filteredLogs, period, category) {
    const ctx = document.getElementById('logChart');
    if (!ctx) return;
    if (logChartInstance) { logChartInstance.destroy(); logChartInstance = null; }

    let labels = [], data = [], chartType = 'bar';

    const titleMap = { total: '再生時間の推移', artist: 'アーティスト別再生時間', tag: 'タグ別再生時間', decade: '年代別再生時間' };
    const titleEl = document.getElementById('bar-chart-title');
    if (titleEl) titleEl.textContent = titleMap[category] || '';

    if (category === 'total') {
        chartType = 'line';
        const grouped = {}, orderMap = {};
        filteredLogs.forEach(l => {
            const key = filterPeriodKey(l, period);
            grouped[key] = (grouped[key] || 0) + l.duration;
            if (!orderMap[key] || l.timestamp < orderMap[key]) orderMap[key] = l.timestamp;
        });
        const sortedKeys = Object.keys(grouped).sort((a, b) => orderMap[a] - orderMap[b]);
        labels = sortedKeys;
        data = sortedKeys.map(k => +(grouped[k] / 60).toFixed(1));
    } else {
        const grouped = groupLogsByCategory(filteredLogs, category);
        const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 15);
        labels = sorted.map(x => x[0]);
        data = sorted.map(x => +(x[1] / 60).toFixed(1));
    }

    logChartInstance = new Chart(ctx.getContext('2d'), {
        type: chartType,
        data: {
            labels: labels.length > 0 ? labels : ['データなし'],
            datasets: [{
                label: '再生時間（分）',
                data: data.length > 0 ? data : [0],
                backgroundColor: chartType === 'bar'
                    ? 'rgba(26,110,245,0.15)'
                    : 'rgba(26,110,245,0.08)',
                borderColor: 'rgba(26,110,245,0.85)',
                borderWidth: 2,
                borderRadius: chartType === 'bar' ? 6 : 0,
                fill: chartType === 'line',
                tension: 0.4,
                pointRadius: chartType === 'line' ? 3 : 0,
                pointBackgroundColor: 'rgba(26,110,245,1)',
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: '再生時間（分）', font: { size: 11, family: 'Noto Sans JP' } },
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: { font: { size: 11, family: 'Noto Sans JP' } }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11, family: 'Noto Sans JP' }, maxRotation: 45 }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(17,17,21,0.9)',
                    titleFont: { size: 12, family: 'Noto Sans JP' },
                    bodyFont: { size: 11, family: 'Noto Sans JP' },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: (ctx) => `${ctx.raw} 分`
                    }
                }
            }
        }
    });
}

function renderPieChart(filteredLogs, category) {
    const ctx = document.getElementById('logPieChart');
    const card = document.getElementById('pie-chart-card');
    if (!ctx) return;
    if (logPieChartInstance) { logPieChartInstance.destroy(); logPieChartInstance = null; }

    const titleEl = document.getElementById('pie-chart-title');
    const catLabels = { total: '時間帯別', artist: 'アーティスト別', tag: 'タグ別', decade: '年代別' };
    if (titleEl) titleEl.textContent = catLabels[category] + '構成比';

    const grouped = category === 'total'
        ? (() => {
            const g = {};
            filteredLogs.forEach(l => {
                const h = new Date(l.timestamp).getHours();
                const key = h < 6 ? '深夜 (0-6時)' : h < 12 ? '午前 (6-12時)' : h < 18 ? '午後 (12-18時)' : '夜 (18-24時)';
                g[key] = (g[key] || 0) + l.duration;
            });
            return g;
        })()
        : groupLogsByCategory(filteredLogs, category);

    const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const labels = entries.map(x => x[0]);
    const data = entries.map(x => +(x[1] / 60).toFixed(1));

    const COLORS = [
        'rgba(26,110,245,0.8)', 'rgba(52,199,89,0.8)', 'rgba(255,149,0,0.8)',
        'rgba(229,57,53,0.8)', 'rgba(88,86,214,0.8)', 'rgba(90,200,250,0.8)',
        'rgba(255,204,0,0.8)', 'rgba(175,82,222,0.8)'
    ];

    if (data.length === 0) {
        if (card) card.style.display = 'none';
        return;
    }
    if (card) card.style.display = '';

    logPieChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: COLORS.slice(0, data.length),
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '58%',
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        font: { size: 11, family: 'Noto Sans JP' },
                        padding: 10,
                        usePointStyle: true,
                        pointStyleWidth: 8,
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(17,17,21,0.9)',
                    titleFont: { size: 12, family: 'Noto Sans JP' },
                    bodyFont: { size: 11, family: 'Noto Sans JP' },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: (ctx) => ` ${ctx.label}: ${ctx.raw} 分`
                    }
                }
            }
        }
    });
}

function renderRanking(filteredLogs, category) {
    const list = document.getElementById('ranking-list');
    const title = document.getElementById('ranking-title');
    if (!list) return;

    const catNames = { total: '曲', artist: 'アーティスト', tag: 'タグ', decade: '年代' };
    if (title) title.textContent = `${catNames[category] || ''} 再生時間ランキング`;

    let grouped;
    if (category === 'total') {
        grouped = {};
        filteredLogs.forEach(l => {
            grouped[l.title || l.trackId] = (grouped[l.title || l.trackId] || 0) + l.duration;
        });
    } else {
        grouped = groupLogsByCategory(filteredLogs, category);
    }

    const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxVal = sorted[0] ? sorted[0][1] : 1;

    list.innerHTML = '';
    sorted.forEach(([name, seconds], i) => {
        const pct = Math.round((seconds / maxVal) * 100);
        const li = document.createElement('li');
        li.className = 'ranking-item';
        li.innerHTML = `
            <span class="rank-num ${i < 3 ? 'top' : ''}">${i + 1}</span>
            <div class="rank-bar-area">
                <div class="rank-name">${name}</div>
                <div class="rank-bar-track">
                    <div class="rank-bar-fill" style="width:${pct}%"></div>
                </div>
            </div>
            <span class="rank-time">${formatLogTime(seconds)}</span>
        `;
        list.appendChild(li);
    });

    if (sorted.length === 0) {
        list.innerHTML = '<li style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:13px;">データがありません</li>';
    }
}

function formatLogTime(seconds) {
    if (seconds < 60) return `${Math.floor(seconds)} 秒`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m} 分`;
    const h = Math.floor(m / 60);
    return `${h} 時間 ${m % 60} 分`;
}

// ─────────────────────────────────────────────
// Google ログイン & Drive連携
// ─────────────────────────────────────────────
function initAuthUI() {
    const btnLogin = document.getElementById('btn-login');
    const btnLogout = document.getElementById('btn-logout');

    btnLogin.addEventListener('click', () => {
        if (!GOOGLE_CLIENT_ID) { showToast('GOOGLE_CLIENT_ID を設定してください', 'error'); return; }
        if (typeof google === 'undefined' || !google.accounts) {
            showToast('Google認証システムを読み込み中です。数秒後に再試行してください', 'warning'); return;
        }
        if (!tokenClient) {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile',
                callback: (tokenResponse) => {
                    if (tokenResponse && tokenResponse.access_token) {
                        gapiAccessToken = tokenResponse.access_token;
                        appState.isLoggedIn = true;
                        fetchUserInfo(gapiAccessToken);
                    }
                },
            });
        }
        tokenClient.requestAccessToken();
    });

    btnLogout.addEventListener('click', () => {
        if (gapiAccessToken && typeof google !== 'undefined') google.accounts.oauth2.revoke(gapiAccessToken, () => {});
        gapiAccessToken = null;
        appState.isLoggedIn = false;
        appState.user = null;
        updateAuthUIDisplay();
        showToast('ログアウトしました');
    });
}

function fetchUserInfo(token) {
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
    }).then(res => res.json()).then(data => {
        appState.user = data;
        updateAuthUIDisplay();
        showToast(`${data.name} でログインしました`, 'success');
        autoSync();
    }).catch(err => console.error('ユーザー情報取得エラー:', err));
}

function updateAuthUIDisplay() {
    const btnLogin = document.getElementById('btn-login');
    const userInfo = document.getElementById('user-info');
    const userName = document.getElementById('user-name');
    if (appState.isLoggedIn && appState.user) {
        btnLogin.style.display = 'none';
        userInfo.style.display = 'flex';
        if (userName) userName.textContent = appState.user.name || 'ユーザー';
    } else {
        btnLogin.style.display = 'flex';
        userInfo.style.display = 'none';
    }
}

function autoSync() {
    if (appState.isLoggedIn && !appState.isSyncing) performDriveSync();
}

async function performDriveSync() {
    if (!gapiAccessToken) return;
    const syncStatus = document.getElementById('sync-status');
    appState.isSyncing = true;
    if (syncStatus) syncStatus.textContent = '同期中...';

    try {
        const folderId = await getOrCreateSyncFolder();
        const existingJsonId = await findDriveFile('library_sync.json', 'application/json', folderId);
        let remoteData = null;
        if (existingJsonId) {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${existingJsonId}?alt=media`, {
                headers: { Authorization: `Bearer ${gapiAccessToken}` }
            });
            if (res.ok) remoteData = await res.json();
        }

        const remoteTracks = remoteData ? remoteData.tracks || [] : [];
        const remotePlaylists = remoteData ? remoteData.playlists || [] : [];
        const localTracks = await getAllTracksFromDBRaw();
        const localPlaylists = await getAllPlaylistsFromDBRaw();
        const localTrackMap = new Map(localTracks.map(t => [t.id, t]));
        const localPlaylistMap = new Map(localPlaylists.map(p => [p.id, p]));

        for (let rTrack of remoteTracks) {
            let lTrack = localTrackMap.get(rTrack.id);
            if (!lTrack) {
                if (!rTrack.deleted && !appState.isStreaming && rTrack.driveFileId) {
                    const blob = await downloadFileFromDrive(rTrack.driveFileId, syncStatus, rTrack.title);
                    if (blob) rTrack.fileBlob = blob;
                }
                await saveTrackToDB(rTrack);
                localTrackMap.set(rTrack.id, rTrack);
            } else {
                const rTime = rTrack.updatedAt || 0, lTime = lTrack.updatedAt || 0;
                if (rTime > lTime) {
                    rTrack.fileBlob = lTrack.fileBlob;
                    if (rTrack.deleted) delete rTrack.fileBlob;
                    else if (!appState.isStreaming && !rTrack.fileBlob && rTrack.driveFileId) {
                        const blob = await downloadFileFromDrive(rTrack.driveFileId, syncStatus, rTrack.title);
                        if (blob) rTrack.fileBlob = blob;
                    }
                    await saveTrackToDB(rTrack);
                    localTrackMap.set(rTrack.id, rTrack);
                } else {
                    if (!lTrack.deleted && !appState.isStreaming && !lTrack.fileBlob && lTrack.driveFileId) {
                        const blob = await downloadFileFromDrive(lTrack.driveFileId, syncStatus, lTrack.title);
                        if (blob) { lTrack.fileBlob = blob; await saveTrackToDB(lTrack); }
                    }
                }
            }
        }

        for (let lTrack of localTrackMap.values()) {
            if (!lTrack.deleted && !lTrack.driveFileId && lTrack.fileBlob) {
                if (syncStatus) syncStatus.textContent = `UP中: ${lTrack.title}`;
                const fileId = await uploadFileToDrive(lTrack.fileBlob, lTrack.fileName, lTrack.fileBlob.type, folderId);
                lTrack.driveFileId = fileId;
                lTrack.updatedAt = Date.now();
                await saveTrackToDB(lTrack);
            }
        }

        for (let rPl of remotePlaylists) {
            let lPl = localPlaylistMap.get(rPl.id);
            if (!lPl) { await savePlaylistToDB(rPl); localPlaylistMap.set(rPl.id, rPl); }
            else {
                const rTime = rPl.updatedAt || 0, lTime = lPl.updatedAt || 0;
                if (rTime > lTime) { await savePlaylistToDB(rPl); localPlaylistMap.set(rPl.id, rPl); }
            }
        }

        if (syncStatus) syncStatus.textContent = '保存中...';
        const finalTracksToSync = Array.from(localTrackMap.values()).map(t => { const { fileBlob, ...rest } = t; return rest; });
        const syncData = { tracks: finalTracksToSync, playlists: Array.from(localPlaylistMap.values()), lastSyncedAt: Date.now() };
        await uploadFileToDrive(new Blob([JSON.stringify(syncData)], { type: 'application/json' }), 'library_sync.json', 'application/json', folderId, existingJsonId);

        await loadLibrary();
        await loadPlaylists();
        if (syncStatus) syncStatus.textContent = '同期完了';
        setTimeout(() => { if (syncStatus) syncStatus.textContent = ''; }, 3000);
        showToast('同期が完了しました', 'success');
    } catch (error) {
        console.error('同期エラー:', error);
        if (syncStatus) syncStatus.textContent = '同期失敗';
        showToast('同期に失敗しました', 'error');
    } finally {
        appState.isSyncing = false;
    }
}

async function getOrCreateSyncFolder() {
    const existingId = await findDriveFile(SYNC_FOLDER_NAME, 'application/vnd.google-apps.folder');
    if (existingId) return existingId;
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${gapiAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: SYNC_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    return (await res.json()).id;
}

async function findDriveFile(name, mimeType, parentId = null) {
    let q = `name='${name}' and trashed=false`;
    if (mimeType) q += ` and mimeType='${mimeType}'`;
    if (parentId) q += ` and '${parentId}' in parents`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
        headers: { Authorization: `Bearer ${gapiAccessToken}` }
    });
    const data = await res.json();
    return (data.files && data.files.length > 0) ? data.files[0].id : null;
}

async function uploadFileToDrive(blob, filename, mimeType, folderId, existingId = null) {
    let fileId = existingId;
    if (!fileId) {
        const metaRes = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { Authorization: `Bearer ${gapiAccessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: filename, parents: [folderId], mimeType })
        });
        fileId = (await metaRes.json()).id;
    }
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${gapiAccessToken}`, 'Content-Type': mimeType },
        body: blob
    });
    return fileId;
}

async function downloadFileFromDrive(fileId, syncStatusElement, title) {
    if (syncStatusElement) syncStatusElement.textContent = `DL中: ${title || ''}`;
    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { Authorization: `Bearer ${gapiAccessToken}` }
        });
        if (res.ok) return await res.blob();
    } catch (e) { console.error('ファイルダウンロード失敗:', e); }
    return null;
}

// ─────────────────────────────────────────────
// DB処理
// ─────────────────────────────────────────────
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (e) => reject(e.target.error);
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('tracks')) database.createObjectStore('tracks', { keyPath: 'id' });
            if (!database.objectStoreNames.contains('playlists')) database.createObjectStore('playlists', { keyPath: 'id' });
            if (!database.objectStoreNames.contains('logs')) database.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
        };
    });
}

function initPlaylistPlaybackControls() {
    const playAllBtn = document.getElementById('btn-play-all');
    const shuffleAllBtn = document.getElementById('btn-shuffle-all');
    if (playAllBtn) playAllBtn.addEventListener('click', () => {
        if (appState.currentQueue.length === 0) return;
        if (appState.sortModeMain === 'random') {
            const sel = document.getElementById('main-sort-select');
            if (sel) { sel.value = 'manual'; sel.dispatchEvent(new Event('change')); }
        }
        playTrack(0);
    });
    if (shuffleAllBtn) shuffleAllBtn.addEventListener('click', () => {
        if (appState.currentQueue.length === 0) return;
        const sel = document.getElementById('main-sort-select');
        if (sel) { sel.value = 'random'; sel.dispatchEvent(new Event('change')); }
        playTrack(0);
    });
}

function initSearchAndSort() {
    const mainSearch = document.getElementById('main-search-input');
    if (mainSearch) mainSearch.addEventListener('input', (e) => {
        appState.searchQueryMain = e.target.value.toLowerCase();
        updateMainQueue();
    });

    const sortSelect = document.getElementById('main-sort-select');
    if (sortSelect) sortSelect.addEventListener('change', (e) => {
        appState.sortModeMain = e.target.value;
        updateMainQueue();
    });

    const selectAllCb = document.getElementById('main-select-all');
    if (selectAllCb) selectAllCb.addEventListener('change', (e) => {
        if (e.target.checked) appState.currentQueue.forEach(t => appState.selectedMainTracks.add(t.id));
        else appState.selectedMainTracks.clear();
        renderMainTrackList();
    });

    const editSearch = document.getElementById('edit-search-input');
    if (editSearch) editSearch.addEventListener('input', (e) => {
        appState.searchQueryEdit = e.target.value.toLowerCase();
        renderEditLibraryList();
    });
}

function updateMainQueue() {
    let baseList = [];
    if (!appState.currentPlaylistId) {
        baseList = [...appState.tracks];
    } else {
        const pl = appState.playlists.find(p => p.id === appState.currentPlaylistId);
        if (pl) baseList = pl.trackIds.map(id => appState.tracks.find(t => t.id === id)).filter(Boolean);
    }

    if (appState.searchQueryMain) {
        baseList = baseList.filter(t => {
            const q = appState.searchQueryMain;
            return t.title.toLowerCase().includes(q) ||
                (t.artist || '').toLowerCase().includes(q) ||
                (t.tags || []).some(tag => (typeof tag === 'string' ? tag : tag.text).toLowerCase().includes(q));
        });
    }

    if (appState.sortModeMain === 'random') {
        baseList.sort(() => Math.random() - 0.5);
    } else if (appState.sortModeMain !== 'manual') {
        baseList.sort((a, b) => {
            switch (appState.sortModeMain) {
                case 'date_desc': return b.addedAt - a.addedAt;
                case 'date_asc': return a.addedAt - b.addedAt;
                case 'name_asc': return a.title.localeCompare(b.title);
                case 'name_desc': return b.title.localeCompare(a.title);
                case 'artist_asc': return (a.artist||'').localeCompare(b.artist||'');
                case 'artist_desc': return (b.artist||'').localeCompare(a.artist||'');
                case 'release_desc': return (b.date||'').localeCompare(a.date||'');
                case 'release_asc': return (a.date||'').localeCompare(b.date||'');
                default: return 0;
            }
        });
    }

    appState.currentQueue = baseList;

    // ドロップゾーン表示切替
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        if (appState.tracks.length === 0 && !appState.searchQueryMain) dropZone.classList.add('show');
        else dropZone.classList.remove('show');
    }

    renderMainTrackList();
    if (appState.isQueueOpen) renderQueuePanel();
}

// ─────────────────────────────────────────────
// プレイヤーコントロール
// ─────────────────────────────────────────────
function initPlayerControls() {
    const playBtn = document.getElementById('ctrl-play');
    const prevBtn = document.getElementById('ctrl-prev');
    const nextBtn = document.getElementById('ctrl-next');
    const seekBar = document.getElementById('seek-bar');
    const volumeBar = document.getElementById('volume-bar');
    const loopBtn = document.getElementById('ctrl-loop');
    const speedBtn = document.getElementById('ctrl-speed');
    const shuffleBtn = document.getElementById('ctrl-shuffle');
    const muteBtn = document.getElementById('ctrl-mute');

    if (playBtn) playBtn.addEventListener('click', togglePlay);
    if (nextBtn) nextBtn.addEventListener('click', playNext);
    if (prevBtn) prevBtn.addEventListener('click', playPrev);
    if (loopBtn) loopBtn.addEventListener('click', cycleLoopMode);
    if (speedBtn) speedBtn.addEventListener('click', cycleSpeed);
    if (shuffleBtn) shuffleBtn.addEventListener('click', toggleShuffle);
    if (muteBtn) muteBtn.addEventListener('click', () => {
        audioPlayer.muted = !audioPlayer.muted;
        const icon = muteBtn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = audioPlayer.muted ? 'volume_off' : 'volume_up';
    });

    if (seekBar) seekBar.addEventListener('input', (e) => {
        if (audioPlayer.duration) audioPlayer.currentTime = (e.target.value / 100) * audioPlayer.duration;
    });
    if (volumeBar) {
        volumeBar.addEventListener('input', (e) => {
            audioPlayer.volume = e.target.value / 100;
            const fpVol = document.getElementById('fp-volume-bar');
            if (fpVol) fpVol.value = e.target.value;
            updateVolumeIcon(e.target.value);
        });
        audioPlayer.volume = volumeBar.value / 100;
    }

    audioPlayer.addEventListener('timeupdate', () => {
        if (!audioPlayer.duration) return;
        const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;

        if (seekBar) {
            seekBar.value = pct;
            seekBar.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--border) ${pct}%)`;
        }
        const fpSeek = document.getElementById('fp-seek-bar');
        if (fpSeek) {
            fpSeek.value = pct;
            fpSeek.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--border) ${pct}%)`;
        }

        const cur = formatTime(audioPlayer.currentTime);
        const tot = formatTime(audioPlayer.duration);
        const tcEl = document.getElementById('time-current');
        const ttEl = document.getElementById('time-total');
        if (tcEl) tcEl.textContent = cur;
        if (ttEl) ttEl.textContent = tot;
        const fpCur = document.getElementById('fp-time-current');
        const fpTot = document.getElementById('fp-time-total');
        if (fpCur) fpCur.textContent = cur;
        if (fpTot) fpTot.textContent = tot;

        // ミニプレイヤーのプログレスバー
        const miniBar = document.getElementById('mini-progress-bar');
        if (miniBar) miniBar.style.width = `${pct}%`;
    });

    audioPlayer.addEventListener('ended', () => {
        stopPlaybackTracking();
        if (appState.loopMode === 'one') {
            audioPlayer.currentTime = 0;
            audioPlayer.play().then(() => { appState.isPlaying = true; startPlaybackTracking(); updatePlayButtonUI(); });
        } else if (appState.loopMode === 'all') {
            let nextIndex = appState.currentTrackIndex + 1;
            if (nextIndex >= appState.currentQueue.length) nextIndex = 0;
            playTrack(nextIndex);
        } else {
            if (appState.currentTrackIndex < appState.currentQueue.length - 1) playNext();
            else { appState.isPlaying = false; updatePlayButtonUI(); }
        }
    });
}

function playTrack(index) {
    if (index < 0 || index >= appState.currentQueue.length) return;
    stopPlaybackTracking();
    const track = appState.currentQueue[index];
    appState.currentTrackIndex = index;
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);

    if (track.fileBlob) {
        currentObjectUrl = URL.createObjectURL(track.fileBlob);
        audioPlayer.src = currentObjectUrl;
    } else if (appState.isStreaming && track.driveFileId && gapiAccessToken) {
        audioPlayer.src = `https://www.googleapis.com/drive/v3/files/${track.driveFileId}?alt=media&access_token=${gapiAccessToken}`;
    } else {
        showToast('音声ファイルが見つかりません', 'error');
        return;
    }

    audioPlayer.playbackRate = SPEED_OPTIONS[currentSpeedIndex];
    audioPlayer.play().then(() => {
        appState.isPlaying = true;
        updatePlayerUI(track);
        renderMainTrackList();
        if (appState.isQueueOpen) renderQueuePanel();
        startPlaybackTracking();
    }).catch(e => console.error('再生エラー:', e));
}

function togglePlay() {
    if (appState.currentQueue.length === 0) return;
    if (appState.isPlaying) {
        audioPlayer.pause();
        appState.isPlaying = false;
        stopPlaybackTracking();
    } else {
        if (audioPlayer.src) {
            audioPlayer.play().then(() => { appState.isPlaying = true; startPlaybackTracking(); });
        } else {
            playTrack(0);
        }
    }
    updatePlayButtonUI();
    renderMainTrackList();
}

function playNext() {
    if (appState.currentQueue.length === 0) return;
    let nextIndex = appState.currentTrackIndex + 1;
    if (nextIndex >= appState.currentQueue.length) nextIndex = 0;
    playTrack(nextIndex);
}

function playPrev() {
    if (appState.currentQueue.length === 0) return;
    if (audioPlayer.currentTime > 3) { audioPlayer.currentTime = 0; return; }
    let prevIndex = appState.currentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = appState.currentQueue.length - 1;
    playTrack(prevIndex);
}

function updatePlayerUI(track) {
    // タイトル・アーティスト（PC左パネル）
    const npTitle = document.getElementById('np-title');
    const npArtist = document.getElementById('np-artist');
    if (npTitle) npTitle.textContent = track.title;
    if (npArtist) npArtist.textContent = track.artist || '-';

    // アルバムアート
    const artworkImage = document.getElementById('artwork-image');
    const artworkBg = document.getElementById('artwork-bg');
    if (artworkImage) {
        if (track.thumbnailDataUrl) {
            artworkImage.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
            artworkImage.innerHTML = '';
            artworkImage.classList.add('has-art');
        } else {
            artworkImage.style.backgroundImage = 'none';
            artworkImage.innerHTML = '<span class="material-symbols-rounded">music_note</span>';
            artworkImage.classList.remove('has-art');
        }
    }
    if (artworkBg) {
        if (track.thumbnailDataUrl) artworkBg.classList.add('visible');
        else artworkBg.classList.remove('visible');
    }

    // ミニプレイヤー・フルスクリーン更新
    updateMiniPlayer(track);
    updateFullscreenPlayer(track);
    updatePlayButtonUI();

    // MediaSession API（通知バー）
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.artist || '',
            artwork: track.thumbnailDataUrl ? [{ src: track.thumbnailDataUrl }] : []
        });
        navigator.mediaSession.setActionHandler('play', togglePlay);
        navigator.mediaSession.setActionHandler('pause', togglePlay);
        navigator.mediaSession.setActionHandler('previoustrack', playPrev);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
    }
}

function updatePlayButtonUI() {
    const icon = appState.isPlaying ? 'pause' : 'play_arrow';
    [
        document.getElementById('ctrl-play'),
        document.getElementById('fp-play'),
    ].forEach(btn => {
        if (btn) btn.querySelector('.material-symbols-rounded').textContent = icon;
    });
    updateMiniPlayButton();
}

// ─────────────────────────────────────────────
// ドラッグ&ドロップ / ファイル読み込み
// ─────────────────────────────────────────────
function initDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const dropZoneSmall = document.getElementById('drop-zone-small');
    const fileInput = document.getElementById('file-upload');

    if (fileInput) fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    // 大きいドロップゾーン
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault(); dropZone.classList.remove('dragover');
            if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        });
        dropZone.addEventListener('click', () => fileInput && fileInput.click());
    }

    // 小さいドロップゾーン（ヘッダー）
    if (dropZoneSmall) {
        dropZoneSmall.addEventListener('click', () => fileInput && fileInput.click());
        dropZoneSmall.addEventListener('dragover', (e) => { e.preventDefault(); dropZoneSmall.classList.add('dragover'); });
        dropZoneSmall.addEventListener('dragleave', () => dropZoneSmall.classList.remove('dragover'));
        dropZoneSmall.addEventListener('drop', (e) => {
            e.preventDefault(); dropZoneSmall.classList.remove('dragover');
            if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        });
    }

    // ページ全体へのドロップ
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const hasAudio = Array.from(e.dataTransfer.files).some(f => f.type.startsWith('audio/'));
            if (hasAudio) handleFiles(e.dataTransfer.files);
        }
    });
}

function readAudioTags(file) {
    return new Promise((resolve) => {
        if (typeof window.jsmediatags === 'undefined') {
            resolve({ title: null, artist: null, picture: null }); return;
        }
        window.jsmediatags.read(file, {
            onSuccess: (tag) => {
                const tags = tag.tags;
                let pictureUrl = null;
                if (tags.picture) {
                    try {
                        let base64String = '';
                        tags.picture.data.forEach(byte => base64String += String.fromCharCode(byte));
                        pictureUrl = `data:${tags.picture.format};base64,${window.btoa(base64String)}`;
                    } catch (e) {}
                }
                resolve({ title: tags.title || null, artist: tags.artist || null, picture: pictureUrl });
            },
            onError: () => resolve({ title: null, artist: null, picture: null })
        });
    });
}

async function handleFiles(files) {
    if (!files || files.length === 0) return;
    let added = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('audio/')) continue;
        const meta = await readAudioTags(file);
        const newTrack = {
            id: 'track_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            fileBlob: file, fileName: file.name,
            title: meta.title || file.name.replace(/\.[^/.]+$/, ''),
            artist: meta.artist || '不明なアーティスト',
            date: '', tags: [], thumbnailDataUrl: meta.picture || null,
            addedAt: Date.now(), sortOrder: Date.now(),
            updatedAt: Date.now(), deleted: false, driveFileId: null
        };
        await saveTrackToDB(newTrack);
        added++;
    }
    if (added > 0) {
        showToast(`${added}曲 を追加しました`, 'success');
        await loadLibrary();
        autoSync();
    }
}

function saveTrackToDB(track) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['tracks'], 'readwrite');
        const req = tx.objectStore('tracks').put(track);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

function deleteTrackFromDB(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['tracks'], 'readwrite');
        const req = tx.objectStore('tracks').delete(id);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

function savePlaylistToDB(pl) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['playlists'], 'readwrite');
        const req = tx.objectStore('playlists').put(pl);
        req.onsuccess = () => resolve();
        req.onerror = e => reject(e.target.error);
    });
}

function getAllTracksFromDBRaw() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['tracks'], 'readonly');
        const req = tx.objectStore('tracks').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

function getAllPlaylistsFromDBRaw() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['playlists'], 'readonly');
        const req = tx.objectStore('playlists').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function loadLibrary() {
    const allTracks = await getAllTracksFromDBRaw();
    appState.tracks = allTracks.filter(t => !t.deleted);
    appState.tracks.sort((a, b) => {
        const oA = a.sortOrder !== undefined ? a.sortOrder : a.addedAt;
        const oB = b.sortOrder !== undefined ? b.sortOrder : b.addedAt;
        return oA - oB;
    });

    appState.allKnownTags.clear();
    appState.tracks.forEach(t => {
        if (t.tags) t.tags.forEach(tag => {
            const tagObj = typeof tag === 'string' ? { text: tag, color: getTagColorHex(tag) } : tag;
            if (!appState.allKnownTags.has(tagObj.text)) appState.allKnownTags.set(tagObj.text, tagObj);
        });
    });
    updateTagsDatalist();
    updateMainQueue();
}

function updateTagsDatalist() {
    const dl = document.getElementById('existing-tags-list');
    if (!dl) return;
    dl.innerHTML = '';
    appState.allKnownTags.forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag.text;
        dl.appendChild(opt);
    });
}

async function saveManualOrder() {
    if (appState.currentPlaylistId) {
        const pl = appState.playlists.find(p => p.id === appState.currentPlaylistId);
        if (pl) {
            pl.trackIds = appState.currentQueue.map(t => t.id);
            pl.updatedAt = Date.now();
            await savePlaylistToDB(pl);
            autoSync();
        }
    } else {
        if (!appState.searchQueryMain) {
            appState.tracks = [...appState.currentQueue];
            const tx = db.transaction(['tracks'], 'readwrite');
            const store = tx.objectStore('tracks');
            appState.tracks.forEach((t, i) => {
                t.sortOrder = i;
                t.updatedAt = Date.now();
                store.put(t);
            });
            tx.oncomplete = () => autoSync();
        }
    }
}

// ─────────────────────────────────────────────
// 曲リスト描画
// ─────────────────────────────────────────────
function renderMainTrackList() {
    const container = document.getElementById('current-playlist-items');
    if (!container) return;
    container.innerHTML = '';

    const selectAllCb = document.getElementById('main-select-all');
    if (selectAllCb) {
        selectAllCb.checked = appState.currentQueue.length > 0 && appState.selectedMainTracks.size === appState.currentQueue.length;
    }
    updateBulkActionBar();

    let draggedItemIndex = null;

    appState.currentQueue.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'track-list-item';
        const isCurrentTrack = appState.currentTrackIndex === index;
        if (isCurrentTrack) li.classList.add(appState.isPlaying ? 'playing' : 'paused');

        if (appState.sortModeMain === 'manual') {
            li.draggable = true;
            li.addEventListener('dragstart', (e) => {
                draggedItemIndex = index;
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => li.style.opacity = '0.5', 0);
            });
            li.addEventListener('dragend', () => { li.style.opacity = '1'; draggedItemIndex = null; });
            li.addEventListener('dragover', (e) => {
                e.preventDefault();
                li.style.outline = '2px solid var(--accent)';
                li.style.outlineOffset = '-2px';
            });
            li.addEventListener('dragleave', () => { li.style.outline = ''; });
            li.addEventListener('drop', (e) => {
                e.preventDefault();
                li.style.outline = '';
                if (draggedItemIndex === null || draggedItemIndex === index) return;
                const dragged = appState.currentQueue.splice(draggedItemIndex, 1)[0];
                appState.currentQueue.splice(index, 0, dragged);
                if (appState.currentTrackIndex === draggedItemIndex) appState.currentTrackIndex = index;
                else if (appState.currentTrackIndex > draggedItemIndex && appState.currentTrackIndex <= index) appState.currentTrackIndex--;
                else if (appState.currentTrackIndex < draggedItemIndex && appState.currentTrackIndex >= index) appState.currentTrackIndex++;
                saveManualOrder();
                renderMainTrackList();
            });
        }

        // チェックボックス
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'custom-checkbox';
        checkbox.checked = appState.selectedMainTracks.has(track.id);
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) appState.selectedMainTracks.add(track.id);
            else appState.selectedMainTracks.delete(track.id);
            updateBulkActionBar();
        });

        // サムネイル
        const thumb = document.createElement('div');
        thumb.className = 'track-thumb';
        if (track.thumbnailDataUrl) thumb.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
        else thumb.innerHTML = '<span class="material-symbols-rounded">music_note</span>';

        const playingInd = document.createElement('div');
        playingInd.className = 'playing-indicator';
        playingInd.innerHTML = '<div class="playing-bars"><span></span><span></span><span></span></div>';
        thumb.appendChild(playingInd);

        // 曲情報
        const info = document.createElement('div');
        info.className = 'track-list-info';
        let tagsHtml = '';
        if (track.tags && track.tags.length > 0) {
            tagsHtml = '<div class="track-list-tags">' +
                track.tags.map(t => {
                    const tObj = typeof t === 'string' ? { text: t, color: '#ccc' } : t;
                    return `<span class="track-list-tag" style="border:1px solid ${tObj.color};background:${tObj.color}22;">${tObj.text}</span>`;
                }).join('') + '</div>';
        }
        info.innerHTML = `
            <div class="track-list-title">${track.title}</div>
            <div class="track-list-sub">${track.artist || '-'}</div>
            ${tagsHtml}
        `;

        // アクションボタン
        const actions = document.createElement('div');
        actions.className = 'track-actions';

        const addBtn = document.createElement('button');
        addBtn.className = 'icon-btn sm';
        addBtn.title = 'プレイリストに追加';
        addBtn.innerHTML = '<span class="material-symbols-rounded">playlist_add</span>';
        addBtn.addEventListener('click', (e) => { e.stopPropagation(); openAddToPlaylistModal([track.id]); });

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn sm';
        editBtn.title = '情報を編集';
        editBtn.innerHTML = '<span class="material-symbols-rounded">edit</span>';
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditModal([track.id]); });

        actions.appendChild(addBtn);
        actions.appendChild(editBtn);

        if (appState.currentPlaylistId) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'icon-btn sm';
            removeBtn.title = 'このリストから外す';
            removeBtn.innerHTML = '<span class="material-symbols-rounded">playlist_remove</span>';
            removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeTracksFromPlaylist(appState.currentPlaylistId, [track.id]); });
            actions.appendChild(removeBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn sm';
        deleteBtn.title = '完全削除';
        deleteBtn.innerHTML = '<span class="material-symbols-rounded" style="color:var(--danger)">delete_forever</span>';
        deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTracksCompletely([track.id]); });
        actions.appendChild(deleteBtn);

        li.appendChild(checkbox);
        li.appendChild(thumb);
        li.appendChild(info);
        li.appendChild(actions);

        info.addEventListener('click', () => playTrack(index));
        thumb.addEventListener('click', () => playTrack(index));

        container.appendChild(li);
    });
}

function updateBulkActionBar() {
    const bar = document.getElementById('bulk-actions-bar');
    const countSpan = document.getElementById('bulk-count');
    const count = appState.selectedMainTracks.size;
    if (bar) bar.classList.toggle('visible', count > 0);
    if (countSpan) countSpan.textContent = `${count}曲を選択中`;
    const btnRemove = document.getElementById('bulk-remove-playlist-btn');
    if (btnRemove) btnRemove.style.display = appState.currentPlaylistId ? 'inline-flex' : 'none';
}

function initBulkActions() {
    const bulkAddBtn = document.getElementById('bulk-add-playlist-btn');
    const bulkEditBtn = document.getElementById('bulk-edit-btn');
    const bulkRemoveBtn = document.getElementById('bulk-remove-playlist-btn');
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');

    if (bulkAddBtn) bulkAddBtn.addEventListener('click', () => openAddToPlaylistModal(Array.from(appState.selectedMainTracks)));
    if (bulkEditBtn) bulkEditBtn.addEventListener('click', () => openEditModal(Array.from(appState.selectedMainTracks)));
    if (bulkRemoveBtn) bulkRemoveBtn.addEventListener('click', () => {
        if (appState.currentPlaylistId) removeTracksFromPlaylist(appState.currentPlaylistId, Array.from(appState.selectedMainTracks));
    });
    if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', () => deleteTracksCompletely(Array.from(appState.selectedMainTracks)));
}

async function deleteTracksCompletely(trackIds) {
    if (!confirm(`${trackIds.length}曲をライブラリから完全に削除しますか？\nこの操作は元に戻せません。`)) return;
    const playlists = await getAllPlaylistsFromDBRaw();
    for (let pl of playlists) {
        let changed = false;
        trackIds.forEach(id => {
            const i = pl.trackIds.indexOf(id);
            if (i !== -1) { pl.trackIds.splice(i, 1); changed = true; }
        });
        if (changed) { pl.updatedAt = Date.now(); await savePlaylistToDB(pl); }
    }
    const tracks = await getAllTracksFromDBRaw();
    for (let id of trackIds) {
        const track = tracks.find(t => t.id === id);
        if (track) {
            track.deleted = true;
            track.updatedAt = Date.now();
            delete track.fileBlob;
            await saveTrackToDB(track);
        }
    }
    appState.selectedMainTracks.clear();
    showToast(`${trackIds.length}曲 を削除しました`);
    await loadPlaylists();
    await loadLibrary();
    autoSync();
}

// ─────────────────────────────────────────────
// プレイリスト
// ─────────────────────────────────────────────
function initPlaylists() {
    const createBtn = document.getElementById('create-playlist-btn');
    if (createBtn) {
        createBtn.addEventListener('click', async () => {
            const name = prompt('新しいプレイリストの名前を入力してください');
            if (!name || !name.trim()) return;
            const newList = {
                id: 'pl_' + Date.now(),
                name: name.trim(),
                trackIds: [],
                updatedAt: Date.now(),
                deleted: false
            };
            await savePlaylistToDB(newList);
            await loadPlaylists();
            showToast(`「${newList.name}」を作成しました`, 'success');
            autoSync();
        });
    }
}

async function loadPlaylists() {
    const allPl = await getAllPlaylistsFromDBRaw();
    appState.playlists = allPl.filter(p => !p.deleted);

    const tabsContainer = document.getElementById('playlist-tabs');
    if (!tabsContainer) return;

    // 既存のプレイリストタブを削除（すべてタブは残す）
    const existingTabs = tabsContainer.querySelectorAll('.playlist-tab:not(#library-all-btn)');
    existingTabs.forEach(t => t.remove());

    appState.playlists.forEach(pl => {
        const tab = document.createElement('button');
        tab.className = 'playlist-tab' + (appState.currentPlaylistId === pl.id ? ' active' : '');
        tab.dataset.id = pl.id;
        tab.innerHTML = `
            <span class="material-symbols-rounded">queue_music</span>
            <span>${pl.name}</span>
            <button class="tab-del" title="削除">
                <span class="material-symbols-rounded" style="font-size:10px;">close</span>
            </button>
        `;
        tab.addEventListener('click', (e) => {
            if (e.target.closest('.tab-del')) return;
            appState.currentPlaylistId = pl.id;
            document.getElementById('current-playlist-name').textContent = pl.name;
            appState.selectedMainTracks.clear();
            updateMainQueue();
            document.querySelectorAll('.playlist-tab').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');
        });
        tab.querySelector('.tab-del').addEventListener('click', (e) => {
            e.stopPropagation();
            deletePlaylist(pl.id, pl.name);
        });
        tabsContainer.appendChild(tab);
    });
}

function openAddToPlaylistModal(trackIdsArray) {
    if (appState.playlists.length === 0) {
        showToast('プレイリストがありません。先に作成してください', 'warning');
        return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    let listHtml = appState.playlists.map(pl =>
        `<div class="modal-playlist-item" data-id="${pl.id}">
            <span class="material-symbols-rounded">queue_music</span>${pl.name}
         </div>`
    ).join('');
    modal.innerHTML = `
        <div class="edit-modal-content" style="max-width:360px;">
            <div class="edit-modal-header">
                <h2 class="edit-modal-title">プレイリストに追加 <span style="font-size:12px;font-weight:400;color:var(--text-secondary);">${trackIdsArray.length}曲</span></h2>
                <button class="icon-btn" id="close-pl-modal"><span class="material-symbols-rounded">close</span></button>
            </div>
            <div style="padding:8px 16px 16px;max-height:280px;overflow-y:auto;">${listHtml}</div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#close-pl-modal').addEventListener('click', () => modal.remove());
    modal.querySelectorAll('.modal-playlist-item').forEach(item => {
        item.style.cssText = 'padding:10px 12px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background 0.15s;';
        item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-hover)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('click', async () => {
            await addTracksToPlaylist(item.getAttribute('data-id'), trackIdsArray);
            modal.remove();
        });
    });
}

async function addTracksToPlaylist(playlistId, trackIdsArray) {
    const pl = appState.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    let addedCount = 0;
    trackIdsArray.forEach(id => {
        if (!pl.trackIds.includes(id)) { pl.trackIds.push(id); addedCount++; }
    });
    if (addedCount === 0) { showToast('すでにすべての曲がリストに追加されています', 'warning'); return; }
    pl.updatedAt = Date.now();
    await savePlaylistToDB(pl);
    appState.selectedMainTracks.clear();
    await loadPlaylists();
    if (appState.currentPlaylistId === playlistId) updateMainQueue();
    showToast(`「${pl.name}」に ${addedCount}曲 追加しました`, 'success');
    autoSync();
}

async function removeTracksFromPlaylist(playlistId, trackIdsArray) {
    if (!confirm(`${trackIdsArray.length}曲をプレイリストから外しますか？`)) return;
    const pl = appState.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    pl.trackIds = pl.trackIds.filter(id => !trackIdsArray.includes(id));
    pl.updatedAt = Date.now();
    await savePlaylistToDB(pl);
    appState.selectedMainTracks.clear();
    await loadPlaylists();
    updateMainQueue();
    showToast('プレイリストから外しました');
    autoSync();
}

async function deletePlaylist(playlistId, playlistName) {
    if (!confirm(`プレイリスト「${playlistName}」を削除しますか？\n（曲データは残ります）`)) return;
    const pl = appState.playlists.find(p => p.id === playlistId);
    if (pl) { pl.deleted = true; pl.updatedAt = Date.now(); await savePlaylistToDB(pl); }
    await loadPlaylists();
    if (appState.currentPlaylistId === playlistId) {
        appState.currentPlaylistId = null;
        document.getElementById('current-playlist-name').textContent = 'すべての曲';
        const libraryAllBtn = document.getElementById('library-all-btn');
        if (libraryAllBtn) libraryAllBtn.classList.add('active');
        updateMainQueue();
    }
    showToast(`「${playlistName}」を削除しました`);
    autoSync();
}

// ─────────────────────────────────────────────
// 編集ページ（カードグリッド）
// ─────────────────────────────────────────────
function renderEditLibraryList() {
    const grid = document.getElementById('edit-library-list');
    const emptyEl = document.getElementById('edit-empty');
    if (!grid) return;
    grid.innerHTML = '';

    let displayTracks = appState.tracks;
    if (appState.searchQueryEdit) {
        displayTracks = displayTracks.filter(t =>
            t.title.toLowerCase().includes(appState.searchQueryEdit) ||
            (t.artist || '').toLowerCase().includes(appState.searchQueryEdit)
        );
    }

    if (emptyEl) emptyEl.classList.toggle('show', displayTracks.length === 0);

    displayTracks.forEach(track => {
        const card = document.createElement('div');
        card.className = 'edit-track-card';

        const art = document.createElement('div');
        art.className = 'edit-card-art';
        if (track.thumbnailDataUrl) {
            art.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
        } else {
            art.innerHTML = '<span class="material-symbols-rounded">music_note</span>';
        }

        let tagsHtml = '';
        if (track.tags && track.tags.length > 0) {
            tagsHtml = '<div class="edit-card-tags">' +
                track.tags.slice(0, 3).map(t => {
                    const tObj = typeof t === 'string' ? { text: t, color: '#ccc' } : t;
                    return `<span class="track-list-tag" style="border:1px solid ${tObj.color};background:${tObj.color}22;">${tObj.text}</span>`;
                }).join('') + '</div>';
        }

        card.innerHTML = `
            <div class="edit-card-title">${track.title}</div>
            <div class="edit-card-artist">${track.artist || '-'}</div>
            ${tagsHtml}
        `;
        card.insertBefore(art, card.firstChild);

        card.addEventListener('click', () => openEditModal([track.id]));
        grid.appendChild(card);
    });
}

// ─────────────────────────────────────────────
// 編集モーダル
// ─────────────────────────────────────────────
let editingTags = [];
let currentEditTrackIds = [];

function initEditPage() {
    const modal = document.getElementById('edit-modal');
    const closeBtn = document.getElementById('close-edit-modal');
    const cancelBtn = document.getElementById('close-edit-modal-cancel');
    const saveBtn = document.getElementById('save-metadata-btn');
    const thumbnailBtn = document.getElementById('edit-thumbnail-btn');
    const thumbnailInput = document.getElementById('edit-thumbnail-input');
    const thumbnailRemoveBtn = document.getElementById('edit-thumbnail-remove-btn');
    const thumbnailPreview = document.getElementById('edit-thumbnail-preview');
    const tagInput = document.getElementById('edit-tags-input');

    if (closeBtn) closeBtn.addEventListener('click', closeEditModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeEditModal);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeEditModal(); });

    // サムネイル変更
    if (thumbnailBtn) thumbnailBtn.addEventListener('click', () => thumbnailInput && thumbnailInput.click());
    if (thumbnailPreview) thumbnailPreview.addEventListener('click', () => thumbnailInput && thumbnailInput.click());

    // サムネイルドラッグ&ドロップ
    if (thumbnailPreview) {
        thumbnailPreview.addEventListener('dragover', (e) => { e.preventDefault(); thumbnailPreview.style.borderColor = 'var(--accent)'; });
        thumbnailPreview.addEventListener('dragleave', () => thumbnailPreview.style.borderColor = '');
        thumbnailPreview.addEventListener('drop', (e) => {
            e.preventDefault();
            thumbnailPreview.style.borderColor = '';
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) loadThumbnailFromFile(file);
        });
    }

    if (thumbnailInput) thumbnailInput.addEventListener('change', (e) => {
        if (e.target.files[0]) loadThumbnailFromFile(e.target.files[0]);
    });

    if (thumbnailRemoveBtn) thumbnailRemoveBtn.addEventListener('click', () => {
        const preview = document.getElementById('edit-thumbnail-preview');
        if (preview) {
            preview.style.backgroundImage = 'none';
            preview.innerHTML = '<span class="material-symbols-rounded">image</span>';
            preview.dataset.url = '';
        }
    });

    // タグ入力
    if (tagInput) {
        tagInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const tagText = tagInput.value.trim();
                if (tagText && !editingTags.find(t => t.text === tagText)) {
                    const existing = appState.allKnownTags.get(tagText);
                    const color = existing ? existing.color : getTagColorHex(tagText);
                    editingTags.push({ text: tagText, color });
                    renderModalTags();
                    tagInput.value = '';
                }
            }
        });
    }

    if (saveBtn) saveBtn.addEventListener('click', saveMetadata);
}

function loadThumbnailFromFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const preview = document.getElementById('edit-thumbnail-preview');
        if (preview) {
            preview.style.backgroundImage = `url(${e.target.result})`;
            preview.innerHTML = '';
            preview.dataset.url = e.target.result;
        }
    };
    reader.readAsDataURL(file);
}

function openEditModal(trackIds) {
    currentEditTrackIds = trackIds;
    const modal = document.getElementById('edit-modal');
    if (!modal) return;

    const isBulk = trackIds.length > 1;
    const infoEl = document.getElementById('edit-modal-info');
    if (infoEl) infoEl.textContent = isBulk ? `${trackIds.length}曲を一括編集` : '';

    const titleEl = document.getElementById('edit-modal-title');
    if (titleEl) titleEl.textContent = isBulk ? `${trackIds.length}曲を一括編集` : '情報を編集';

    const titleInput = document.getElementById('edit-title');
    const artistInput = document.getElementById('edit-artist');
    const dateInput = document.getElementById('edit-date');
    const preview = document.getElementById('edit-thumbnail-preview');

    if (isBulk) {
        if (titleInput) { titleInput.value = '（複数選択中 - 変更不可）'; titleInput.disabled = true; }
        if (artistInput) artistInput.value = '';
        if (dateInput) dateInput.value = '';
        editingTags = [];
        if (preview) { preview.style.backgroundImage = 'none'; preview.innerHTML = '<span class="material-symbols-rounded">library_music</span>'; preview.dataset.url = ''; }
    } else {
        const track = appState.tracks.find(t => t.id === trackIds[0]);
        if (!track) return;
        if (titleInput) { titleInput.value = track.title || ''; titleInput.disabled = false; }
        if (artistInput) artistInput.value = track.artist || '';
        if (dateInput) dateInput.value = track.date || '';
        editingTags = (track.tags || []).map(t => typeof t === 'string' ? { text: t, color: getTagColorHex(t) } : t);
        if (preview) {
            if (track.thumbnailDataUrl) {
                preview.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
                preview.innerHTML = '';
                preview.dataset.url = track.thumbnailDataUrl;
            } else {
                preview.style.backgroundImage = 'none';
                preview.innerHTML = '<span class="material-symbols-rounded">image</span>';
                preview.dataset.url = '';
            }
        }
    }

    renderModalTags();
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // 編集ページから呼ばれた場合はプレイヤーへ戻らない
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    currentEditTrackIds = [];
    editingTags = [];
}

function renderModalTags() {
    const list = document.getElementById('edit-tags-list');
    if (!list) return;
    list.innerHTML = '';
    editingTags.forEach((tagObj, index) => {
        const span = document.createElement('span');
        span.className = 'tag-item';
        span.style.border = `1px solid ${tagObj.color}`;
        span.style.backgroundColor = `${tagObj.color}33`;
        span.innerHTML = `
            <span class="tag-text-content" style="cursor:pointer;">${tagObj.text}</span>
            <span class="material-symbols-rounded remove-tag" data-index="${index}" style="font-size:14px;cursor:pointer;opacity:0.7;">close</span>
        `;
        span.querySelector('.tag-text-content').addEventListener('click', () => openTagEditModal(index));
        list.appendChild(span);
    });
    list.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            editingTags.splice(parseInt(e.target.getAttribute('data-index')), 1);
            renderModalTags();
        });
    });
}

function openTagEditModal(index) {
    const tagObj = editingTags[index];
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.zIndex = '600';
    modal.innerHTML = `
        <div class="edit-modal-content" style="max-width:320px;">
            <div class="edit-modal-header">
                <h2 class="edit-modal-title">タグを編集</h2>
                <button class="icon-btn" id="tag-modal-cancel-x"><span class="material-symbols-rounded">close</span></button>
            </div>
            <div style="padding:16px 24px;display:flex;flex-direction:column;gap:14px;">
                <div class="form-field">
                    <label class="form-label">タグ名</label>
                    <input type="text" id="modal-tag-name" class="form-input" value="${tagObj.text}">
                </div>
                <div class="form-field">
                    <label class="form-label">色</label>
                    <input type="color" id="modal-tag-color" value="${tagObj.color}" style="width:100%;height:36px;border:1px solid var(--border);border-radius:8px;padding:2px 4px;cursor:pointer;">
                </div>
            </div>
            <div class="edit-modal-footer">
                <span></span>
                <div class="edit-modal-btns">
                    <button class="action-btn" id="tag-modal-cancel">キャンセル</button>
                    <button class="action-btn primary" id="tag-modal-save">確定</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#tag-modal-cancel-x').addEventListener('click', () => modal.remove());
    modal.querySelector('#tag-modal-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#tag-modal-save').addEventListener('click', () => {
        const newText = modal.querySelector('#modal-tag-name').value.trim();
        const newColor = modal.querySelector('#modal-tag-color').value;
        if (newText) { editingTags[index] = { text: newText, color: newColor }; renderModalTags(); }
        modal.remove();
    });
}

async function saveMetadata() {
    if (currentEditTrackIds.length === 0) return;
    const isBulk = currentEditTrackIds.length > 1;
    const newArtist = document.getElementById('edit-artist').value.trim();
    const newDate = document.getElementById('edit-date').value;
    const preview = document.getElementById('edit-thumbnail-preview');
    const newThumbnail = preview ? preview.dataset.url : null;

    const tracksToUpdate = [];
    currentEditTrackIds.forEach(id => {
        const track = appState.tracks.find(t => t.id === id);
        if (track) {
            if (!isBulk) {
                track.title = document.getElementById('edit-title').value;
                track.artist = newArtist;
                track.date = newDate;
                track.tags = [...editingTags];
                if (newThumbnail !== undefined) track.thumbnailDataUrl = newThumbnail || null;
            } else {
                if (newArtist) track.artist = newArtist;
                if (newDate) track.date = newDate;
                let combinedTags = [...(track.tags || [])];
                editingTags.forEach(newTag => {
                    const exists = combinedTags.find(t => (typeof t === 'string' ? t : t.text) === newTag.text);
                    if (!exists) combinedTags.push(newTag);
                });
                track.tags = combinedTags;
            }
            track.updatedAt = Date.now();
            tracksToUpdate.push(track);
        }
    });

    for (let track of tracksToUpdate) await saveTrackToDB(track);

    showToast(`${tracksToUpdate.length}曲 の情報を保存しました`, 'success');
    await loadLibrary();
    renderEditLibraryList();
    closeEditModal();
    autoSync();
}

// 編集ページからの呼び出し（bulk edit from player page）
function openEditModal_fromPlayer(trackIds) {
    openEditModal(trackIds);
}

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function getTagColorHex(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '000000'.substring(0, 6 - c.length) + c;
}

