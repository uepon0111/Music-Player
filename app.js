/**
 * app.js - Web Music Player
 * 第6弾: タグデザインの改良、名前編集、既存タグのサジェスト機能
 */

const DB_NAME = 'MusicPlayerDB';
const DB_VERSION = 3; 
let db = null;

const audioPlayer = new Audio();
let currentObjectUrl = null;

const appState = {
    tracks: [],
    playlists: [],
    currentQueue: [],
    currentTrackIndex: -1,
    isPlaying: false,
    editingTrackId: null,
    editingTags: [] 
};

document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initDragAndDrop();
    initEditPage();
    initPlayerControls(); 
    initPlaylists();      
    
    try {
        await initDB();
        await loadLibrary();
        await loadPlaylists(); 
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

function initPlayerControls() {
    const playBtn = document.getElementById('ctrl-play');
    const prevBtn = document.getElementById('ctrl-prev');
    const nextBtn = document.getElementById('ctrl-next');
    const seekBar = document.getElementById('seek-bar');
    const volumeBar = document.getElementById('volume-bar');

    playBtn.addEventListener('click', togglePlay);
    nextBtn.addEventListener('click', playNext);
    prevBtn.addEventListener('click', playPrev);

    seekBar.addEventListener('input', (e) => {
        if (audioPlayer.duration) audioPlayer.currentTime = (e.target.value / 100) * audioPlayer.duration;
    });

    volumeBar.addEventListener('input', (e) => {
        audioPlayer.volume = e.target.value / 100;
    });
    audioPlayer.volume = volumeBar.value / 100;

    audioPlayer.addEventListener('timeupdate', () => {
        if (!audioPlayer.duration) return;
        const progressPercent = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        seekBar.value = progressPercent;
        document.getElementById('time-current').textContent = formatTime(audioPlayer.currentTime);
        document.getElementById('time-total').textContent = formatTime(audioPlayer.duration);
    });

    audioPlayer.addEventListener('ended', playNext);
}

function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function playTrack(index) {
    if (index < 0 || index >= appState.currentQueue.length) return;
    const track = appState.currentQueue[index];
    appState.currentTrackIndex = index;

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(track.fileBlob);
    
    audioPlayer.src = currentObjectUrl;
    audioPlayer.play()
        .then(() => {
            appState.isPlaying = true;
            updatePlayerUI(track);
            renderMainTrackList(); 
        })
        .catch(e => console.error("再生エラー:", e));
}

function togglePlay() {
    if (appState.currentQueue.length === 0) return;
    if (appState.isPlaying) {
        audioPlayer.pause();
        appState.isPlaying = false;
    } else {
        if (audioPlayer.src) {
            audioPlayer.play();
            appState.isPlaying = true;
        } else {
            playTrack(0); 
        }
    }
    updatePlayButtonUI();
}

function playNext() {
    if (appState.currentQueue.length === 0) return;
    let nextIndex = appState.currentTrackIndex + 1;
    if (nextIndex >= appState.currentQueue.length) nextIndex = 0; 
    playTrack(nextIndex);
}

function playPrev() {
    if (appState.currentQueue.length === 0) return;
    let prevIndex = appState.currentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = appState.currentQueue.length - 1;
    playTrack(prevIndex);
}

function updatePlayerUI(track) {
    document.getElementById('player-title').textContent = track.title;
    document.getElementById('player-artist').textContent = track.artist;
    
    const thumbnail = document.getElementById('player-thumbnail');
    if (track.thumbnailDataUrl) {
        thumbnail.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
        thumbnail.innerHTML = '';
    } else {
        thumbnail.style.backgroundImage = 'none';
        thumbnail.innerHTML = '<span class="material-symbols-outlined">music_note</span>';
    }
    updatePlayButtonUI();
}

function updatePlayButtonUI() {
    const playBtn = document.getElementById('ctrl-play');
    playBtn.innerHTML = appState.isPlaying 
        ? '<span class="material-symbols-outlined">pause</span>' 
        : '<span class="material-symbols-outlined">play_arrow</span>';
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
            resolve({ title: null, artist: null, picture: null }); return;
        }
        window.jsmediatags.read(file, {
            onSuccess: function(tag) {
                let tags = tag.tags; let pictureUrl = null;
                if (tags.picture) {
                    try {
                        let data = tags.picture.data; let format = tags.picture.format;
                        let base64String = "";
                        for (let i = 0; i < data.length; i++) base64String += String.fromCharCode(data[i]);
                        pictureUrl = `data:${format};base64,${window.btoa(base64String)}`;
                    } catch(e) {}
                }
                resolve({ title: tags.title || null, artist: tags.artist || null, picture: pictureUrl });
            },
            onError: function() { resolve({ title: null, artist: null, picture: null }); }
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
            fileBlob: file, fileName: file.name,
            title: meta.title || file.name.replace(/\.[^/.]+$/, ""),
            artist: meta.artist || "不明なアーティスト",
            date: "", tags: [], thumbnailDataUrl: meta.picture || null, addedAt: Date.now()
        };
        await saveTrackToDB(newTrack);
    }
    await loadLibrary();
}

