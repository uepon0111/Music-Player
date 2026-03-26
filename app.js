// ==========================================
// 1. グローバル状態と定数
// ==========================================
const AppState = {
    playlist: [],          // 再生リスト
    currentTrackIndex: -1, // 現在再生中の曲のインデックス
    isPlaying: false,      // 再生状態
    isGoogleLoggedIn: false, // Googleログイン状態
    driveFolderId: null    // 専用のGoogle DriveフォルダID
};

// Google API設定 (※ご自身の取得したものに書き換えてください)
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
const GOOGLE_API_KEY = 'YOUR_API_KEY';
const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

// ==========================================
// 2. IndexedDB (ローカルキャッシュ) の設定
// ==========================================
let db;
const DB_NAME = 'CloudAudioPlayerDB';
const DB_VERSION = 1;

function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            // 音声ファイル本体を保存するストア
            if (!database.objectStoreNames.contains('audioFiles')) {
                database.createObjectStore('audioFiles', { keyPath: 'id' });
            }
            // メタデータや統計ログを保存するストア
            if (!database.objectStoreNames.contains('metadata')) {
                const metaStore = database.createObjectStore('metadata', { keyPath: 'id' });
                metaStore.createIndex('addedAt', 'addedAt', { unique: false });
            }
            if (!database.objectStoreNames.contains('logs')) {
                const logStore = database.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
                logStore.createIndex('date', 'date', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('<i class="fa-solid fa-database"></i> IndexedDB initialized.');
            resolve();
        };

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.error);
            reject(event.target.error);
        };
    });
}

// ==========================================
// 3. Google Drive API 連携
// ==========================================
let tokenClient;
let gapiInited = false;
let gisInited = false;

// index.htmlで読み込まれたgapiの初期化
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: GOOGLE_API_KEY,
            discoveryDocs: DISCOVERY_DOCS,
        });
        gapiInited = true;
        checkAuthSetup();
    } catch (err) {
        console.error('Error initializing GAPI client', err);
    }
}

// index.htmlで読み込まれたGoogle Identity Servicesの初期化
function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: '', // 認証後に動的に設定
    });
    gisInited = true;
    checkAuthSetup();
}

function checkAuthSetup() {
    if (gapiInited && gisInited) {
        const authBtn = document.getElementById('auth-btn');
        authBtn.addEventListener('click', handleAuthClick);
    }
}

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        AppState.isGoogleLoggedIn = true;
        updateAuthUI(true);
        await ensureDriveFolder();
        await loadDriveFiles();
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

function updateAuthUI(isLoggedIn) {
    const statusText = document.getElementById('auth-status');
    const authBtn = document.getElementById('auth-btn');
    if (isLoggedIn) {
        statusText.className = 'status-text text-online';
        statusText.innerHTML = '<i class="fa-solid fa-cloud"></i> ドライブ同期中';
        authBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> <span>ログアウト</span>';
        authBtn.onclick = handleSignoutClick;
    } else {
        statusText.className = 'status-text text-offline';
        statusText.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> ローカルモード';
        authBtn.innerHTML = '<i class="fa-brands fa-google"></i> <span>ログイン</span>';
        authBtn.onclick = handleAuthClick;
    }
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken('');
            AppState.isGoogleLoggedIn = false;
            AppState.driveFolderId = null;
            updateAuthUI(false);
            // ローカルモードへの切り替え処理（キャッシュ読み込み等）をここに記述
        });
    }
}

// Drive内に専用フォルダ「AudioApp_Data」があるか確認し、なければ作成する
async function ensureDriveFolder() {
    const folderName = 'AudioApp_Data';
    try {
        const response = await gapi.client.drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });
        
        const files = response.result.files;
        if (files && files.length > 0) {
            AppState.driveFolderId = files[0].id;
        } else {
            const folderMetadata = {
                'name': folderName,
                'mimeType': 'application/vnd.google-apps.folder'
            };
            const createResponse = await gapi.client.drive.files.create({
                resource: folderMetadata,
                fields: 'id'
            });
            AppState.driveFolderId = createResponse.result.id;
        }
    } catch (err) {
        console.error('Error ensuring Drive folder:', err);
    }
}

