// ==========================================
// 1. グローバル変数と初期設定
// ==========================================
const DB_NAME = 'MusicPlayerDB';
const DB_VERSION = 1;
let db = null;
let currentAudio = new Audio();
let isPlaying = false;
let currentTrackList = [];
let currentTrackIndex = -1;

// ==========================================
// 2. データベース (IndexedDB) の初期化
// ==========================================
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            // 楽曲データ用ストア
            if (!database.objectStoreNames.contains('tracks')) {
                database.createObjectStore('tracks', { keyPath: 'id' });
            }
            // プレイリスト用ストア
            if (!database.objectStoreNames.contains('playlists')) {
                database.createObjectStore('playlists', { keyPath: 'id' });
            }
            // ログ用ストア
            if (!database.objectStoreNames.contains('logs')) {
                database.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB initialized successfully');
            resolve(db);
        };

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.error);
            reject(event.target.error);
        };
    });
}

// データベース操作のヘルパー関数
function saveTrackToDB(track) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readwrite');
        const store = transaction.objectStore('tracks');
        const request = store.put(track);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

function getAllTracksFromDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readonly');
        const store = transaction.objectStore('tracks');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

// ==========================================
// 3. UIとイベントリスナーのセットアップ
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
        setupSPA();
        setupFileUpload();
        setupPlayerControls();
        await loadMyLibrary();
    } catch (error) {
        console.error('Initialization failed:', error);
        alert('アプリケーションの初期化に失敗しました。');
    }
});

// SPA (Single Page Application) の画面切り替え
function setupSPA() {
    const navButtons = document.querySelectorAll('.nav-btn');
    const pages = document.querySelectorAll('.page-section');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // ボタンのアクティブ状態を切り替え
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // ページの表示を切り替え
            const targetId = btn.getAttribute('data-target');
            pages.forEach(page => {
                if (page.id === targetId) {
                    page.classList.add('active');
                } else {
                    page.classList.remove('active');
                }
            });
        });
    });
}

// ==========================================
// 4. ファイルアップロード処理
// ==========================================
function setupFileUpload() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-upload');

    // ドラッグ＆ドロップイベント
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    });

    // ファイル選択入力イベント
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFiles(e.target.files);
        }
    });
}

async function handleFiles(files) {
    const audioFiles = Array.from(files).filter(file => file.type.startsWith('audio/'));
    
    if (audioFiles.length === 0) {
        alert('音声ファイルを選択してください。');
        return;
    }

    for (const file of audioFiles) {
        // デフォルトのメタデータを作成
        const track = {
            id: 'track_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            file: file,
            title: file.name.replace(/\.[^/.]+$/, ""), // 拡張子を削除してタイトルにする
            artist: 'Unknown Artist',
            date: new Date().toISOString().split('T')[0],
            tags: [],
            thumbnail: null // 初期状態はサムネイルなし
        };

        try {
            await saveTrackToDB(track);
        } catch (error) {
            console.error('Failed to save file:', error);
            alert(`ファイル ${file.name} の保存に失敗しました。`);
        }
    }

    // ライブラリを再読み込み
    await loadMyLibrary();
}

// ==========================================
// 5. ライブラリ表示処理
// ==========================================
async function loadMyLibrary() {
    const libraryList = document.getElementById('my-library-list');
    const tracks = await getAllTracksFromDB();
    
    libraryList.innerHTML = ''; // リストをクリア

    if (tracks.length === 0) {
        libraryList.innerHTML = '<li style="padding: 10px; color: var(--text-secondary); text-align: center;">ファイルがありません</li>';
        return;
    }

    tracks.forEach(track => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        li.style.padding = '10px';
        li.style.borderBottom = '1px solid var(--border-color)';
        li.style.cursor = 'pointer';
        
        li.innerHTML = `
            <div style="display: flex; flex-direction: column; overflow: hidden;">
                <span style="font-weight: bold; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">${track.title}</span>
                <span style="font-size: 12px; color: var(--text-secondary);">${track.artist}</span>
            </div>
            <button class="icon-btn" title="再生"><span class="material-symbols-outlined">play_arrow</span></button>
        `;

        // クリックで再生
        li.addEventListener('click', () => {
            currentTrackList = tracks; // 現在のリスト全体をセット
            currentTrackIndex = tracks.findIndex(t => t.id === track.id);
            playTrack(track);
        });

        libraryList.appendChild(li);
    });
}

