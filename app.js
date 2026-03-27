/**
 * app.js - Web Music Player
 * 第7弾: プレイリストへの曲追加・削除、プレイリストの削除機能
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
    editingTags: [],
    allKnownTags: new Map(),
    currentPlaylistId: null // ★現在表示中のプレイリストID（"すべて"の時はnull）
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
        } else playTrack(0);
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
    
    appState.allKnownTags.clear();
    appState.tracks.forEach(t => {
        if(t.tags) t.tags.forEach(tag => {
            const tagObj = typeof tag === 'string' ? {text: tag, color: getTagColorHex(tag)} : tag;
            if(!appState.allKnownTags.has(tagObj.text)) {
                appState.allKnownTags.set(tagObj.text, tagObj);
            }
        });
    });
    updateTagsDatalist();

    // ★現在プレイリストを開いていなければ、すべて表示を更新
    if (!appState.currentPlaylistId) {
        appState.currentQueue = [...appState.tracks].sort((a, b) => b.addedAt - a.addedAt);
        renderMainTrackList(); 
    } else {
        // プレイリストを開いている場合は、そのリストの中身を再構築して表示
        const pl = appState.playlists.find(p => p.id === appState.currentPlaylistId);
        if (pl) {
            appState.currentQueue = appState.tracks.filter(t => pl.trackIds.includes(t.id));
            renderMainTrackList();
        }
    }
    
    renderSidebarLibrary();
    renderEditLibraryList(appState.tracks);
}

function updateTagsDatalist() {
    let dl = document.getElementById('existing-tags-list');
    if (!dl) {
        dl = document.createElement('datalist');
        dl.id = 'existing-tags-list';
        document.body.appendChild(dl);
        const tagInput = document.getElementById('edit-tags-input');
        if (tagInput) tagInput.setAttribute('list', 'existing-tags-list');
    }
    dl.innerHTML = '';
    appState.allKnownTags.forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag.text;
        dl.appendChild(opt);
    });
}

function renderSidebarLibrary() {
    const list = document.getElementById('my-library-list');
    list.innerHTML = '';
    const allItem = document.createElement('li');
    allItem.style.padding = '10px'; allItem.style.cursor = 'pointer'; allItem.style.fontWeight = 'bold';
    allItem.innerHTML = `<span class="material-symbols-outlined">library_music</span> すべての曲 (${appState.tracks.length})`;
    allItem.addEventListener('click', () => {
        appState.currentPlaylistId = null; // ★すべて表示に戻る
        document.getElementById('current-playlist-name').textContent = "マイライブラリ (すべて)";
        appState.currentQueue = [...appState.tracks].sort((a, b) => b.addedAt - a.addedAt);
        renderMainTrackList();
    });
    list.appendChild(allItem);
}

// ★曲リストに「プレイリスト追加・削除」ボタンを実装
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
                    return `<span class="track-list-tag" style="border: 1px solid ${tObj.color}; background-color: ${tObj.color}33;" title="${tObj.text}">${tObj.text}</span>`;
                }).join('') + `</div>`;
        }

        info.innerHTML = `
            <div class="track-list-title">${track.title}</div>
            <div class="track-list-artist">${track.artist}</div>
            ${tagsHtml}
        `;

        // ★アクションボタンの作成
        const actions = document.createElement('div');
        actions.className = 'track-actions';

        // プレイリストに追加ボタン
        const addBtn = document.createElement('button');
        addBtn.className = 'icon-btn';
        addBtn.innerHTML = '<span class="material-symbols-outlined">playlist_add</span>';
        addBtn.title = 'プレイリストに追加';
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 行全体のクリック判定（再生）を防ぐ
            openAddToPlaylistModal(track.id);
        });
        actions.appendChild(addBtn);

        // 現在プレイリストを開いている場合のみ「削除」ボタンを表示
        if (appState.currentPlaylistId) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'icon-btn';
            removeBtn.innerHTML = '<span class="material-symbols-outlined">playlist_remove</span>';
            removeBtn.title = 'このリストから削除';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeTrackFromPlaylist(appState.currentPlaylistId, track.id);
            });
            actions.appendChild(removeBtn);
        }

        li.appendChild(thumb);
        li.appendChild(info);
        li.appendChild(actions); // アクションボタンを追加
        
        li.addEventListener('click', () => playTrack(index));
        container.appendChild(li);
    });
}

// === ★プレイリスト管理の追加機能 ===

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
        li.className = 'playlist-item';
        
        const label = document.createElement('div');
        label.style.display = 'flex'; label.style.alignItems = 'center'; label.style.gap = '8px';
        label.innerHTML = `<span class="material-symbols-outlined">queue_music</span> ${pl.name} (${pl.trackIds.length})`;
        
        // ★プレイリスト削除ボタン
        const delBtn = document.createElement('span');
        delBtn.className = 'material-symbols-outlined remove-playlist';
        delBtn.textContent = 'delete';
        delBtn.title = 'プレイリストを削除';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // プレイリストを開く判定を防ぐ
            deletePlaylist(pl.id, pl.name);
        });

        li.appendChild(label);
        li.appendChild(delBtn);

        li.addEventListener('click', () => {
            appState.currentPlaylistId = pl.id; // ★今開いているIDをセット
            document.getElementById('current-playlist-name').textContent = pl.name;
            appState.currentQueue = appState.tracks.filter(t => pl.trackIds.includes(t.id));
            renderMainTrackList();
        });
        container.appendChild(li);
    });
}

// プレイリストを選択して曲を追加するモーダル
function openAddToPlaylistModal(trackId) {
    if (appState.playlists.length === 0) {
        alert("プレイリストがまだありません。左のメニューから作成してください。");
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    
    let listHtml = '';
    appState.playlists.forEach(pl => {
        listHtml += `<div class="modal-playlist-item" data-id="${pl.id}">
            <span class="material-symbols-outlined">queue_music</span> ${pl.name}
        </div>`;
    });

    modal.innerHTML = `
        <div class="modal-content">
            <h3 style="font-size: 14px; color: var(--text-primary);">どのリストに追加しますか？</h3>
            <div style="max-height: 200px; overflow-y: auto; margin-top: 8px;">
                ${listHtml}
            </div>
            <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
                <button id="close-pl-modal" class="secondary-btn" style="padding: 6px 12px; font-size: 12px;">キャンセル</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('close-pl-modal').addEventListener('click', () => modal.remove());
    
    modal.querySelectorAll('.modal-playlist-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            const playlistId = e.currentTarget.getAttribute('data-id');
            await addTrackToPlaylist(playlistId, trackId);
            modal.remove();
        });
    });
}

async function addTrackToPlaylist(playlistId, trackId) {
    const pl = appState.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    
    if (pl.trackIds.includes(trackId)) {
        alert("すでにこのリストに追加されています。");
        return;
    }

    pl.trackIds.push(trackId);
    const transaction = db.transaction(['playlists'], 'readwrite');
    transaction.objectStore('playlists').put(pl);
    
    transaction.oncomplete = async () => {
        await loadPlaylists(); // プレイリスト一覧（曲数など）を更新
        if (appState.currentPlaylistId === playlistId) {
            // もし追加したリストを開いていたら表示も更新
            appState.currentQueue = appState.tracks.filter(t => pl.trackIds.includes(t.id));
            renderMainTrackList();
        }
        alert(`「${pl.name}」に追加しました！`);
    };
}

async function removeTrackFromPlaylist(playlistId, trackId) {
    if (!confirm("この曲をプレイリストから外しますか？（曲データ自体は消えません）")) return;

    const pl = appState.playlists.find(p => p.id === playlistId);
    if (!pl) return;

    pl.trackIds = pl.trackIds.filter(id => id !== trackId);
    
    const transaction = db.transaction(['playlists'], 'readwrite');
    transaction.objectStore('playlists').put(pl);
    
    transaction.oncomplete = async () => {
        await loadPlaylists();
        appState.currentQueue = appState.tracks.filter(t => pl.trackIds.includes(t.id));
        renderMainTrackList();
    };
}

async function deletePlaylist(playlistId, playlistName) {
    if (!confirm(`プレイリスト「${playlistName}」を削除しますか？\n（中の曲データは消えません）`)) return;

    const transaction = db.transaction(['playlists'], 'readwrite');
    transaction.objectStore('playlists').delete(playlistId);
    
    transaction.oncomplete = async () => {
        await loadPlaylists();
        // もし削除したリストを今開いていたら、「すべて」表示に戻す
        if (appState.currentPlaylistId === playlistId) {
            appState.currentPlaylistId = null;
            document.getElementById('current-playlist-name').textContent = "マイライブラリ (すべて)";
            appState.currentQueue = [...appState.tracks].sort((a, b) => b.addedAt - a.addedAt);
            renderMainTrackList();
        }
    };
}

// === 情報編集 ===
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
                const existing = appState.allKnownTags.get(tagText);
                const color = existing ? existing.color : getTagColorHex(tagText);
                
                appState.editingTags.push({ text: tagText, color: color });
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
            const index = e.target.getAttribute('data-index');
            appState.editingTags.splice(index, 1);
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
            <h3 style="font-size: 14px; color: var(--text-primary);">タグを編集</h3>
            <div class="form-group" style="margin-top: 8px;">
                <label style="font-size: 12px;">タグ名</label>
                <input type="text" id="modal-tag-name" value="${tagObj.text}">
            </div>
            <div class="form-group" style="margin-top: 4px;">
                <label style="font-size: 12px;">色</label>
                <input type="color" id="modal-tag-color" value="${tagObj.color}" style="border: none; width: 100%; height: 32px; padding: 0; cursor: pointer; border-radius: 4px;">
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;">
                <button id="modal-cancel" class="secondary-btn" style="padding: 6px 12px; font-size: 12px;">キャンセル</button>
                <button id="modal-save" class="primary-btn" style="padding: 6px 12px; font-size: 12px;">確定</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

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
