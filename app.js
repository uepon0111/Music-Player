/**
 * app.js - Web Music Player
 * 第3弾: メタ情報の自動読み込み、タグ色変更機能、初期値空欄化
 */

const DB_NAME = 'MusicPlayerDB';
const DB_VERSION = 3; 
let db = null;

const appState = {
    tracks: [],
    playlists: [],
    currentTrack: null,
    isPlaying: false,
    editingTrackId: null,
    editingTags: [] // {text: "タグ名", color: "#RRGGBB"} の形式で保存
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

// 音声ファイルからメタ情報を抽出する関数 (jsmediatagsを使用)
function readAudioTags(file) {
    return new Promise((resolve) => {
        if (typeof window.jsmediatags === 'undefined') {
            resolve({ title: null, artist: null, picture: null });
            return;
        }
        window.jsmediatags.read(file, {
            onSuccess: function(tag) {
                let tags = tag.tags;
                let pictureUrl = null;
                // サムネイル画像が存在する場合
                if (tags.picture) {
                    try {
                        let data = tags.picture.data;
                        let format = tags.picture.format;
                        let base64String = "";
                        for (let i = 0; i < data.length; i++) {
                            base64String += String.fromCharCode(data[i]);
                        }
                        pictureUrl = `data:${format};base64,${window.btoa(base64String)}`;
                    } catch(e) { console.error("画像読み込みエラー", e); }
                }
                resolve({
                    title: tags.title || null,
                    artist: tags.artist || null,
                    picture: pictureUrl
                });
            },
            onError: function() {
                resolve({ title: null, artist: null, picture: null });
            }
        });
    });
}

async function handleFiles(files) {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('audio/')) continue;

        // メタ情報を取得（少し時間がかかるのでawaitで待機）
        const meta = await readAudioTags(file);

        const newTrack = {
            id: 'track_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            fileBlob: file,
            fileName: file.name,
            title: meta.title || file.name.replace(/\.[^/.]+$/, ""), // 取得できればメタ情報のタイトル
            artist: meta.artist || "不明なアーティスト", // 取得できればメタ情報のアーティスト
            date: "", // 投稿日は初期値で空欄にする
            tags: [],
            thumbnailDataUrl: meta.picture || null, // サムネイルがあれば設定
            addedAt: Date.now()
        };
        await saveTrackToDB(newTrack);
    }
    await loadLibrary();
    alert('ファイルの追加が完了しました。');
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
    renderEditLibraryList(appState.tracks);
}

function renderLibraryList(tracks) {
    const libraryList = document.getElementById('my-library-list');
    libraryList.innerHTML = '';
    const sortedTracks = [...tracks].sort((a, b) => b.addedAt - a.addedAt);

    sortedTracks.forEach(track => {
        const li = document.createElement('li');
        li.style.padding = '10px'; li.style.borderBottom = '1px solid var(--border-color)';
        li.style.display = 'flex'; li.style.alignItems = 'center'; li.style.gap = '10px'; li.style.cursor = 'pointer';

        // サムネイルがあれば画像を表示、なければアイコン
        if (track.thumbnailDataUrl) {
            const img = document.createElement('img');
            img.src = track.thumbnailDataUrl;
            img.style.width = '30px'; img.style.height = '30px';
            img.style.borderRadius = '4px'; img.style.objectFit = 'cover';
            li.appendChild(img);
        } else {
            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined';
            icon.textContent = 'audio_file';
            icon.style.color = 'var(--text-secondary)';
            li.appendChild(icon);
        }
        
        const info = document.createElement('div');
        info.innerHTML = `<div style="font-weight:bold; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.title}</div>
                          <div style="font-size:12px; color:var(--text-secondary);">${track.artist}</div>`;

        li.appendChild(info);
        libraryList.appendChild(li);
    });
}

function renderEditLibraryList(tracks) {
    const list = document.getElementById('edit-library-list');
    list.innerHTML = '';
    tracks.forEach(track => {
        const li = document.createElement('li');
        li.style.padding = '8px'; li.style.borderBottom = '1px solid var(--border-color)';
        li.style.cursor = 'pointer'; li.style.fontSize = '14px';
        li.textContent = track.title;
        li.addEventListener('click', () => openEditForm(track));
        list.appendChild(li);
    });
}

// フォームにデータをセット
function openEditForm(track) {
    document.getElementById('edit-form-area').style.display = 'flex';
    appState.editingTrackId = track.id;
    
    document.getElementById('edit-title').value = track.title || '';
    document.getElementById('edit-artist').value = track.artist || '';
    document.getElementById('edit-date').value = track.date || '';
    
    // タグデータが古い形式（文字列）の場合は新しい形式（オブジェクト）に変換
    appState.editingTags = (track.tags || []).map(t => {
        return typeof t === 'string' ? { text: t, color: getTagColorHex(t) } : t;
    });
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

// 文字列からランダムなHEXカラーを生成する関数（カラーピッカー用）
function getTagColorHex(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return "#" + "00000".substring(0, 6 - c.length) + c;
}

function initEditPage() {
    const tagInput = document.getElementById('edit-tags-input');
    
    tagInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const tagText = tagInput.value.trim();
            // 重複チェック
            if (tagText && !appState.editingTags.find(t => t.text === tagText)) {
                // 初期色は自動生成したものをセット
                appState.editingTags.push({ text: tagText, color: getTagColorHex(tagText) });
                renderEditTags();
                tagInput.value = '';
            }
        }
    });

    document.getElementById('save-metadata-btn').addEventListener('click', async () => {
        if (!appState.editingTrackId) return;
        const track = appState.tracks.find(t => t.id === appState.editingTrackId);
        if (!track) return;

        track.title = document.getElementById('edit-title').value;
        track.artist = document.getElementById('edit-artist').value;
        track.date = document.getElementById('edit-date').value;
        track.tags = [...appState.editingTags]; // 色情報付きのタグオブジェクト配列を保存

        await saveTrackToDB(track);
        await loadLibrary();
        alert('情報を保存しました！');
    });
}

function renderEditTags() {
    const list = document.getElementById('edit-tags-list');
    list.innerHTML = '';
    
    appState.editingTags.forEach((tagObj, index) => {
        const span = document.createElement('span');
        span.className = 'tag-item';
        span.style.backgroundColor = tagObj.color; // 選択された色を適用
        
        // タグ名、カラーピッカー、削除ボタンを配置
        span.innerHTML = `
            ${tagObj.text} 
            <input type="color" class="tag-color-picker" value="${tagObj.color}" data-index="${index}" title="色を変更">
            <span class="material-symbols-outlined remove-tag" data-index="${index}">close</span>
        `;
        list.appendChild(span);
    });

    // 削除イベント
    document.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = e.target.getAttribute('data-index');
            appState.editingTags.splice(index, 1);
            renderEditTags();
        });
    });

    // 色変更（カラーピッカー）イベント：色を選んだ瞬間にタグの背景色を変える
    document.querySelectorAll('.tag-color-picker').forEach(picker => {
        picker.addEventListener('input', (e) => {
            const index = e.target.getAttribute('data-index');
            appState.editingTags[index].color = e.target.value; // 色情報を更新
            e.target.parentElement.style.backgroundColor = e.target.value; // 見た目を即反映
        });
    });
}
