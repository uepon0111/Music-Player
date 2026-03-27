/**
 * app.js - Web Music Player
 * 第4弾: レスポンシブ対応、タグデザインの修正
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
    editingTags: [] // {text: "タグ名", color: "#RRGGBB"} 
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

        const meta = await readAudioTags(file);

        const newTrack = {
            id: 'track_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            fileBlob: file,
            fileName: file.name,
            title: meta.title || file.name.replace(/\.[^/.]+$/, ""),
            artist: meta.artist || "不明なアーティスト",
            date: "", 
            tags: [],
            thumbnailDataUrl: meta.picture || null,
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

function openEditForm(track) {
    document.getElementById('edit-form-area').style.display = 'flex';
    appState.editingTrackId = track.id;
    
    document.getElementById('edit-title').value = track.title || '';
    document.getElementById('edit-artist').value = track.artist || '';
    document.getElementById('edit-date').value = track.date || '';
    
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
            if (tagText && !appState.editingTags.find(t => t.text === tagText)) {
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
        track.tags = [...appState.editingTags];

        await saveTrackToDB(track);
        await loadLibrary();
        alert('情報を保存しました！');
    });
}

// ★修正: タグ全体の背景色を変えず、カラーピッカーのアイコンだけが変わるようにしました
function renderEditTags() {
    const list = document.getElementById('edit-tags-list');
    list.innerHTML = '';
    
    appState.editingTags.forEach((tagObj, index) => {
        const span = document.createElement('span');
        span.className = 'tag-item';
        // span.style.backgroundColor = tagObj.color; <- ここを削除しました
        
        span.innerHTML = `
            ${tagObj.text} 
            <input type="color" class="tag-color-picker" value="${tagObj.color}" data-index="${index}" title="色を変更">
            <span class="material-symbols-outlined remove-tag" data-index="${index}">close</span>
        `;
        list.appendChild(span);
    });

    document.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = e.target.getAttribute('data-index');
            appState.editingTags.splice(index, 1);
            renderEditTags();
        });
    });

    // カラーピッカーの値が変更されたらデータだけを更新し、背景色は変えない
    document.querySelectorAll('.tag-color-picker').forEach(picker => {
        picker.addEventListener('input', (e) => {
            const index = e.target.getAttribute('data-index');
            appState.editingTags[index].color = e.target.value; 
        });
    });
}
