/**
 * app.js - Web Music Player (Redesigned)
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

// 再生速度の選択肢
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
let currentSpeedIndex = 2; // 1x

const appState = {
    tracks: [],
    playlists: [],
    currentQueue: [],
    currentTrackIndex: -1,
    isPlaying: false,
    allKnownTags: new Map(),
    currentPlaylistId: null,

    searchQueryMain: "",
    sortModeMain: "manual",
    selectedMainTracks: new Set(),

    searchQueryEdit: "",
    selectedEditTracks: new Set(),
    editingTags: [],

    isLoggedIn: false,
    user: null,
    isSyncing: false,
    isStreaming: false,

    loopMode: 'none',   // 'none' | 'one' | 'all'
    isShuffled: false,
    isQueueOpen: false,
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
    // PC用ナビ
    const navBtns = document.querySelectorAll('.nav-btn');
    const pages = document.querySelectorAll('.page-section');

    function switchPage(targetId) {
        navBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-target') === targetId));
        pages.forEach(p => p.classList.toggle('active', p.id === targetId));
        // スマホのボトムナビも同期
        document.querySelectorAll('.bottom-nav-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-target') === targetId);
        });

        appState.selectedMainTracks.clear();
        updateBulkActionBar();

        if (targetId === 'edit') renderEditLibraryList();
        if (targetId === 'log') updateLogPage();
    }

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => switchPage(btn.getAttribute('data-target')));
    });

    // スマホ用ボトムナビ
    document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchPage(btn.getAttribute('data-target')));
    });

    // ライブラリ「すべての曲」ボタン
    const libraryAllBtn = document.getElementById('library-all-btn');
    if (libraryAllBtn) {
        libraryAllBtn.addEventListener('click', () => {
            appState.currentPlaylistId = null;
            document.getElementById('current-playlist-name').textContent = 'すべての曲';
            appState.selectedMainTracks.clear();
            updateMainQueue();
            // プレイリストのactiveを解除
            document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
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
}

// ─────────────────────────────────────────────
// キーボードショートカット
// ─────────────────────────────────────────────
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

        switch(e.code) {
            case 'Space':
                e.preventDefault();
                togglePlay();
                break;
            case 'ArrowRight':
                e.preventDefault();
                playNext();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                playPrev();
                break;
            case 'ArrowUp':
                e.preventDefault();
                adjustVolume(5);
                break;
            case 'ArrowDown':
                e.preventDefault();
                adjustVolume(-5);
                break;
            case 'KeyL':
                cycleLoopMode();
                break;
            case 'KeyS':
                toggleShuffle();
                break;
        }
    });
}

function adjustVolume(delta) {
    const bar = document.getElementById('volume-bar');
    const fpBar = document.getElementById('fp-volume-bar');
    let val = Math.min(100, Math.max(0, parseInt(bar.value) + delta));
    bar.value = val;
    if (fpBar) fpBar.value = val;
    audioPlayer.volume = val / 100;
}

// ─────────────────────────────────────────────
// 再生キューパネル
// ─────────────────────────────────────────────
function initQueuePanel() {
    const btn = document.getElementById('ctrl-queue');
    const panel = document.getElementById('queue-panel');
    const closeBtn = document.getElementById('close-queue-btn');

    if (btn) btn.addEventListener('click', () => toggleQueuePanel());
    if (closeBtn) closeBtn.addEventListener('click', () => closeQueuePanel());
}

function toggleQueuePanel() {
    appState.isQueueOpen = !appState.isQueueOpen;
    const panel = document.getElementById('queue-panel');
    if (panel) panel.classList.toggle('open', appState.isQueueOpen);
    if (appState.isQueueOpen) renderQueuePanel();
}

function closeQueuePanel() {
    appState.isQueueOpen = false;
    const panel = document.getElementById('queue-panel');
    if (panel) panel.classList.remove('open');
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
            thumb.innerHTML = '<span class="material-symbols-outlined">music_note</span>';
        }

        li.innerHTML = `
            <span class="queue-item-num">${index + 1}</span>
        `;
        li.appendChild(thumb);
        const info = document.createElement('div');
        info.className = 'queue-item-info';
        info.innerHTML = `
            <div class="queue-item-title">${track.title}</div>
            <div class="queue-item-artist">${track.artist || '-'}</div>
        `;
        li.appendChild(info);
        li.addEventListener('click', () => playTrack(index));
        list.appendChild(li);
    });

    // 現在の曲へスクロール
    const currentEl = list.querySelector('.current');
    if (currentEl) currentEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ─────────────────────────────────────────────
// フルスクリーンプレイヤー（スマホ）
// ─────────────────────────────────────────────
function initFullscreenPlayer() {
    const player = document.getElementById('fullscreen-player');
    const globalPlayer = document.getElementById('global-player');
    const closeBtn = document.getElementById('fp-close-btn');

    // ミニプレイヤーをタップで展開（スマホのみ）
    if (globalPlayer) {
        globalPlayer.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                // ボタンクリックは除外
                if (e.target.closest('button') || e.target.closest('input')) return;
                openFullscreenPlayer();
            }
        });
    }

    if (closeBtn) closeBtn.addEventListener('click', closeFullscreenPlayer);

    // フルスクリーン内のコントロール
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

    if (fpSeek) {
        fpSeek.addEventListener('input', (e) => {
            if (audioPlayer.duration) audioPlayer.currentTime = (e.target.value / 100) * audioPlayer.duration;
        });
    }
    if (fpVolume) {
        fpVolume.addEventListener('input', (e) => {
            audioPlayer.volume = e.target.value / 100;
            const mainVol = document.getElementById('volume-bar');
            if (mainVol) mainVol.value = e.target.value;
        });
    }
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
    const title = document.getElementById('fp-title');
    const artist = document.getElementById('fp-artist');

    if (title) title.textContent = track ? track.title : '未選択';
    if (artist) artist.textContent = track ? (track.artist || '-') : '-';

    if (artwork) {
        if (track && track.thumbnailDataUrl) {
            artwork.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
            artwork.innerHTML = '';
        } else {
            artwork.style.backgroundImage = 'none';
            artwork.innerHTML = '<span class="material-symbols-outlined">music_note</span>';
        }
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
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = appState.loopMode === 'one' ? 'repeat_one' : 'repeat';
    });
}

function toggleShuffle() {
    appState.isShuffled = !appState.isShuffled;
    const btns = [document.getElementById('ctrl-shuffle'), document.getElementById('fp-shuffle')];
    btns.forEach(btn => {
        if (btn) btn.classList.toggle('active', appState.isShuffled);
    });
    showToast(appState.isShuffled ? 'シャッフルON' : 'シャッフルOFF');

    if (appState.isShuffled) {
        const sortSelect = document.getElementById('main-sort-select');
        if (sortSelect) { sortSelect.value = 'random'; }
        appState.sortModeMain = 'random';
        updateMainQueue();
    } else {
        const sortSelect = document.getElementById('main-sort-select');
        if (sortSelect) { sortSelect.value = 'manual'; }
        appState.sortModeMain = 'manual';
        updateMainQueue();
    }
}

function cycleSpeed() {
    currentSpeedIndex = (currentSpeedIndex + 1) % SPEED_OPTIONS.length;
    const speed = SPEED_OPTIONS[currentSpeedIndex];
    audioPlayer.playbackRate = speed;
    const label = speed === 1 ? '1x' : speed + 'x';

    const btns = [document.getElementById('ctrl-speed'), document.getElementById('fp-speed')];
    btns.forEach(btn => {
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

function initLogControls() {
    document.getElementById('log-period-select').addEventListener('change', updateLogPage);
    document.getElementById('log-category-select').addEventListener('change', updateLogPage);
}

async function updateLogPage() {
    const logs = await getAllLogsFromDB();
    const period = document.getElementById('log-period-select').value;
    const category = document.getElementById('log-category-select').value;

    const totalTracks = appState.tracks.length;
    const totalPlays = logs.length;
    const totalSeconds = logs.reduce((sum, log) => sum + log.duration, 0);

    document.getElementById('stat-total-tracks').textContent = `${totalTracks} 曲`;
    document.getElementById('stat-total-plays').textContent = `${totalPlays} 回`;
    document.getElementById('stat-total-time').textContent = formatLogTime(totalSeconds);

    const trackPlayTimes = {};
    logs.forEach(log => {
        trackPlayTimes[log.trackId] = (trackPlayTimes[log.trackId] || 0) + log.duration;
    });
    let topTrackId = null, maxTime = 0;
    for (const [id, time] of Object.entries(trackPlayTimes)) {
        if (time > maxTime) { maxTime = time; topTrackId = id; }
    }
    let topTrackName = '-';
    if (topTrackId) {
        const t = appState.tracks.find(x => x.id === topTrackId);
        topTrackName = t ? t.title : '不明な曲';
    }
    document.getElementById('stat-top-track').textContent = topTrackName;

    renderLogChart(logs, period, category);
}

function formatLogTime(seconds) {
    if (seconds < 60) return `${Math.floor(seconds)} 秒`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m} 分`;
    const h = Math.floor(m / 60);
    return `${h} 時間 ${m % 60} 分`;
}

function renderLogChart(allLogs, period, category) {
    const ctx = document.getElementById('logChart').getContext('2d');
    if (logChartInstance) logChartInstance.destroy();

    const now = Date.now();
    let filteredLogs = allLogs;
    if (period === 'day') filteredLogs = allLogs.filter(l => now - l.timestamp <= 86400000);
    else if (period === 'week') filteredLogs = allLogs.filter(l => now - l.timestamp <= 7 * 86400000);
    else if (period === 'month') filteredLogs = allLogs.filter(l => now - l.timestamp <= 30 * 86400000);
    else if (period === 'year') filteredLogs = allLogs.filter(l => now - l.timestamp <= 365 * 86400000);

    let labels = [], data = [], chartType = 'bar', xAxisLabel = '';

    if (category === 'total') {
        chartType = 'line';
        xAxisLabel = '期間';
        const grouped = {}, orderMap = {};
        filteredLogs.forEach(l => {
            const d = new Date(l.timestamp);
            let key;
            if (period === 'day') key = `${d.getHours()}時`;
            else if (period === 'week' || period === 'month') key = `${d.getMonth()+1}/${d.getDate()}`;
            else key = `${d.getFullYear()}年${d.getMonth()+1}月`;
            grouped[key] = (grouped[key] || 0) + l.duration;
            if (!orderMap[key] || l.timestamp < orderMap[key]) orderMap[key] = l.timestamp;
        });
        const sortedKeys = Object.keys(grouped).sort((a, b) => orderMap[a] - orderMap[b]);
        labels = sortedKeys;
        data = sortedKeys.map(k => (grouped[k] / 60).toFixed(1));
    } else {
        chartType = 'bar';
        const grouped = {};
        filteredLogs.forEach(l => {
            if (category === 'artist') {
                const key = l.artist || '不明';
                grouped[key] = (grouped[key] || 0) + l.duration;
            } else if (category === 'tag') {
                if (l.tags && l.tags.length > 0) {
                    l.tags.forEach(t => {
                        const text = typeof t === 'string' ? t : t.text;
                        grouped[text] = (grouped[text] || 0) + l.duration;
                    });
                } else {
                    grouped['タグなし'] = (grouped['タグなし'] || 0) + l.duration;
                }
            } else if (category === 'decade') {
                let yearStr = (l.date || '').match(/\d{4}/);
                let key = '不明';
                if (yearStr) {
                    const year = parseInt(yearStr[0]);
                    key = `${Math.floor(year / 10) * 10}年代`;
                }
                grouped[key] = (grouped[key] || 0) + l.duration;
            }
        });
        const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 20);
        labels = sorted.map(x => x[0]);
        data = sorted.map(x => (x[1] / 60).toFixed(1));
        xAxisLabel = category === 'artist' ? 'アーティスト' : category === 'tag' ? 'タグ' : '年代';
    }

    logChartInstance = new Chart(ctx, {
        type: chartType,
        data: {
            labels: labels.length > 0 ? labels : ['データなし'],
            datasets: [{
                label: '再生時間（分）',
                data: data.length > 0 ? data : [0],
                backgroundColor: 'rgba(0, 113, 227, 0.15)',
                borderColor: 'rgba(0, 113, 227, 0.8)',
                borderWidth: 2,
                borderRadius: 4,
                fill: chartType === 'line',
                tension: 0.4,
                pointRadius: chartType === 'line' ? 3 : 0,
                pointBackgroundColor: 'rgba(0, 113, 227, 1)',
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: '再生時間（分）', font: { size: 11 } },
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { font: { size: 11 } }
                },
                x: {
                    title: { display: true, text: xAxisLabel, font: { size: 11 } },
                    grid: { display: false },
                    ticks: { font: { size: 11 } }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(29,29,31,0.9)',
                    titleFont: { size: 12 },
                    bodyFont: { size: 11 },
                    padding: 10,
                    cornerRadius: 8,
                }
            }
        }
    });
}

// ─────────────────────────────────────────────
// Google ログイン & Drive連携
// ─────────────────────────────────────────────
function initAuthUI() {
    const btnLogin = document.getElementById('btn-login');
    const btnLogout = document.getElementById('btn-logout');

    btnLogin.addEventListener('click', () => {
        if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === 'ここに取得したクライアントIDを貼り付けます') {
            showToast('GOOGLE_CLIENT_ID を設定してください', 'error');
            return;
        }
        if (typeof google === 'undefined' || !google.accounts) {
            showToast('Google認証システムを読み込み中です。数秒後に再試行してください', 'warning');
            return;
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
        if (gapiAccessToken && typeof google !== 'undefined') {
            google.accounts.oauth2.revoke(gapiAccessToken, () => {});
        }
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
    })
    .then(res => res.json())
    .then(data => {
        appState.user = data;
        updateAuthUIDisplay();
        showToast(`${data.name} でログインしました`, 'success');
        autoSync();
    })
    .catch(err => console.error('ユーザー情報取得エラー:', err));
}

function updateAuthUIDisplay() {
    const btnLogin = document.getElementById('btn-login');
    const userInfo = document.getElementById('user-info');
    const userName = document.getElementById('user-name');

    if (appState.isLoggedIn && appState.user) {
        btnLogin.style.display = 'none';
        userInfo.style.display = 'flex';
        userName.textContent = appState.user.name || 'ユーザー';
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
                    if (rTrack.deleted) { delete rTrack.fileBlob; }
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
            if (!lPl) {
                await savePlaylistToDB(rPl);
                localPlaylistMap.set(rPl.id, rPl);
            } else {
                const rTime = rPl.updatedAt || 0, lTime = lPl.updatedAt || 0;
                if (rTime > lTime) { await savePlaylistToDB(rPl); localPlaylistMap.set(rPl.id, rPl); }
            }
        }

        if (syncStatus) syncStatus.textContent = '保存中...';
        const finalTracksToSync = Array.from(localTrackMap.values()).map(t => {
            const { fileBlob, ...rest } = t; return rest;
        });
        const syncData = {
            tracks: finalTracksToSync,
            playlists: Array.from(localPlaylistMap.values()),
            lastSyncedAt: Date.now()
        };
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
    } catch (e) {
        console.error('ファイルダウンロード失敗:', e);
    }
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
    document.getElementById('btn-play-all').addEventListener('click', () => {
        if (appState.currentQueue.length === 0) return;
        if (appState.sortModeMain === 'random') {
            const sortSelect = document.getElementById('main-sort-select');
            sortSelect.value = 'manual';
            sortSelect.dispatchEvent(new Event('change'));
        }
        playTrack(0);
    });
    document.getElementById('btn-shuffle-all').addEventListener('click', () => {
        if (appState.currentQueue.length === 0) return;
        const sortSelect = document.getElementById('main-sort-select');
        sortSelect.value = 'random';
        sortSelect.dispatchEvent(new Event('change'));
        playTrack(0);
    });
}

function initSearchAndSort() {
    const mainSearch = document.getElementById('main-search-input');
    if (mainSearch) {
        mainSearch.addEventListener('input', (e) => {
            appState.searchQueryMain = e.target.value.toLowerCase();
            updateMainQueue();
        });
    }
    const sortSelect = document.getElementById('main-sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            appState.sortModeMain = e.target.value;
            updateMainQueue();
        });
    }
    const selectAllCheckbox = document.getElementById('main-select-all');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) appState.currentQueue.forEach(t => appState.selectedMainTracks.add(t.id));
            else appState.selectedMainTracks.clear();
            renderMainTrackList();
        });
    }
    const editSearch = document.getElementById('edit-search-input');
    if (editSearch) {
        editSearch.addEventListener('input', (e) => {
            appState.searchQueryEdit = e.target.value.toLowerCase();
            renderEditLibraryList();
        });
    }
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
            const titleMatch = t.title.toLowerCase().includes(appState.searchQueryMain);
            const artistMatch = (t.artist || '').toLowerCase().includes(appState.searchQueryMain);
            const tagMatch = t.tags && t.tags.some(tag => {
                const text = typeof tag === 'string' ? tag : tag.text;
                return text.toLowerCase().includes(appState.searchQueryMain);
            });
            return titleMatch || artistMatch || tagMatch;
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

    playBtn.addEventListener('click', togglePlay);
    nextBtn.addEventListener('click', playNext);
    prevBtn.addEventListener('click', playPrev);
    if (loopBtn) loopBtn.addEventListener('click', cycleLoopMode);
    if (speedBtn) speedBtn.addEventListener('click', cycleSpeed);
    if (shuffleBtn) shuffleBtn.addEventListener('click', toggleShuffle);

    seekBar.addEventListener('input', (e) => {
        if (audioPlayer.duration) audioPlayer.currentTime = (e.target.value / 100) * audioPlayer.duration;
    });
    volumeBar.addEventListener('input', (e) => {
        audioPlayer.volume = e.target.value / 100;
        const fpVol = document.getElementById('fp-volume-bar');
        if (fpVol) fpVol.value = e.target.value;
    });
    audioPlayer.volume = volumeBar.value / 100;

    audioPlayer.addEventListener('timeupdate', () => {
        if (!audioPlayer.duration) return;
        const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;

        seekBar.value = pct;
        seekBar.style.background = `linear-gradient(to right, var(--accent-color) ${pct}%, var(--border-color) ${pct}%)`;

        const fpSeek = document.getElementById('fp-seek-bar');
        if (fpSeek) {
            fpSeek.value = pct;
            fpSeek.style.background = `linear-gradient(to right, var(--accent-color) ${pct}%, var(--border-color) ${pct}%)`;
        }

        const cur = formatTime(audioPlayer.currentTime);
        const tot = formatTime(audioPlayer.duration);
        document.getElementById('time-current').textContent = cur;
        document.getElementById('time-total').textContent = tot;
        const fpCur = document.getElementById('fp-time-current');
        const fpTot = document.getElementById('fp-time-total');
        if (fpCur) fpCur.textContent = cur;
        if (fpTot) fpTot.textContent = tot;
    });

    audioPlayer.addEventListener('ended', () => {
        stopPlaybackTracking();
        if (appState.loopMode === 'one') {
            audioPlayer.currentTime = 0;
            audioPlayer.play().then(() => {
                appState.isPlaying = true;
                startPlaybackTracking();
                updatePlayButtonUI();
            });
        } else if (appState.loopMode === 'all') {
            let nextIndex = appState.currentTrackIndex + 1;
            if (nextIndex >= appState.currentQueue.length) nextIndex = 0;
            playTrack(nextIndex);
        } else {
            if (appState.currentTrackIndex < appState.currentQueue.length - 1) {
                playNext();
            } else {
                appState.isPlaying = false;
                updatePlayButtonUI();
            }
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
    } else if (appState.isStreaming && !appState.isLoggedIn) {
        showToast('ストリーミング再生にはGoogleログインが必要です', 'error');
        return;
    } else {
        showToast('音声ファイルが見つかりません。同期を確認してください', 'error');
        return;
    }

    audioPlayer.playbackRate = SPEED_OPTIONS[currentSpeedIndex];

    audioPlayer.play()
        .then(() => {
            appState.isPlaying = true;
            updatePlayerUI(track);
            renderMainTrackList();
            if (appState.isQueueOpen) renderQueuePanel();
            startPlaybackTracking();
        })
        .catch(e => console.error('再生エラー:', e));
}

function togglePlay() {
    if (appState.currentQueue.length === 0) return;
    if (appState.isPlaying) {
        audioPlayer.pause();
        appState.isPlaying = false;
        stopPlaybackTracking();
    } else {
        if (audioPlayer.src) {
            audioPlayer.play().then(() => {
                appState.isPlaying = true;
                startPlaybackTracking();
            });
        } else {
            playTrack(0);
        }
    }
    updatePlayButtonUI();
    // 再生中アニメーションのクラス更新
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
    // 3秒以上再生していたら曲頭に戻る
    if (audioPlayer.currentTime > 3) {
        audioPlayer.currentTime = 0;
        return;
    }
    let prevIndex = appState.currentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = appState.currentQueue.length - 1;
    playTrack(prevIndex);
}

function updatePlayerUI(track) {
    document.getElementById('player-title').textContent = track.title;
    document.getElementById('player-artist').textContent = track.artist || '-';

    const thumbnail = document.getElementById('player-thumbnail');
    if (track.thumbnailDataUrl) {
        thumbnail.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
        thumbnail.innerHTML = '';
    } else {
        thumbnail.style.backgroundImage = 'none';
        thumbnail.innerHTML = '<span class="material-symbols-outlined">music_note</span>';
    }

    // フルスクリーンプレイヤーも更新
    updateFullscreenPlayer(track);
    updatePlayButtonUI();
}

function updatePlayButtonUI() {
    const icon = appState.isPlaying ? 'pause' : 'play_arrow';
    [document.getElementById('ctrl-play'), document.getElementById('fp-play')].forEach(btn => {
        if (btn) btn.querySelector('.material-symbols-outlined').textContent = icon;
    });
}

// ─────────────────────────────────────────────
// ドラッグ&ドロップ / ファイル読み込み
// ─────────────────────────────────────────────
function initDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-upload');

    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
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
                    } catch(e) {}
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
    updateSidebarLibraryCount();
    updateMainQueue();
    renderEditLibraryList();
}

function updateTagsDatalist() {
    let dl = document.getElementById('existing-tags-list');
    if (!dl) return;
    dl.innerHTML = '';
    appState.allKnownTags.forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag.text;
        dl.appendChild(opt);
    });
}

function updateSidebarLibraryCount() {
    const btn = document.getElementById('library-all-btn');
    if (btn) btn.textContent = `すべての曲 (${appState.tracks.length})`;
    // アイコンを再追加
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = 'library_music';
    if (btn) btn.insertBefore(icon, btn.firstChild);
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
        if (isCurrentTrack) {
            li.classList.add(appState.isPlaying ? 'playing' : 'paused');
        }

        if (appState.sortModeMain === 'manual') {
            li.draggable = true;
            li.style.cursor = 'grab';
            li.addEventListener('dragstart', (e) => {
                draggedItemIndex = index;
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => li.style.opacity = '0.5', 0);
            });
            li.addEventListener('dragend', () => {
                li.style.opacity = '1';
                draggedItemIndex = null;
            });
            li.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                li.style.outline = '2px solid var(--accent-color)';
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
        if (track.thumbnailDataUrl) {
            thumb.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
        } else {
            thumb.innerHTML = '<span class="material-symbols-outlined">music_note</span>';
        }
        // 再生中アニメーション
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
                    return `<span class="track-list-tag" style="border:1px solid ${tObj.color};background-color:${tObj.color}33;" title="${tObj.text}">${tObj.text}</span>`;
                }).join('') + '</div>';
        }
        info.innerHTML = `
            <div class="track-list-title">${track.title}</div>
            <div class="track-list-artist">${track.artist || '-'}</div>
            ${tagsHtml}
        `;

        // アクションボタン
        const actions = document.createElement('div');
        actions.className = 'track-actions';

        const addBtn = document.createElement('button');
        addBtn.className = 'icon-btn';
        addBtn.title = 'プレイリストに追加';
        addBtn.innerHTML = '<span class="material-symbols-outlined">playlist_add</span>';
        addBtn.addEventListener('click', (e) => { e.stopPropagation(); openAddToPlaylistModal([track.id]); });

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn';
        editBtn.title = '情報を編集';
        editBtn.innerHTML = '<span class="material-symbols-outlined">edit</span>';
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); jumpToEdit([track.id]); });

        actions.appendChild(addBtn);
        actions.appendChild(editBtn);

        if (appState.currentPlaylistId) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'icon-btn';
            removeBtn.title = 'このリストから外す';
            removeBtn.innerHTML = '<span class="material-symbols-outlined">playlist_remove</span>';
            removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeTracksFromPlaylist(appState.currentPlaylistId, [track.id]); });
            actions.appendChild(removeBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn';
        deleteBtn.title = '完全削除';
        deleteBtn.innerHTML = '<span class="material-symbols-outlined" style="color:var(--danger-color)">delete_forever</span>';
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

    if (count > 0) {
        bar.classList.add('active');
        countSpan.textContent = `${count}曲を選択中`;
        const btnRemove = document.getElementById('bulk-remove-playlist-btn');
        if (btnRemove) btnRemove.style.display = appState.currentPlaylistId ? 'inline-flex' : 'none';
    } else {
        bar.classList.remove('active');
    }
}

function jumpToEdit(trackIdsArray) {
    appState.selectedEditTracks.clear();
    trackIdsArray.forEach(id => appState.selectedEditTracks.add(id));
    const editTabBtn = document.querySelector('.nav-btn[data-target="edit"]');
    if (editTabBtn) editTabBtn.click();
}

function initBulkActions() {
    document.getElementById('bulk-add-playlist-btn').addEventListener('click', () => {
        openAddToPlaylistModal(Array.from(appState.selectedMainTracks));
    });
    document.getElementById('bulk-edit-btn').addEventListener('click', () => {
        jumpToEdit(Array.from(appState.selectedMainTracks));
    });
    document.getElementById('bulk-remove-playlist-btn').addEventListener('click', () => {
        if (appState.currentPlaylistId) removeTracksFromPlaylist(appState.currentPlaylistId, Array.from(appState.selectedMainTracks));
    });
    document.getElementById('bulk-delete-btn').addEventListener('click', () => {
        deleteTracksCompletely(Array.from(appState.selectedMainTracks));
    });
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
        let track = tracks.find(t => t.id === id);
        if (track) {
            track.deleted = true;
            track.updatedAt = Date.now();
            delete track.fileBlob;
            await saveTrackToDB(track);
        }
    }

    appState.selectedMainTracks.clear();
    appState.selectedEditTracks.clear();
    showToast(`${trackIds.length}曲 を削除しました`);
    await loadPlaylists();
    await loadLibrary();
    autoSync();
}

// ─────────────────────────────────────────────
// プレイリスト
// ─────────────────────────────────────────────
function initPlaylists() {
    document.getElementById('create-playlist-btn').addEventListener('click', async () => {
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

async function loadPlaylists() {
    const allPl = await getAllPlaylistsFromDBRaw();
    appState.playlists = allPl.filter(p => !p.deleted);

    const container = document.getElementById('playlists-container');
    container.innerHTML = '';

    appState.playlists.forEach(pl => {
        const li = document.createElement('li');
        li.className = 'playlist-item' + (appState.currentPlaylistId === pl.id ? ' active' : '');

        const label = document.createElement('div');
        label.className = 'playlist-item-label';
        label.innerHTML = `<span class="material-symbols-outlined">queue_music</span>${pl.name} <span style="color:var(--text-tertiary);font-size:11px;margin-left:2px;">(${pl.trackIds.length})</span>`;

        const delBtn = document.createElement('span');
        delBtn.className = 'material-symbols-outlined remove-playlist';
        delBtn.textContent = 'delete';
        delBtn.title = 'プレイリストを削除';
        delBtn.addEventListener('click', (e) => { e.stopPropagation(); deletePlaylist(pl.id, pl.name); });

        li.appendChild(label);
        li.appendChild(delBtn);

        li.addEventListener('click', () => {
            appState.currentPlaylistId = pl.id;
            document.getElementById('current-playlist-name').textContent = pl.name;
            appState.selectedMainTracks.clear();
            updateMainQueue();

            // activeの更新
            document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            const libraryAllBtn = document.getElementById('library-all-btn');
            if (libraryAllBtn) libraryAllBtn.classList.remove('active');
        });

        container.appendChild(li);
    });
}

function openAddToPlaylistModal(trackIdsArray) {
    if (appState.playlists.length === 0) {
        showToast('プレイリストがありません。先に作成してください', 'warning');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';

    let listHtml = '';
    appState.playlists.forEach(pl => {
        listHtml += `<div class="modal-playlist-item" data-id="${pl.id}">
            <span class="material-symbols-outlined">queue_music</span>${pl.name}
        </div>`;
    });

    modal.innerHTML = `
        <div class="modal-content">
            <h3>プレイリストに追加<span style="font-size:12px;font-weight:400;color:var(--text-secondary);margin-left:6px;">${trackIdsArray.length}曲</span></h3>
            <div style="max-height:220px;overflow-y:auto;margin:4px -8px;">${listHtml}</div>
            <div style="display:flex;justify-content:flex-end;">
                <button id="close-pl-modal" class="secondary-btn">キャンセル</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('close-pl-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelectorAll('.modal-playlist-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            await addTracksToPlaylist(e.currentTarget.getAttribute('data-id'), trackIdsArray);
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
    if (addedCount === 0) {
        showToast('すでにすべての曲がリストに追加されています', 'warning');
        return;
    }
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
    if (pl) {
        pl.deleted = true;
        pl.updatedAt = Date.now();
        await savePlaylistToDB(pl);
    }
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
// 編集ページ
// ─────────────────────────────────────────────
function renderEditLibraryList() {
    const list = document.getElementById('edit-library-list');
    list.innerHTML = '';

    let displayTracks = appState.tracks;
    if (appState.searchQueryEdit) {
        displayTracks = displayTracks.filter(t =>
            t.title.toLowerCase().includes(appState.searchQueryEdit) ||
            (t.artist || '').toLowerCase().includes(appState.searchQueryEdit)
        );
    }

    const countEl = document.getElementById('edit-selected-count');
    if (countEl) countEl.textContent = appState.selectedEditTracks.size > 0 ? `${appState.selectedEditTracks.size}曲を選択中` : '曲を選択して編集';

    displayTracks.forEach(track => {
        const li = document.createElement('li');
        li.className = 'edit-list-item' + (appState.selectedEditTracks.has(track.id) ? ' selected' : '');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'custom-checkbox';
        checkbox.checked = appState.selectedEditTracks.has(track.id);
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) appState.selectedEditTracks.add(track.id);
            else appState.selectedEditTracks.delete(track.id);
            checkEditFormState();
            renderEditLibraryList();
        });

        const content = document.createElement('div');
        content.className = 'edit-list-content';
        let tagsHtml = '';
        if (track.tags && track.tags.length > 0) {
            tagsHtml = `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px;">` +
                track.tags.map(t => {
                    const text = typeof t === 'string' ? t : t.text;
                    const color = typeof t === 'string' ? '#ccc' : t.color;
                    return `<span class="track-list-tag" style="border:1px solid ${color};background-color:${color}33;">${text}</span>`;
                }).join('') + `</div>`;
        }
        content.innerHTML = `
            <div class="edit-list-title">${track.title}</div>
            <div style="font-size:11px;color:var(--text-secondary);">${track.artist || '-'}</div>
            ${tagsHtml}
        `;
        content.addEventListener('click', () => { checkbox.click(); });

        li.appendChild(checkbox);
        li.appendChild(content);
        list.appendChild(li);
    });

    checkEditFormState();
}

function checkEditFormState() {
    const formArea = document.getElementById('edit-form-area');
    const placeholder = document.getElementById('edit-placeholder');
    const countEl = document.getElementById('edit-selected-count');

    if (countEl) countEl.textContent = appState.selectedEditTracks.size > 0 ? `${appState.selectedEditTracks.size}曲を選択中` : '曲を選択して編集';

    if (appState.selectedEditTracks.size === 1) {
        formArea.style.display = 'flex';
        if (placeholder) placeholder.style.display = 'none';
        const singleId = Array.from(appState.selectedEditTracks)[0];
        const t = appState.tracks.find(x => x.id === singleId);
        openEditForm(t);
    } else if (appState.selectedEditTracks.size > 1) {
        formArea.style.display = 'flex';
        if (placeholder) placeholder.style.display = 'none';
        openBulkEditForm();
    } else {
        formArea.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
    }
}

function openEditForm(track) {
    document.getElementById('edit-title').value = track.title || '';
    document.getElementById('edit-title').disabled = false;
    document.getElementById('edit-artist').value = track.artist || '';
    document.getElementById('edit-date').value = track.date || '';

    appState.editingTags = (track.tags || []).map(t =>
        typeof t === 'string' ? { text: t, color: getTagColorHex(t) } : t
    );
    renderEditTags();

    const preview = document.getElementById('edit-thumbnail-preview');
    if (track.thumbnailDataUrl) {
        preview.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
        preview.innerHTML = '';
    } else {
        preview.style.backgroundImage = 'none';
        preview.innerHTML = '<span class="material-symbols-outlined">image</span>';
    }
}

function openBulkEditForm() {
    document.getElementById('edit-title').value = '（複数選択中 - 変更不可）';
    document.getElementById('edit-title').disabled = true;
    document.getElementById('edit-artist').value = '';
    document.getElementById('edit-date').value = '';
    appState.editingTags = [];
    renderEditTags();
    const preview = document.getElementById('edit-thumbnail-preview');
    preview.style.backgroundImage = 'none';
    preview.innerHTML = '<span class="material-symbols-outlined">library_music</span>';
}

function getTagColorHex(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '000000'.substring(0, 6 - c.length) + c;
}

function initEditPage() {
    const tagInput = document.getElementById('edit-tags-input');
    tagInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const tagText = tagInput.value.trim();
            if (tagText && !appState.editingTags.find(t => t.text === tagText)) {
                const existing = appState.allKnownTags.get(tagText);
                const color = existing ? existing.color : getTagColorHex(tagText);
                appState.editingTags.push({ text: tagText, color });
                renderEditTags();
                tagInput.value = '';
            }
        }
    });

    document.getElementById('save-metadata-btn').addEventListener('click', async () => {
        if (appState.selectedEditTracks.size === 0) return;
        const isBulk = appState.selectedEditTracks.size > 1;
        const newArtist = document.getElementById('edit-artist').value.trim();
        const newDate = document.getElementById('edit-date').value;

        const tracksToUpdate = [];
        appState.selectedEditTracks.forEach(id => {
            const track = appState.tracks.find(t => t.id === id);
            if (track) {
                if (!isBulk) {
                    track.title = document.getElementById('edit-title').value;
                    track.artist = newArtist;
                    track.date = newDate;
                    track.tags = [...appState.editingTags];
                } else {
                    if (newArtist) track.artist = newArtist;
                    if (newDate) track.date = newDate;
                    let combinedTags = [...(track.tags || [])];
                    appState.editingTags.forEach(newTag => {
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
        appState.selectedEditTracks.clear();
        renderEditLibraryList();
        checkEditFormState();
        autoSync();
    });
}

function renderEditTags() {
    const list = document.getElementById('edit-tags-list');
    list.innerHTML = '';
    appState.editingTags.forEach((tagObj, index) => {
        const span = document.createElement('span');
        span.className = 'tag-item';
        span.style.border = `1px solid ${tagObj.color}`;
        span.style.backgroundColor = `${tagObj.color}33`;
        span.title = tagObj.text;
        span.innerHTML = `
            <span class="tag-text-content">${tagObj.text}</span>
            <span class="material-symbols-outlined remove-tag" data-index="${index}">close</span>
        `;
        span.querySelector('.tag-text-content').addEventListener('click', (e) => {
            e.stopPropagation();
            openTagEditModal(index);
        });
        list.appendChild(span);
    });

    document.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            appState.editingTags.splice(parseInt(e.target.getAttribute('data-index')), 1);
            renderEditTags();
        });
    });
}

function openTagEditModal(index) {
    const tagObj = appState.editingTags[index];
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>タグを編集</h3>
            <div class="form-group">
                <label>タグ名</label>
                <input type="text" id="modal-tag-name" value="${tagObj.text}">
            </div>
            <div class="form-group">
                <label>色</label>
                <input type="color" id="modal-tag-color" value="${tagObj.color}" style="border:none;width:100%;height:36px;padding:0;cursor:pointer;border-radius:var(--radius-sm);">
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
                <button id="modal-cancel" class="secondary-btn">キャンセル</button>
                <button id="modal-save" class="primary-btn">確定</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.getElementById('modal-cancel').addEventListener('click', () => modal.remove());
    document.getElementById('modal-save').addEventListener('click', () => {
        const newText = document.getElementById('modal-tag-name').value.trim();
        const newColor = document.getElementById('modal-tag-color').value;
        if (newText) {
            appState.editingTags[index] = { text: newText, color: newColor };
            renderEditTags();
        }
        modal.remove();
    });
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