// ==========================================
// 4. UI 制御 (タブ切り替え・ドラッグ＆ドロップ)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initIndexedDB();
    
    // タブ（ビュー）の切り替え
    const navLinks = document.querySelectorAll('.nav-links li');
    const views = document.querySelectorAll('.view-section');

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navLinks.forEach(n => n.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));
            
            link.classList.add('active');
            const targetId = link.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // ドラッグ＆ドロップの設定
    const dropZone = document.getElementById('drop-zone');
    const dropOverlay = document.getElementById('drop-overlay');

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropOverlay.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropOverlay.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropOverlay.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            handleFilesSelected(e.dataTransfer.files);
        }
    });

    // ファイル追加ボタンの設定
    const fileInput = document.getElementById('file-input');
    const addFileBtn = document.getElementById('add-file-btn');
    
    addFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFilesSelected(e.target.files);
        }
    });
});

// ファイル選択時の処理（次回詳細実装）
function handleFilesSelected(files) {
    const modal = document.getElementById('upload-modal');
    const list = document.getElementById('upload-files-list');
    list.innerHTML = ''; // リスト初期化
    
    Array.from(files).forEach(file => {
        if(file.type.startsWith('audio/')) {
            const item = document.createElement('div');
            item.textContent = file.name;
            list.appendChild(item);
        }
    });
    
    modal.classList.remove('hidden');
    
    document.getElementById('btn-upload-cancel').onclick = () => {
        modal.classList.add('hidden');
        document.getElementById('file-input').value = '';
    };
    
    document.getElementById('btn-upload-confirm').onclick = () => {
        // 次回実装：ファイルのパースとメタデータ取得、DB保存、Google Driveアップロード
        modal.classList.add('hidden');
        processAndAddFiles(files); 
    };
}
// ==========================================
// 5. ファイル処理とメタデータ抽出 (jsmediatags使用)
// ==========================================
async function processAndAddFiles(files) {
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('audio/')) continue;

        // jsmediatagsを使用してID3タグを読み込む
        jsmediatags.read(file, {
            onSuccess: async function(tag) {
                const tags = tag.tags;
                const trackData = createTrackData(file, tags);
                await saveTrack(trackData);
            },
            onError: async function(error) {
                console.warn('Metadata not found for', file.name);
                const trackData = createTrackData(file, {});
                await saveTrack(trackData);
            }
        });
    }
}

function createTrackData(file, tags) {
    const trackData = {
        id: crypto.randomUUID(), // 一意のIDを生成
        file: file, // 実際のファイルオブジェクト
        title: tags.title || file.name.replace(/\.[^/.]+$/, ""),
        artist: tags.artist || 'Unknown Artist',
        duration: 0, // 読み込み時に更新
        addedAt: Date.now(),
        date: tags.year || 'Unknown',
        tags: [], 
        coverUrl: 'default-cover.jpg'
    };

    // サムネイル画像のパース
    if (tags.picture) {
        const { data, format } = tags.picture;
        let base64String = "";
        for (let j = 0; j < data.length; j++) {
            base64String += String.fromCharCode(data[j]);
        }
        trackData.coverUrl = `data:${format};base64,${window.btoa(base64String)}`;
    }
    return trackData;
}

async function saveTrack(trackData) {
    // IndexedDBに保存
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['audioFiles', 'metadata'], 'readwrite');
        const audioStore = transaction.objectStore('audioFiles');
        const metaStore = transaction.objectStore('metadata');

        audioStore.put({ id: trackData.id, file: trackData.file });
        
        // ファイル本体を除外してメタデータのみ保存
        const { file, ...meta } = trackData;
        metaStore.put(meta);

        transaction.oncomplete = () => {
            AppState.playlist.push(meta);
            renderPlaylist();
            resolve();
        };
        transaction.onerror = (e) => reject(e.target.error);
    });
}

