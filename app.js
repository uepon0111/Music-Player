/**
 * app.js - Web Music Player
 * 第2弾: 情報編集機能（リスト選択、カラフルな複数タグ、メタデータ保存）
 */

const DB_NAME = 'MusicPlayerDB';
const DB_VERSION = 3; 
let db = null;

const appState = {
    tracks: [],
    playlists: [],
    currentTrack: null,
    isPlaying: false,
    editingTrackId: null, // 現在編集中の曲ID
    editingTags: []       // 編集中のタグ一覧
};

document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initDragAndDrop();
    initEditPage();
    
    try {
        await initDB();
        await loadLibrary();
    } catch (error) {
        console.error('DB初期化エラー:', error);
    }
});

function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const pages = document.querySelectorAll('.page-section');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const targetId = btn.getAttribute('data-target');
            pages.forEach(page => {
                page.classList.toggle('active', page.id === targetId);
            });
        });
    });
}

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

function initDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-upload');

    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });
}

async function handleFiles(files) {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('audio/')) continue;

        const newTrack = {
            id: 'track_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            fileBlob: file,
            fileName: file.name,
            title: file.name.replace(/\.[^/.]+$/, ""),
            artist: "不明なアーティスト",
            date: new Date().toISOString().split('T')[0],
            tags: [],
            thumbnailDataUrl: null,
            addedAt: Date.now()
        };
        await saveTrackToDB(newTrack);
    }
    await loadLibrary();
}

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

async function loadLibrary() {
    appState.tracks = await getAllTracksFromDB();
    renderLibraryList(appState.tracks);
    renderEditLibraryList(appState.tracks); // 編集用リストも更新
}

// マイライブラリの描画
function renderLibraryList(tracks) {
    const libraryList = document.getElementById('my-library-list');
    libraryList.innerHTML = '';
    const sortedTracks = [...tracks].sort((a, b) => b.addedAt - a.addedAt);

    sortedTracks.forEach(track => {
        const li = document.createElement('li');
        li.style.padding = '10px'; li.style.borderBottom = '1px solid var(--border-color)';
        li.style.display = 'flex'; li.style.alignItems = 'center'; li.style.gap = '10px'; li.style.cursor = 'pointer';

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = track.thumbnailDataUrl ? 'image' : 'audio_file';
        
        const info = document.createElement('div');
        info.innerHTML = `<div style="font-weight:bold; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.title}</div>
                          <div style="font-size:12px; color:var(--text-secondary);">${track.artist}</div>`;

        li.appendChild(icon); li.appendChild(info);
        libraryList.appendChild(li);
    });
}

// --- ★新機能: 編集用リストとメタデータ編集処理 ---

function renderEditLibraryList(tracks) {
    const list = document.getElementById('edit-library-list');
    list.innerHTML = '';
    
    tracks.forEach(track => {
        const li = document.createElement('li');
        li.style.padding = '8px'; li.style.borderBottom = '1px solid var(--border-color)';
        li.style.cursor = 'pointer'; li.style.fontSize = '14px';
        li.textContent = track.title;
        
        li.addEventListener('click', () => {
            openEditForm(track);
        });
        list.appendChild(li);
    });
}

// 編集フォームにデータをセット
function openEditForm(track) {
    document.getElementById('edit-form-area').style.display = 'flex';
    appState.editingTrackId = track.id;
    
    document.getElementById('edit-title').value = track.title || '';
    document.getElementById('edit-artist').value = track.artist || '';
    document.getElementById('edit-date').value = track.date || '';
    
    appState.editingTags = [...(track.tags || [])];
    renderEditTags();

    // サムネイルの表示
    const preview = document.getElementById('edit-thumbnail-preview');
    if (track.thumbnailDataUrl) {
        preview.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
        preview.innerHTML = '';
    } else {
        preview.style.backgroundImage = 'none';
        preview.innerHTML = '<span class="material-symbols-outlined">image</span>';
    }
}

// タグの色を文字から自動生成する関数（パステルカラー）
function getTagColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 70%, 85%)`; // HSLで明るいパステルカラーを生成
}

function initEditPage() {
    const tagInput = document.getElementById('edit-tags-input');
    
    // Enterキーでタグ追加
    tagInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const tagText = tagInput.value.trim();
            if (tagText && !appState.editingTags.includes(tagText)) {
                appState.editingTags.push(tagText);
                renderEditTags();
                tagInput.value = '';
            }
        }
    });

    // 保存ボタンの処理
    document.getElementById('save-metadata-btn').addEventListener('click', async () => {
        if (!appState.editingTrackId) return;
        
        // 元の曲データを取得
        const track = appState.tracks.find(t => t.id === appState.editingTrackId);
        if (!track) return;

        // 入力内容で上書き
        track.title = document.getElementById('edit-title').value;
        track.artist = document.getElementById('edit-artist').value;
        track.date = document.getElementById('edit-date').value;
        track.tags = [...appState.editingTags];

        // データベースに保存して再描画
        await saveTrackToDB(track);
        await loadLibrary();
        alert('情報を保存しました！');
    });
}

function renderEditTags() {
    const list = document.getElementById('edit-tags-list');
    list.innerHTML = '';
    
    appState.editingTags.forEach((tag, index) => {
        const span = document.createElement('span');
        span.className = 'tag-item';
        span.style.backgroundColor = getTagColor(tag); // 文字から自動で色を付ける
        span.innerHTML = `${tag} <span class="material-symbols-outlined remove-tag" data-index="${index}">close</span>`;
        list.appendChild(span);
    });

    // 削除ボタンのイベント
    document.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = e.target.getAttribute('data-index');
            appState.editingTags.splice(index, 1);
            renderEditTags();
        });
    });
}