// ==========================================
// 6. プレイヤー制御処理
// ==========================================
function setupPlayerControls() {
    const playBtn = document.getElementById('ctrl-play');
    const prevBtn = document.getElementById('ctrl-prev');
    const nextBtn = document.getElementById('ctrl-next');
    const seekBar = document.getElementById('seek-bar');
    const volumeBar = document.getElementById('volume-bar');

    // 再生・一時停止
    playBtn.addEventListener('click', () => {
        if (!currentAudio.src) return;
        
        if (isPlaying) {
            currentAudio.pause();
        } else {
            currentAudio.play();
        }
    });

    // オーディオのイベントリスナー
    currentAudio.addEventListener('play', () => {
        isPlaying = true;
        playBtn.innerHTML = '<span class="material-symbols-outlined">pause</span>';
    });

    currentAudio.addEventListener('pause', () => {
        isPlaying = false;
        playBtn.innerHTML = '<span class="material-symbols-outlined">play_arrow</span>';
    });

    // タイムアップデート（シークバーの更新）
    currentAudio.addEventListener('timeupdate', () => {
        if (currentAudio.duration) {
            const progressPercent = (currentAudio.currentTime / currentAudio.duration) * 100;
            seekBar.value = progressPercent;
            document.getElementById('time-current').textContent = formatTime(currentAudio.currentTime);
        }
    });

    // メタデータ読み込み完了時（総再生時間の表示）
    currentAudio.addEventListener('loadedmetadata', () => {
        document.getElementById('time-total').textContent = formatTime(currentAudio.duration);
    });

    // シークバーの操作
    seekBar.addEventListener('input', (e) => {
        if (currentAudio.duration) {
            const seekTime = (e.target.value / 100) * currentAudio.duration;
            currentAudio.currentTime = seekTime;
        }
    });

    // 音量調整
    volumeBar.addEventListener('input', (e) => {
        currentAudio.volume = e.target.value / 100;
    });

    // 次の曲へ
    nextBtn.addEventListener('click', playNext);
    
    // 曲終了時に自動で次へ
    currentAudio.addEventListener('ended', playNext);

    // 前の曲へ
    prevBtn.addEventListener('click', () => {
        if (currentTrackList.length === 0) return;
        currentTrackIndex = (currentTrackIndex - 1 + currentTrackList.length) % currentTrackList.length;
        playTrack(currentTrackList[currentTrackIndex]);
    });
}

function playTrack(track) {
    if (!track || !track.file) return;

    // 前のURLを解放してメモリリークを防ぐ
    if (currentAudio.src) {
        URL.revokeObjectURL(currentAudio.src);
    }

    const objectURL = URL.createObjectURL(track.file);
    currentAudio.src = objectURL;
    currentAudio.play();

    // グローバルプレイヤーのUI更新
    document.getElementById('player-title').textContent = track.title;
    document.getElementById('player-artist').textContent = track.artist;
    
    const thumbnailEl = document.getElementById('player-thumbnail');
    if (track.thumbnail) {
        const thumbUrl = URL.createObjectURL(track.thumbnail);
        thumbnailEl.innerHTML = '';
        thumbnailEl.style.backgroundImage = `url(${thumbUrl})`;
    } else {
        thumbnailEl.innerHTML = '<span class="material-symbols-outlined">music_note</span>';
        thumbnailEl.style.backgroundImage = 'none';
    }
}

function playNext() {
    if (currentTrackList.length === 0) return;
    currentTrackIndex = (currentTrackIndex + 1) % currentTrackList.length;
    playTrack(currentTrackList[currentTrackIndex]);
}

// ユーティリティ: 秒数をMM:SS形式にフォーマット
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
