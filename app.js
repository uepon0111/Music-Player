/**
 * app.js - Web Music Player
 * 第6弾: タグデザイン刷新(縁取り・背景・省略)、既存タグ選択、タグ編集モーダル
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
    initTagEditModal(); // ★追加: モーダルの初期化
    
    try {
        await initDB();
        await loadLibrary();
        await loadPlaylists(); 
    } catch (error) {
        console.error('DB初期化エラー:', error);
    }
});

// === ユーティリティ関数 ===
// HEXカラーを透過度(alpha)付きのRGBAに変換する関数
function hexToRgba(hex, alpha) {
    if (!hex) return `rgba(200, 200, 200, ${alpha})`;
    let r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 全アプリ内のユニークなタグを収集する関数
function getAllUniqueTags() {
    const tagMap = new Map();
    appState.tracks.forEach(track => {
        if (track.tags) {
            track.tags.forEach(t => {
                const text = typeof t === 'string' ? t : t.text;
                const color = typeof t === 'string' ? getTagColorHex(t) : t.color;
                if (!tagMap.has(text)) {
                    tagMap.set(text, color);
                }
            });
        }
    });
    return Array.from(tagMap, ([text, color]) => ({text, color}));
}

function getTagColorHex(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return "#" + "00000".substring(0, 6 - c.length) + c;
}

// === 初期化関連 ===
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

// === プレイヤー ===
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
    audioPlayer.play().then(() => {
        appState.isPlaying = true;
        updatePlayerUI(track);
        renderMainTrackList(); 
    }).catch(e => console.error("再生エラー:", e));
}

function togglePlay() {
    if (appState.currentQueue.length === 0) return;
    if (appState.isPlaying) {
        audioPlayer.pause(); appState.isPlaying = false;
    } else {
        if (audioPlayer.src) { audioPlayer.play(); appState.isPlaying = true; }
        else playTrack(0);
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

// === データ管理 ===
function initDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-upload');
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault(); dropZone.classList.remove('dragover');
        if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });
}

function readAudioTags(file) {
    return new Promise((resolve) => {
        if (typeof window.jsmediatags === 'undefined') { resolve({ title: null, artist: null, picture: null }); return; }
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
        request.onsuccess = () => resolve(); request.onerror = (e) => reject(e.target.error);
    });
}

function getAllTracksFromDB() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readonly');
        const request = transaction.objectStore('tracks').getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = (e) => reject(e.target.error);
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

// ★変更：メイン画面のタグを新しいデザイン（縁取り・薄い背景）に変更
function renderMainTrackList() {
    const container = document.getElementById('current-playlist-items');
    container.innerHTML = '';

    appState.currentQueue.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'track-list-item';
        if (appState.isPlaying && appState.currentTrackIndex === index) li.classList.add('playing');

        const thumb = document.createElement('div');
        thumb.style.width = '40px'; thumb.style.height = '40px'; thumb.style.borderRadius = '4px';
        thumb.style.backgroundColor = 'var(--bg-surface)'; thumb.style.backgroundSize = 'cover';
        thumb.style.display = 'flex'; thumb.style.alignItems = 'center'; thumb.style.justifyContent = 'center';
        if (track.thumbnailDataUrl) thumb.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
        else thumb.innerHTML = '<span class="material-symbols-outlined" style="font-size:20px; color:var(--text-secondary);">music_note</span>';

        const info = document.createElement('div');
        info.className = 'track-list-info';
        
        let tagsHtml = '';
        if (track.tags && track.tags.length > 0) {
            tagsHtml = `<div class="track-list-tags">` + 
                track.tags.map(t => {
                    const tObj = typeof t === 'string' ? {text: t, color: '#cccccc'} : t;
                    const bgColor = hexToRgba(tObj.color, 0.15); // 透明度15%の背景色
                    return `<span class="track-list-tag" style="border-color: ${tObj.color}; background-color: ${bgColor};" title="${tObj.text}">${tObj.text}</span>`;
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

// === プレイリスト ===
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
        request.onsuccess = () => resolve(request.result); request.onerror = (e) => reject(e.target.error);
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

// === 情報編集ページ ===
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
    renderAvailableTags(); // ★既存タグ一覧を表示

    const preview = document.getElementById('edit-thumbnail-preview');
    if (track.thumbnailDataUrl) {
        preview.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
        preview.innerHTML = '';
    } else {
        preview.style.backgroundImage = 'none';
        preview.innerHTML = '<span class="material-symbols-outlined">image</span>';
    }
}

// ★追加：既存タグをリストアップしてクリックで追加できるようにする
function renderAvailableTags() {
    const container = document.getElementById('available-tags-list');
    if (!container) return;
    container.innerHTML = '';
    
    const allTags = getAllUniqueTags();
    // すでにセットされているタグは候補から消す
    const currentTagTexts = appState.editingTags.map(t => t.text);
    const availableTags = allTags.filter(t => !currentTagTexts.includes(t.text));

    availableTags.forEach(tag => {
        const chip = document.createElement('div');
        chip.className = 'available-tag-chip';
        chip.textContent = '+ ' + tag.text;
        chip.title = tag.text; // マウスオーバーで全文表示
        chip.style.borderColor = tag.color;
        chip.style.backgroundColor = hexToRgba(tag.color, 0.1);

        chip.addEventListener('click', () => {
            appState.editingTags.push({ text: tag.text, color: tag.color });
            renderEditTags();
            renderAvailableTags(); // 候補から消去
        });
        container.appendChild(chip);
    });
}

function initEditPage() {
    const tagInput = document.getElementById('edit-tags-input');
    
    tagInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const tagText = tagInput.value.trim();
            if (tagText && !appState.editingTags.find(t => t.text === tagText)) {
                // 入力された文字が既存タグにあればその色を、なければ新規色を割り当て
                const existingTags = getAllUniqueTags();
                const existing = existingTags.find(t => t.text === tagText);
                const color = existing ? existing.color : getTagColorHex(tagText);

                appState.editingTags.push({ text: tagText, color: color });
                renderEditTags();
                renderAvailableTags();
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
        renderAvailableTags(); // 他の曲用にもタグ候補を更新
    });
}

// ★変更：タグを「縁取り＋薄い背景色」にし、クリックで編集モーダルを開く
function renderEditTags() {
    const list = document.getElementById('edit-tags-list');
    list.innerHTML = '';
    
    appState.editingTags.forEach((tagObj, index) => {
        const span = document.createElement('span');
        span.className = 'tag-item';
        span.style.borderColor = tagObj.color; 
        span.style.backgroundColor = hexToRgba(tagObj.color, 0.15); // 背景を薄くする
        
        span.innerHTML = `
            <span class="tag-text" data-index="${index}" title="${tagObj.text} (クリックで編集)">${tagObj.text}</span>
            <span class="material-symbols-outlined remove-tag" data-index="${index}" title="削除">close</span>
        `;
        list.appendChild(span);
    });

    // 削除ボタン
    document.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = e.target.getAttribute('data-index');
            appState.editingTags.splice(index, 1);
            renderEditTags();
            renderAvailableTags();
        });
    });

    // タグ名をクリックで編集モーダルを開く
    document.querySelectorAll('.tag-text').forEach(textEl => {
        textEl.addEventListener('click', (e) => {
            const index = e.target.getAttribute('data-index');
            openTagEditModal(index);
        });
    });
}

// === ★追加：タグ編集モーダルの処理 ===
let editingTagIndex = null;

function initTagEditModal() {
    const modal = document.getElementById('tag-edit-modal');
    
    document.getElementById('tag-edit-cancel').addEventListener('click', () => {
        modal.style.display = 'none';
        editingTagIndex = null;
    });

    document.getElementById('tag-edit-save').addEventListener('click', () => {
        if (editingTagIndex !== null) {
            const newText = document.getElementById('tag-edit-name').value.trim();
            const newColor = document.getElementById('tag-edit-color').value;
            if (newText) {
                appState.editingTags[editingTagIndex].text = newText;
                appState.editingTags[editingTagIndex].color = newColor;
                renderEditTags();
            }
        }
        modal.style.display = 'none';
        editingTagIndex = null;
    });
}

function openTagEditModal(index) {
    editingTagIndex = index;
    const tag = appState.editingTags[index];
    document.getElementById('tag-edit-name').value = tag.text;
    document.getElementById('tag-edit-color').value = tag.color;
    document.getElementById('tag-edit-modal').style.display = 'flex';
}
