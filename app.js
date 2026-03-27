/**
 * app.js - Web Music Player
 * 第8弾: 検索、並び替え、複数選択による一括処理（追加/削除/タグ付け/完全削除）
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
    allKnownTags: new Map(),
    currentPlaylistId: null,
    
    // ★追加: 検索・ソート・選択状態の管理
    searchQueryMain: "",
    sortModeMain: "date_desc", // date_desc, date_asc, name_asc, name_desc, artist_asc
    selectedMainTracks: new Set(),
    
    // ★追加: 編集画面用の状態
    searchQueryEdit: "",
    selectedEditTracks: new Set(),
    editingTags: []
};

document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initDragAndDrop();
    initPlayerControls(); 
    initPlaylists();
    initSearchAndSort();
    initBulkActions();
    initEditPage();      
    
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
            
            // ページ切り替え時に選択状態をリセット
            appState.selectedMainTracks.clear();
            appState.selectedEditTracks.clear();
            updateBulkActionBar();
            if(targetId === 'edit') renderEditLibraryList();
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

// === ★検索と並び替えの初期化 ===
function initSearchAndSort() {
    // メイン画面の検索
    const mainSearch = document.getElementById('main-search-input');
    if (mainSearch) {
        mainSearch.addEventListener('input', (e) => {
            appState.searchQueryMain = e.target.value.toLowerCase();
            updateMainQueue();
        });
    }

    // メイン画面のソート
    const sortSelect = document.getElementById('main-sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            appState.sortModeMain = e.target.value;
            updateMainQueue();
        });
    }

    // 編集画面の検索
    const editSearch = document.getElementById('edit-search-input');
    if (editSearch) {
        editSearch.addEventListener('input', (e) => {
            appState.searchQueryEdit = e.target.value.toLowerCase();
            renderEditLibraryList();
        });
    }
}

// リストのフィルタリングとソートを実行して描画
function updateMainQueue() {
    let baseList = [];
    if (!appState.currentPlaylistId) {
        baseList = [...appState.tracks];
    } else {
        const pl = appState.playlists.find(p => p.id === appState.currentPlaylistId);
        if (pl) {
            // プレイリストの並び順（追加された順）を維持しつつトラックを取得
            baseList = pl.trackIds.map(id => appState.tracks.find(t => t.id === id)).filter(Boolean);
        }
    }

    // 検索フィルタ
    if (appState.searchQueryMain) {
        baseList = baseList.filter(t => {
            const titleMatch = t.title.toLowerCase().includes(appState.searchQueryMain);
            const artistMatch = t.artist.toLowerCase().includes(appState.searchQueryMain);
            const tagMatch = t.tags && t.tags.some(tag => {
                const text = typeof tag === 'string' ? tag : tag.text;
                return text.toLowerCase().includes(appState.searchQueryMain);
            });
            return titleMatch || artistMatch || tagMatch;
        });
    }

    // ソート
    baseList.sort((a, b) => {
        switch (appState.sortModeMain) {
            case 'date_desc': return b.addedAt - a.addedAt;
            case 'date_asc': return a.addedAt - b.addedAt;
            case 'name_asc': return a.title.localeCompare(b.title);
            case 'name_desc': return b.title.localeCompare(a.title);
            case 'artist_asc': return a.artist.localeCompare(b.artist);
            default: return 0;
        }
    });

    appState.currentQueue = baseList;
    renderMainTrackList();
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

    updateMainQueue(); // ★検索・ソートを適用して再描画
    renderSidebarLibrary();
    renderEditLibraryList();
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
        appState.currentPlaylistId = null; 
        document.getElementById('current-playlist-name').textContent = "マイライブラリ (すべて)";
        appState.selectedMainTracks.clear();
        updateMainQueue();
    });
    list.appendChild(allItem);
}

// ★メイン画面のリスト描画（チェックボックス追加）
function renderMainTrackList() {
    const container = document.getElementById('current-playlist-items');
    container.innerHTML = '';
    
    updateBulkActionBar();

    appState.currentQueue.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'track-list-item';
        if (appState.isPlaying && appState.currentTrackIndex === index) li.classList.add('playing');

        // ★チェックボックス
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

        const actions = document.createElement('div');
        actions.className = 'track-actions';

        const addBtn = document.createElement('button');
        addBtn.className = 'icon-btn';
        addBtn.innerHTML = '<span class="material-symbols-outlined">playlist_add</span>';
        addBtn.title = 'プレイリストに追加';
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openAddToPlaylistModal([track.id]); // 配列で渡す
        });
        actions.appendChild(addBtn);

        if (appState.currentPlaylistId) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'icon-btn';
            removeBtn.innerHTML = '<span class="material-symbols-outlined">playlist_remove</span>';
            removeBtn.title = 'このリストから削除';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeTracksFromPlaylist(appState.currentPlaylistId, [track.id]);
            });
            actions.appendChild(removeBtn);
        }

        // 個別・完全削除ボタン
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn';
        deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete_forever</span>';
        deleteBtn.title = 'ライブラリから完全削除';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTracksCompletely([track.id]);
        });
        actions.appendChild(deleteBtn);

        li.appendChild(checkbox); // 追加
        li.appendChild(thumb);
        li.appendChild(info);
        li.appendChild(actions); 
        
        // 曲情報の領域をクリックした時だけ再生（チェックボックス等は除く）
        info.addEventListener('click', () => playTrack(index));
        thumb.addEventListener('click', () => playTrack(index));
        
        container.appendChild(li);
    });
}

// === ★一括操作機能（バルクアクション） ===

function updateBulkActionBar() {
    const bar = document.getElementById('bulk-actions-bar');
    const countSpan = document.getElementById('bulk-count');
    const count = appState.selectedMainTracks.size;
    
    if (count > 0) {
        bar.classList.add('active');
        countSpan.textContent = `${count}曲を選択中`;
        
        // プレイリスト表示中のみ「リストから外す」を表示
        const btnRemove = document.getElementById('bulk-remove-playlist-btn');
        btnRemove.style.display = appState.currentPlaylistId ? 'inline-flex' : 'none';
    } else {
        bar.classList.remove('active');
    }
}

function initBulkActions() {
    document.getElementById('bulk-add-playlist-btn').addEventListener('click', () => {
        openAddToPlaylistModal(Array.from(appState.selectedMainTracks));
    });

    document.getElementById('bulk-remove-playlist-btn').addEventListener('click', () => {
        if(appState.currentPlaylistId) {
            removeTracksFromPlaylist(appState.currentPlaylistId, Array.from(appState.selectedMainTracks));
        }
    });

    document.getElementById('bulk-delete-btn').addEventListener('click', () => {
        deleteTracksCompletely(Array.from(appState.selectedMainTracks));
    });
}

async function deleteTracksCompletely(trackIds) {
    if (!confirm(`${trackIds.length}曲をライブラリから完全に削除しますか？\n（この操作は元に戻せません）`)) return;

    const transaction = db.transaction(['tracks', 'playlists'], 'readwrite');
    const tracksStore = transaction.objectStore('tracks');
    const playlistsStore = transaction.objectStore('playlists');

    // 1. 各プレイリストからもIDを削除
    const playlistsRequest = playlistsStore.getAll();
    playlistsRequest.onsuccess = () => {
        const playlists = playlistsRequest.result;
        playlists.forEach(pl => {
            let changed = false;
            trackIds.forEach(id => {
                const index = pl.trackIds.indexOf(id);
                if (index !== -1) {
                    pl.trackIds.splice(index, 1);
                    changed = true;
                }
            });
            if (changed) playlistsStore.put(pl);
        });
    };

    // 2. トラック自体を削除
    trackIds.forEach(id => tracksStore.delete(id));

    transaction.oncomplete = async () => {
        appState.selectedMainTracks.clear();
        appState.selectedEditTracks.clear();
        await loadPlaylists();
        await loadLibrary();
    };
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
        li.className = 'playlist-item';
        
        const label = document.createElement('div');
        label.style.display = 'flex'; label.style.alignItems = 'center'; label.style.gap = '8px';
        label.innerHTML = `<span class="material-symbols-outlined">queue_music</span> ${pl.name} (${pl.trackIds.length})`;
        
        const delBtn = document.createElement('span');
        delBtn.className = 'material-symbols-outlined remove-playlist';
        delBtn.textContent = 'delete';
        delBtn.title = 'プレイリストを削除';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            deletePlaylist(pl.id, pl.name);
        });

        li.appendChild(label);
        li.appendChild(delBtn);

        li.addEventListener('click', () => {
            appState.currentPlaylistId = pl.id; 
            document.getElementById('current-playlist-name').textContent = pl.name;
            appState.selectedMainTracks.clear();
            updateMainQueue();
        });
        container.appendChild(li);
    });
}

// 配列対応版のプレイリスト追加
function openAddToPlaylistModal(trackIdsArray) {
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
            <h3 style="font-size: 14px; color: var(--text-primary);">どのリストに追加しますか？(${trackIdsArray.length}曲)</h3>
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
            await addTracksToPlaylist(playlistId, trackIdsArray);
            modal.remove();
        });
    });
}

async function addTracksToPlaylist(playlistId, trackIdsArray) {
    const pl = appState.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    
    let addedCount = 0;
    trackIdsArray.forEach(id => {
        if (!pl.trackIds.includes(id)) {
            pl.trackIds.push(id);
            addedCount++;
        }
    });

    if (addedCount === 0) {
        alert("すでにすべての曲がリストに追加されています。");
        return;
    }

    const transaction = db.transaction(['playlists'], 'readwrite');
    transaction.objectStore('playlists').put(pl);
    
    transaction.oncomplete = async () => {
        appState.selectedMainTracks.clear();
        await loadPlaylists(); 
        if (appState.currentPlaylistId === playlistId) updateMainQueue();
        alert(`「${pl.name}」に ${addedCount}曲 追加しました！`);
    };
}

async function removeTracksFromPlaylist(playlistId, trackIdsArray) {
    if (!confirm(`${trackIdsArray.length}曲をプレイリストから外しますか？`)) return;

    const pl = appState.playlists.find(p => p.id === playlistId);
    if (!pl) return;

    pl.trackIds = pl.trackIds.filter(id => !trackIdsArray.includes(id));
    
    const transaction = db.transaction(['playlists'], 'readwrite');
    transaction.objectStore('playlists').put(pl);
    
    transaction.oncomplete = async () => {
        appState.selectedMainTracks.clear();
        await loadPlaylists();
        updateMainQueue();
    };
}

async function deletePlaylist(playlistId, playlistName) {
    if (!confirm(`プレイリスト「${playlistName}」を削除しますか？\n（中の曲データは消えません）`)) return;

    const transaction = db.transaction(['playlists'], 'readwrite');
    transaction.objectStore('playlists').delete(playlistId);
    
    transaction.oncomplete = async () => {
        await loadPlaylists();
        if (appState.currentPlaylistId === playlistId) {
            appState.currentPlaylistId = null;
            document.getElementById('current-playlist-name').textContent = "マイライブラリ (すべて)";
            updateMainQueue();
        }
    };
}

// === ★情報編集 (検索・複数選択・タグ表示) ===
function renderEditLibraryList() {
    const list = document.getElementById('edit-library-list');
    list.innerHTML = '';
    
    // 検索フィルタリング
    let displayTracks = appState.tracks;
    if (appState.searchQueryEdit) {
        displayTracks = displayTracks.filter(t => 
            t.title.toLowerCase().includes(appState.searchQueryEdit) || 
            t.artist.toLowerCase().includes(appState.searchQueryEdit)
        );
    }

    // 「すべて選択」ボタンのようなものをヘッダーに置くのもありですが、今回はシンプルにチェックボックスのみ
    document.getElementById('edit-selected-count').textContent = 
        appState.selectedEditTracks.size > 0 ? `${appState.selectedEditTracks.size}曲を選択中` : '曲を選択して編集';

    displayTracks.forEach(track => {
        const li = document.createElement('li');
        li.className = 'edit-list-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'custom-checkbox';
        checkbox.checked = appState.selectedEditTracks.has(track.id);
        
        checkbox.addEventListener('change', (e) => {
            if(e.target.checked) appState.selectedEditTracks.add(track.id);
            else appState.selectedEditTracks.delete(track.id);
            
            // 1曲だけ選ばれた時は、その曲の情報をフォームに自動入力する
            if (appState.selectedEditTracks.size === 1) {
                const singleId = Array.from(appState.selectedEditTracks)[0];
                const t = appState.tracks.find(x => x.id === singleId);
                openEditForm(t);
            } else if (appState.selectedEditTracks.size > 1) {
                // 複数選択時はフォームを「複数編集モード」にする
                openBulkEditForm();
            } else {
                clearEditForm();
            }
            
            document.getElementById('edit-selected-count').textContent = 
                appState.selectedEditTracks.size > 0 ? `${appState.selectedEditTracks.size}曲を選択中` : '曲を選択して編集';
        });

        const content = document.createElement('div');
        content.className = 'edit-list-content';
        
        let tagsHtml = '';
        if (track.tags && track.tags.length > 0) {
            tagsHtml = `<div class="edit-list-tags">` + 
                track.tags.map(t => {
                    const text = typeof t === 'string' ? t : t.text;
                    const color = typeof t === 'string' ? '#ccc' : t.color;
                    return `<span style="border:1px solid ${color}; padding: 1px 4px; border-radius: 4px;">${text}</span>`;
                }).join('') + `</div>`;
        }

        content.innerHTML = `
            <div class="edit-list-title">${track.title}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">${track.artist}</div>
            ${tagsHtml}
        `;

        li.appendChild(checkbox);
        li.appendChild(content);
        
        // テキスト部分クリックでチェックボックスのオンオフを切り替え
        content.addEventListener('click', () => {
            checkbox.click();
        });

        list.appendChild(li);
    });
}

function clearEditForm() {
    document.getElementById('edit-form-area').style.display = 'none';
}

function openEditForm(track) {
    document.getElementById('edit-form-area').style.display = 'flex';
    document.getElementById('edit-title').value = track.title || '';
    document.getElementById('edit-title').disabled = false;
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

// 複数選択時のフォーム表示
function openBulkEditForm() {
    document.getElementById('edit-form-area').style.display = 'flex';
    document.getElementById('edit-title').value = '（複数選択中のため変更不可）';
    document.getElementById('edit-title').disabled = true;
    
    // アーティストや日付は空にしておき、入力されたら上書きする仕様にする
    document.getElementById('edit-artist').value = '';
    document.getElementById('edit-date').value = '';
    
    appState.editingTags = []; // タグは空からスタートし、追加したタグを全曲に付与する
    renderEditTags();

    const preview = document.getElementById('edit-thumbnail-preview');
    preview.style.backgroundImage = 'none';
    preview.innerHTML = '<span class="material-symbols-outlined">library_music</span>';
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
        if (appState.selectedEditTracks.size === 0) return;
        
        const isBulk = appState.selectedEditTracks.size > 1;
        const newArtist = document.getElementById('edit-artist').value.trim();
        const newDate = document.getElementById('edit-date').value;

        const transaction = db.transaction(['tracks'], 'readwrite');
        const store = transaction.objectStore('tracks');

        appState.selectedEditTracks.forEach(id => {
            const track = appState.tracks.find(t => t.id === id);
            if (track) {
                // 単一編集ならタイトルも更新
                if (!isBulk) {
                    track.title = document.getElementById('edit-title').value;
                    track.artist = newArtist;
                    track.date = newDate;
                    track.tags = [...appState.editingTags];
                } else {
                    // 複数編集なら、入力された項目だけ上書き、タグは「追加」する
                    if (newArtist) track.artist = newArtist;
                    if (newDate) track.date = newDate;
                    
                    // 既存タグに新しいタグを結合（重複排除）
                    let combinedTags = [...(track.tags || [])];
                    appState.editingTags.forEach(newTag => {
                        const exists = combinedTags.find(t => (typeof t === 'string' ? t : t.text) === newTag.text);
                        if (!exists) combinedTags.push(newTag);
                    });
                    track.tags = combinedTags;
                }
                store.put(track);
            }
        });

        transaction.oncomplete = async () => {
            await loadLibrary(); 
            alert(`${appState.selectedEditTracks.size}曲の情報を保存しました！`);
            appState.selectedEditTracks.clear();
            renderEditLibraryList();
            clearEditForm();
        };
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
