/**
 * app.js - Web Music Player
 * 第1弾: IndexedDB構築、SPAルーティング、ファイルアップロード機能
 */

// --- 1. グローバル変数・定数 ---
const DB_NAME = 'MusicPlayerDB';
const DB_VERSION = 3;
let db = null;

// アプリの現在の状態を保持
const appState = {
    tracks: [],      // マイライブラリの全曲
    playlists: [],   // 作成された再生リスト
    currentTrack: null,
    isPlaying: false
};

// --- 2. 初期化処理 ---
document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initDragAndDrop();
    
    try {
        await initDB();
        await loadLibrary();
    } catch (error) {
        console.error('データベースの初期化に失敗しました:', error);
        alert('ブラウザのストレージ機能がサポートされていないか、エラーが発生しました。');
    }
});

// --- 3. 画面切り替え (SPAルーティング) ---
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const pages = document.querySelectorAll('.page-section');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // ボタンのアクティブ状態を切り替え
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 表示するページを切り替え
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

// --- 4. データベース (IndexedDB) の構築 ---
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => reject(event.target.error);

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            
            // トラック（音声ファイルとメタデータ）を保存するストア
            if (!database.objectStoreNames.contains('tracks')) {
                database.createObjectStore('tracks', { keyPath: 'id' });
            }
            
            // 再生リストを保存するストア
            if (!database.objectStoreNames.contains('playlists')) {
                database.createObjectStore('playlists', { keyPath: 'id' });
            }
            
            // 再生ログを保存するストア
            if (!database.objectStoreNames.contains('logs')) {
                database.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

// --- 5. ファイルアップロードとドラッグ＆ドロップ ---
function initDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-upload');

    // クリックでのファイル選択
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    // ドラッグ＆ドロップのイベント
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    });
}

async function handleFiles(files) {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // 音声ファイルのみを許可
        if (!file.type.startsWith('audio/')) {
            alert(`「${file.name}」は音声ファイルではありません。`);
            continue;
        }

        // 新しいトラックオブジェクトの作成
        const newTrack = {
            id: 'track_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            fileBlob: file,           // 音声データ本体
            fileName: file.name,
            title: file.name.replace(/\.[^/.]+$/, ""), // 拡張子を除いたファイル名を仮タイトルに
            artist: "不明なアーティスト",
            date: new Date().toISOString().split('T')[0],
            tags: [],
            thumbnailDataUrl: null,   // サムネイル画像
            volume: 100,              // 再生時の音量補正(%)
            addedAt: Date.now()       // 追加日時
        };

        await saveTrackToDB(newTrack);
    }
    
    // アップロード後にライブラリを再描画
    await loadLibrary();
    alert('ファイルの追加が完了しました。');
}

// --- 6. データベース操作関数 ---
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

// --- 7. マイライブラリの描画 ---
async function loadLibrary() {
    appState.tracks = await getAllTracksFromDB();
    renderLibraryList(appState.tracks);
}

function renderLibraryList(tracks) {
    const libraryList = document.getElementById('my-library-list');
    libraryList.innerHTML = '';

    if (tracks.length === 0) {
        libraryList.innerHTML = '<li style="text-align:center; color:var(--text-secondary); padding: 20px 0;">ファイルがありません</li>';
        return;
    }

    // 追加日時が新しい順に並べ替えて表示
    const sortedTracks = [...tracks].sort((a, b) => b.addedAt - a.addedAt);

    sortedTracks.forEach(track => {
        const li = document.createElement('li');
        li.style.padding = '10px';
        li.style.borderBottom = '1px solid var(--border-color)';
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.gap = '10px';
        li.style.cursor = 'pointer';

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = track.thumbnailDataUrl ? 'image' : 'audio_file';
        icon.style.color = 'var(--text-secondary)';

        const info = document.createElement('div');
        info.style.flex = '1';
        info.style.overflow = 'hidden';

        const title = document.createElement('div');
        title.textContent = track.title;
        title.style.fontWeight = 'bold';
        title.style.whiteSpace = 'nowrap';
        title.style.overflow = 'hidden';
        title.style.textOverflow = 'ellipsis';
        title.style.fontSize = '14px';

        const artist = document.createElement('div');
        artist.textContent = track.artist;
        artist.style.fontSize = '12px';
        artist.style.color = 'var(--text-secondary)';

        info.appendChild(title);
        info.appendChild(artist);

        li.appendChild(icon);
        li.appendChild(info);

        li.addEventListener('click', () => {
            console.log('選択された曲:', track.title);
        });

        libraryList.appendChild(li);
    });
}