function saveTrackToDB(track) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readwrite');
        const request = transaction.objectStore('tracks').put(track);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

function getAllTracksFromDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readonly');
        const request = transaction.objectStore('tracks').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function loadLibrary() {
    appState.tracks = await getAllTracksFromDB();
    appState.currentQueue = [...appState.tracks].sort((a, b) => b.addedAt - a.addedAt);
    
    renderSidebarLibrary();
    renderMainTrackList(); 
    renderEditLibraryList(appState.tracks);
}

function renderSidebarLibrary() {
    const list = document.getElementById('my-library-list');
    list.innerHTML = '';
    const allItem = document.createElement('li');
    allItem.style.padding = '10px'; allItem.style.cursor = 'pointer'; allItem.style.fontWeight = 'bold';
    allItem.innerHTML = `<span class="material-symbols-outlined">library_music</span> すべての曲 (${appState.tracks.length})`;
    allItem.addEventListener('click', () => {
        document.getElementById('current-playlist-name').textContent = "マイライブラリ (すべて)";
        appState.currentQueue = [...appState.tracks].sort((a, b) => b.addedAt - a.addedAt);
        renderMainTrackList();
    });
    list.appendChild(allItem);
}

// ★修正：プレイヤー画面のタグにも色（左端のカラーライン）を反映
function renderMainTrackList() {
    const container = document.getElementById('current-playlist-items');
    container.innerHTML = '';

    appState.currentQueue.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'track-list-item';
        
        if (appState.isPlaying && appState.currentTrackIndex === index) {
            li.classList.add('playing');
        }

        const thumb = document.createElement('div');
        thumb.style.width = '40px'; thumb.style.height = '40px'; thumb.style.borderRadius = '4px';
        thumb.style.backgroundColor = 'var(--bg-surface)'; thumb.style.backgroundSize = 'cover';
        thumb.style.display = 'flex'; thumb.style.alignItems = 'center'; thumb.style.justifyContent = 'center';
        if (track.thumbnailDataUrl) {
            thumb.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
        } else {
            thumb.innerHTML = '<span class="material-symbols-outlined" style="font-size:20px; color:var(--text-secondary);">music_note</span>';
        }

        const info = document.createElement('div');
        info.className = 'track-list-info';
        
        let tagsHtml = '';
        if (track.tags && track.tags.length > 0) {
            tagsHtml = `<div class="track-list-tags">` + 
                track.tags.map(t => {
                    const tObj = typeof t === 'string' ? {text: t, color: '#ccc'} : t;
                    return `<span class="track-list-tag" style="border-left: 3px solid ${tObj.color}; padding-left: 6px;">${tObj.text}</span>`;
                }).join('') + `</div>`;
        }

        info.innerHTML = `
            <div class="track-list-title">${track.title}</div>
            <div class="track-list-artist">${track.artist}</div>
            ${tagsHtml}
        `;

        li.appendChild(thumb);
        li.appendChild(info);
        li.addEventListener('click', () => playTrack(index));
        container.appendChild(li);
    });
}

function initPlaylists() {
    document.getElementById('create-playlist-btn').addEventListener('click', async () => {
        const name = prompt("新しいプレイリストの名前を入力してください");
        if (!name) return;
        const newList = { id: 'pl_' + Date.now(), name: name, trackIds: [] };
        const transaction = db.transaction(['playlists'], 'readwrite');
        transaction.objectStore('playlists').put(newList);
        await loadPlaylists();
    });
}

function getAllPlaylistsFromDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['playlists'], 'readonly');
        const request = transaction.objectStore('playlists').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function loadPlaylists() {
    appState.playlists = await getAllPlaylistsFromDB();
    const container = document.getElementById('playlists-container');
    container.innerHTML = '';
    
    appState.playlists.forEach(pl => {
        const li = document.createElement('li');
        li.style.padding = '10px'; li.style.cursor = 'pointer'; li.style.borderBottom = '1px solid var(--border-color)';
        li.innerHTML = `<span class="material-symbols-outlined">queue_music</span> ${pl.name} (${pl.trackIds.length}曲)`;
        li.addEventListener('click', () => {
            document.getElementById('current-playlist-name').textContent = pl.name;
            appState.currentQueue = appState.tracks.filter(t => pl.trackIds.includes(t.id));
            renderMainTrackList();
        });
        container.appendChild(li);
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

// ★追加：すべての曲から既存のタグリスト（重複なし）を取得する関数
function getExistingTags() {
    const tagsMap = new Map();
    appState.tracks.forEach(track => {
        if (track.tags) {
            track.tags.forEach(t => {
                const tagObj = typeof t === 'string' ? {text: t, color: getTagColorHex(t)} : t;
                tagsMap.set(tagObj.text, tagObj.color); 
            });
        }
    });
    return Array.from(tagsMap, ([text, color]) => ({text, color}));
}

// ★追加：既存タグを画面に表示する関数
function renderExistingTags() {
    const list = document.getElementById('existing-tags-list');
    if (!list) return;
    list.innerHTML = '';
    
    const existingTags = getExistingTags();
    // すでに編集中に追加されているタグは候補から除外
    const availableTags = existingTags.filter(et => !appState.editingTags.some(editT => editT.text === et.text));

    availableTags.forEach(tagObj => {
        const span = document.createElement('span');
        span.className = 'tag-item';
        span.style.borderLeft = `4px solid ${tagObj.color}`;
        span.style.cursor = 'pointer';
        span.style.opacity = '0.7'; 
        span.innerHTML = `<span class="tag-text">${tagObj.text}</span> <span class="material-symbols-outlined" style="font-size: 14px; margin-left: 4px;">add</span>`;
        
        span.addEventListener('click', () => {
            appState.editingTags.push({text: tagObj.text, color: tagObj.color});
            renderEditTags(); 
        });
        
        list.appendChild(span);
    });
}

function initEditPage() {
    const tagInput = document.getElementById('edit-tags-input');
    
    // ★追加：HTMLを書き換えずに、JSで既存タグを表示するエリアを動的に作成
    const tagsInputContainer = document.querySelector('.tags-input-container');
    let existingTagsContainer = document.getElementById('existing-tags-container');
    if (!existingTagsContainer) {
        existingTagsContainer = document.createElement('div');
        existingTagsContainer.id = 'existing-tags-container';
        existingTagsContainer.className = 'existing-tags-wrapper';
        existingTagsContainer.innerHTML = '<div class="existing-tags-title">既存のタグから追加する</div><div id="existing-tags-list" class="tags-list"></div>';
        tagsInputContainer.parentNode.insertBefore(existingTagsContainer, tagsInputContainer.nextSibling);
    }

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
        renderExistingTags(); // 保存したタグを既存リストにも反映
        alert('情報を保存しました！');
    });
}

function renderEditTags() {
    const list = document.getElementById('edit-tags-list');
    list.innerHTML = '';
    
    appState.editingTags.forEach((tagObj, index) => {
        const span = document.createElement('span');
        span.className = 'tag-item';
        span.style.borderLeft = `4px solid ${tagObj.color}`; 
        
        // ★修正：タグのテキスト部分を <span> で囲み、クリック可能に
        span.innerHTML = `
            <span class="tag-text" data-index="${index}" title="クリックで名前を編集">${tagObj.text}</span> 
            <input type="color" class="tag-color-picker" value="${tagObj.color}" data-index="${index}" title="色を変更">
            <span class="material-symbols-outlined remove-tag" data-index="${index}">close</span>
        `;
        list.appendChild(span);
    });

    // 削除ボタン
    document.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = e.target.getAttribute('data-index');
            appState.editingTags.splice(index, 1);
            renderEditTags();
        });
    });

    // カラーピッカー
    document.querySelectorAll('.tag-color-picker').forEach(picker => {
        picker.addEventListener('input', (e) => {
            const index = e.target.getAttribute('data-index');
            appState.editingTags[index].color = e.target.value; 
            e.target.parentElement.style.borderLeft = `4px solid ${e.target.value}`; 
        });
    });

    // ★追加：文字部分をクリックで名前を編集
    document.querySelectorAll('.tag-text').forEach(textEl => {
        textEl.addEventListener('click', (e) => {
            const index = e.target.getAttribute('data-index');
            const currentText = appState.editingTags[index].text;
            const newText = prompt("タグの名前を変更:", currentText);
            // キャンセルや空欄でなければ更新
            if (newText !== null && newText.trim() !== "") {
                appState.editingTags[index].text = newText.trim();
                renderEditTags(); 
            }
        });
    });

    // タグが更新されたら、既存タグのリスト（候補）も再描画する
    renderExistingTags();
}