// ==========================================
// 6. 再生リストの描画と並べ替え
// ==========================================
function renderPlaylist() {
    const playlistEl = document.getElementById('playlist');
    playlistEl.innerHTML = '';

    AppState.playlist.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'playlist-item';
        if (index === AppState.currentTrackIndex) li.style.backgroundColor = 'var(--hover-color)';
        
        li.innerHTML = `
            <i class="fa-solid fa-music text-secondary"></i>
            <div class="info">
                <div class="title">${track.title}</div>
                <div class="artist">${track.artist}</div>
            </div>
            <div class="actions">
                <button class="btn icon-btn play-track-btn" data-index="${index}"><i class="fa-solid fa-play"></i></button>
                <button class="btn icon-btn edit-track-btn" data-id="${track.id}"><i class="fa-solid fa-pen"></i></button>
                <button class="btn icon-btn danger delete-track-btn" data-id="${track.id}"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        playlistEl.appendChild(li);
    });

    attachPlaylistEvents();
    updateCharts(); // リスト更新時にグラフも更新
}

function attachPlaylistEvents() {
    document.querySelectorAll('.play-track-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.currentTarget.getAttribute('data-index'));
            playTrack(index);
        });
    });

    document.querySelectorAll('.delete-track-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            await deleteTrack(id);
        });
    });

    // エディターへの遷移は第4回で実装
}

// 並べ替えロジック
document.getElementById('sort-select').addEventListener('change', (e) => {
    const [key, order] = e.target.value.split('_');
    AppState.playlist.sort((a, b) => {
        let valA = a[key === 'name' ? 'title' : key];
        let valB = b[key === 'name' ? 'title' : key];
        
        if (valA < valB) return order === 'asc' ? -1 : 1;
        if (valA > valB) return order === 'asc' ? 1 : -1;
        return 0;
    });
    renderPlaylist();
});

document.getElementById('shuffle-btn').addEventListener('click', () => {
    for (let i = AppState.playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [AppState.playlist[i], AppState.playlist[j]] = [AppState.playlist[j], AppState.playlist[i]];
    }
    renderPlaylist();
});

async function deleteTrack(id) {
    // キャッシュからの削除
    const transaction = db.transaction(['audioFiles', 'metadata'], 'readwrite');
    transaction.objectStore('audioFiles').delete(id);
    transaction.objectStore('metadata').delete(id);
    
    transaction.oncomplete = () => {
        AppState.playlist = AppState.playlist.filter(t => t.id !== id);
        renderPlaylist();
    };
    
    // Google Driveから削除（ログイン時）
    if (AppState.isGoogleLoggedIn) {
        // ※ドライブ上のファイルIDがマッピングされている前提。実装の簡略化のためここでは省略します。
        console.log("Deleted from local cache.");
    }
}

// ==========================================
// 7. オーディオプレイヤー制御
// ==========================================
const audioPlayer = new Audio();
const playBtn = document.getElementById('play-btn');
const seekBar = document.getElementById('seek-bar');
const volumeBar = document.getElementById('volume-bar');
let playbackLogTimer = null; // ログ記録用タイマー

audioPlayer.addEventListener('timeupdate', () => {
    if (!isNaN(audioPlayer.duration)) {
        seekBar.value = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        document.getElementById('time-current').textContent = formatTime(audioPlayer.currentTime);
    }
});

audioPlayer.addEventListener('loadedmetadata', () => {
    document.getElementById('time-total').textContent = formatTime(audioPlayer.duration);
    // 初回ロード時にDBのdurationを更新
    if (AppState.playlist[AppState.currentTrackIndex].duration === 0) {
        AppState.playlist[AppState.currentTrackIndex].duration = audioPlayer.duration;
        saveTrack(AppState.playlist[AppState.currentTrackIndex]); // DB更新
    }
});

audioPlayer.addEventListener('ended', () => {
    playNextTrack();
});

async function playTrack(index) {
    if (index < 0 || index >= AppState.playlist.length) return;
    
    AppState.currentTrackIndex = index;
    const trackMeta = AppState.playlist[index];
    
    // DBから音声ファイル本体を取得
    const transaction = db.transaction(['audioFiles'], 'readonly');
    const store = transaction.objectStore('audioFiles');
    const request = store.get(trackMeta.id);
    
    request.onsuccess = () => {
        if (request.result && request.result.file) {
            const fileUrl = URL.createObjectURL(request.result.file);
            audioPlayer.src = fileUrl;
            audioPlayer.play();
            AppState.isPlaying = true;
            updatePlayerUI(trackMeta);
            startPlaybackLogging(trackMeta);
        }
    };
}

function togglePlay() {
    if (audioPlayer.src) {
        if (audioPlayer.paused) {
            audioPlayer.play();
            AppState.isPlaying = true;
        } else {
            audioPlayer.pause();
            AppState.isPlaying = false;
        }
        updatePlayButton();
    }
}

function playNextTrack() {
    let nextIndex = AppState.currentTrackIndex + 1;
    if (nextIndex >= AppState.playlist.length) nextIndex = 0; // ループ
    playTrack(nextIndex);
}

function playPrevTrack() {
    let prevIndex = AppState.currentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = AppState.playlist.length - 1;
    playTrack(prevIndex);
}

function updatePlayerUI(track) {
    document.getElementById('current-title').textContent = track.title;
    document.getElementById('current-artist').textContent = track.artist;
    document.getElementById('current-thumb').src = track.coverUrl;
    updatePlayButton();
    renderPlaylist(); // リストのハイライト更新
}

function updatePlayButton() {
    playBtn.innerHTML = AppState.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// コントロールイベント
playBtn.addEventListener('click', togglePlay);
document.getElementById('next-btn').addEventListener('click', playNextTrack);
document.getElementById('prev-btn').addEventListener('click', playPrevTrack);

seekBar.addEventListener('input', () => {
    const time = (seekBar.value / 100) * audioPlayer.duration;
    audioPlayer.currentTime = time;
});

volumeBar.addEventListener('input', () => {
    audioPlayer.volume = volumeBar.value / 100;
});

// ==========================================
// 8. 統計ログの記録とChart.js描画
// ==========================================
function startPlaybackLogging(track) {
    clearInterval(playbackLogTimer);
    // 10秒ごとにログDBに10秒再生したことを記録する
    playbackLogTimer = setInterval(() => {
        if (!audioPlayer.paused) {
            logPlayback(track, 10);
        }
    }, 10000);
}

function logPlayback(track, seconds) {
    const transaction = db.transaction(['logs'], 'readwrite');
    const store = transaction.objectStore('logs');
    store.add({
        trackId: track.id,
        artist: track.artist,
        date: track.date, // 年代
        tags: track.tags,
        durationPlayed: seconds,
        timestamp: Date.now()
    });
    
    transaction.oncomplete = () => {
        // リアルタイムでグラフを更新したい場合は呼び出す
        // updateCharts(); 
    };
}

// グラフの初期化と更新 (Chart.js)
let charts = {};

function initCharts() {
    const ctxTotal = document.getElementById('chart-total').getContext('2d');
    charts.total = new Chart(ctxTotal, { type: 'bar', data: { labels: [], datasets: [{ label: '再生時間 (秒)', data: [], backgroundColor: 'rgba(98, 0, 238, 0.5)' }] }});
    
    const ctxArtist = document.getElementById('chart-artist').getContext('2d');
    charts.artist = new Chart(ctxArtist, { type: 'pie', data: { labels: [], datasets: [{ data: [], backgroundColor: ['#6200ee', '#03dac6', '#cf6679', '#bb86fc', '#018786'] }] }});
}

async function updateCharts() {
    if (!charts.total) initCharts();
    
    // DBからログを集計してグラフに反映させる処理
    // ※今回はサンプルとして、現在playlistにある曲の長さを元にモックデータを描画します
    // 本格的な集計はDBの'logs'ストアから期間を指定してフィルタリングします。
    
    const artists = {};
    AppState.playlist.forEach(t => {
        artists[t.artist] = (artists[t.artist] || 0) + 1;
    });

    charts.artist.data.labels = Object.keys(artists);
    charts.artist.data.datasets[0].data = Object.values(artists);
    charts.artist.update();
}

// 初期ロード時の実行
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
});
