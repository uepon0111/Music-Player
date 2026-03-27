/**
 * app.js - Web Music Player
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
    
    searchQueryMain: "",
    sortModeMain: "manual",
    selectedMainTracks: new Set(),
    
    searchQueryEdit: "",
    selectedEditTracks: new Set(),
    editingTags: [],

    // フェーズ3用: アカウント状態
    isLoggedIn: false,
    user: null
};

document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initAuthUI(); // フェーズ3準備
    initDragAndDrop();
    initPlayerControls(); 
    initPlaylists();
    initSearchAndSort();
    initBulkActions();
    initEditPage();      
    initPlaylistPlaybackControls(); // ★追加: すべて再生/シャッフル機能
    
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
            
            appState.selectedMainTracks.clear();
            updateBulkActionBar();
            
            if(targetId === 'edit') renderEditLibraryList();
        });
    });
}

// ★フェーズ3準備: ログインUIの初期化
function initAuthUI() {
    const btnLogin = document.getElementById('btn-login');
    const btnLogout = document.getElementById('btn-logout');

    btnLogin.addEventListener('click', () => {
        // ※次回ここにGoogle Identity Servicesの呼び出しを実装します
        alert("次回フェーズでGoogle認証のポップアップが表示されるように実装します。");
    });

    btnLogout.addEventListener('click', () => {
        // ※次回ここにログアウト処理を実装します
        alert("ログアウト処理を実装予定です。");
    });
}

// ★追加: リスト全体の再生/ランダム再生
function initPlaylistPlaybackControls() {
    const btnPlayAll = document.getElementById('btn-play-all');
    const btnShuffleAll = document.getElementById('btn-shuffle-all');

    btnPlayAll.addEventListener('click', () => {
        if (appState.currentQueue.length === 0) return;
        
        // ソートを通常に戻して最初から再生
        const sortSelect = document.getElementById('main-sort-select');
        if (appState.sortModeMain === 'random') {
            sortSelect.value = 'manual';
            sortSelect.dispatchEvent(new Event('change'));
        }
        playTrack(0);
    });

    btnShuffleAll.addEventListener('click', () => {
        if (appState.currentQueue.length === 0) return;
        
        // ランダムソートに変更して最初から再生
        const sortSelect = document.getElementById('main-sort-select');
        sortSelect.value = 'random';
        sortSelect.dispatchEvent(new Event('change'));
        
        playTrack(0);
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

function initSearchAndSort() {
    const mainSearch = document.getElementById('main-search-input');
    if (mainSearch) {
        mainSearch.addEventListener('input', (e) => {
            appState.searchQueryMain = e.target.value.toLowerCase();
            updateMainQueue();
        });
    }

    const sortSelect = document.getElementById('main-sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            appState.sortModeMain = e.target.value;
            updateMainQueue();
        });
    }

    const selectAllCheckbox = document.getElementById('main-select-all');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                appState.currentQueue.forEach(t => appState.selectedMainTracks.add(t.id));
            } else {
                appState.selectedMainTracks.clear();
            }
            renderMainTrackList();
        });
    }

    const editSearch = document.getElementById('edit-search-input');
    if (editSearch) {
        editSearch.addEventListener('input', (e) => {
            appState.searchQueryEdit = e.target.value.toLowerCase();
            renderEditLibraryList();
        });
    }
}

function updateMainQueue() {
    let baseList = [];
    if (!appState.currentPlaylistId) {
        baseList = [...appState.tracks];
    } else {
        const pl = appState.playlists.find(p => p.id === appState.currentPlaylistId);
        if (pl) {
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
    if (appState.sortModeMain === 'random') {
        baseList.sort(() => Math.random() - 0.5); 
    } else if (appState.sortModeMain !== 'manual') {
        baseList.sort((a, b) => {
            switch (appState.sortModeMain) {
                case 'date_desc': return b.addedAt - a.addedAt;
                case 'date_asc': return a.addedAt - b.addedAt;
                case 'name_asc': return a.title.localeCompare(b.title);
                case 'name_desc': return b.title.localeCompare(a.title);
                case 'artist_asc': return (a.artist||'').localeCompare(b.artist||'');
                case 'artist_desc': return (b.artist||'').localeCompare(a.artist||'');
                case 'release_desc': return (b.date||'').localeCompare(a.date||'');
                case 'release_asc': return (a.date||'').localeCompare(b.date||'');
                default: return 0;
            }
        });
    }

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
    
    // 現在はローカルのFileBlobを使用（フェーズ3でDrive APIのストリームに分岐します）
    if (track.fileBlob) {
        currentObjectUrl = URL.createObjectURL(track.fileBlob);
        audioPlayer.src = currentObjectUrl;
    }

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
            date: "", tags: [], thumbnailDataUrl: meta.picture || null, 
            addedAt: Date.now(), sortOrder: Date.now()
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
    
    appState.tracks.sort((a, b) => {
        const orderA = a.sortOrder !== undefined ? a.sortOrder : a.addedAt;
        const orderB = b.sortOrder !== undefined ? b.sortOrder : b.addedAt;
        return orderA - orderB;
    });
    
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

    updateMainQueue();
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

function saveManualOrder() {
    if (appState.currentPlaylistId) {
        const pl = appState.playlists.find(p => p.id === appState.currentPlaylistId);
        if (pl) {
            pl.trackIds = appState.currentQueue.map(t => t.id);
            const tx = db.transaction(['playlists'], 'readwrite');
            tx.objectStore('playlists').put(pl);
        }
    } else {
        if (!appState.searchQueryMain) {
            appState.tracks = [...appState.currentQueue];
            const tx = db.transaction(['tracks'], 'readwrite');
            const store = tx.objectStore('tracks');
            appState.tracks.forEach((t, i) => {
                t.sortOrder = i;
                store.put(t);
            });
        }
    }
}

function renderMainTrackList() {
    const container = document.getElementById('current-playlist-items');
    container.innerHTML = '';
    
    const selectAllCb = document.getElementById('main-select-all');
    if (appState.currentQueue.length > 0 && appState.selectedMainTracks.size === appState.currentQueue.length) {
        selectAllCb.checked = true;
    } else {
        selectAllCb.checked = false;
    }

    updateBulkActionBar();

    let draggedItemIndex = null;

    appState.currentQueue.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'track-list-item';
        if (appState.isPlaying && appState.currentTrackIndex === index) li.classList.add('playing');

        if (appState.sortModeMain === 'manual') {
            li.draggable = true;
            li.style.cursor = 'grab';
            
            li.addEventListener('dragstart', (e) => {
                draggedItemIndex = index;
                e.dataTransfer.effectAllowed = 'move';
                li.style.opacity = '0.5';
            });
            
            li.addEventListener('dragend', () => {
                li.style.opacity = '1';
                draggedItemIndex = null;
            });
            
            li.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                li.style.borderTop = '2px solid var(--accent-color)';
            });
            
            li.addEventListener('dragleave', () => {
                li.style.borderTop = '';
            });
            
            li.addEventListener('drop', (e) => {
                e.preventDefault();
                li.style.borderTop = '';
                
                if (draggedItemIndex === null || draggedItemIndex === index) return;
                
                const draggedTrack = appState.currentQueue.splice(draggedItemIndex, 1)[0];
                appState.currentQueue.splice(index, 0, draggedTrack);
                
                if (appState.currentTrackIndex === draggedItemIndex) {
                    appState.currentTrackIndex = index;
                } else if (appState.currentTrackIndex > draggedItemIndex && appState.currentTrackIndex <= index) {
                    appState.currentTrackIndex--;
                } else if (appState.currentTrackIndex < draggedItemIndex && appState.currentTrackIndex >= index) {
                    appState.currentTrackIndex++;
                }

                saveManualOrder();
                renderMainTrackList();
            });
        }

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'custom-checkbox';
        checkbox.checked = appState.selectedMainTracks.has(track.id);
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) appState.selectedMainTracks.add(track.id);
            else appState.selectedMainTracks.delete(track.id);
            renderMainTrackList(); 
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
            openAddToPlaylistModal([track.id]); 
        });
        actions.appendChild(addBtn);

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn';
        editBtn.innerHTML = '<span class="material-symbols-outlined">edit</span>';
        editBtn.title = '情報を編集';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            jumpToEdit([track.id]);
        });
        actions.appendChild(editBtn);

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

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn';
        deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete_forever</span>';
        deleteBtn.title = 'ライブラリから完全削除';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTracksCompletely([track.id]);
        });
        actions.appendChild(deleteBtn);

        li.appendChild(checkbox); 
        li.appendChild(thumb);
        li.appendChild(info);
        li.appendChild(actions); 
        
        info.addEventListener('click', () => playTrack(index));
        thumb.addEventListener('click', () => playTrack(index));
        
        container.appendChild(li);
    });
}

function updateBulkActionBar() {
    const bar = document.getElementById('bulk-actions-bar');
    const countSpan = document.getElementById('bulk-count');
    const count = appState.selectedMainTracks.size;
    
    if (count > 0) {
        bar.classList.add('active');
        countSpan.textContent = `${count}曲を選択中`;
        
        const btnRemove = document.getElementById('bulk-remove-playlist-btn');
        btnRemove.style.display = appState.currentPlaylistId ? 'inline-flex' : 'none';
    } else {
        bar.classList.remove('active');
    }
}

function jumpToEdit(trackIdsArray) {
    appState.selectedEditTracks.clear();
    trackIdsArray.forEach(id => appState.selectedEditTracks.add(id));
    
    const editTabBtn = document.querySelector('.nav-btn[data-target="edit"]');
    if(editTabBtn) editTabBtn.click();
}

function initBulkActions() {
    document.getElementById('bulk-add-playlist-btn').addEventListener('click', () => {
        openAddToPlaylistModal(Array.from(appState.selectedMainTracks));
    });

    document.getElementById('bulk-edit-btn').addEventListener('click', () => {
        jumpToEdit(Array.from(appState.selectedMainTracks));
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

function renderEditLibraryList() {
    const list = document.getElementById('edit-library-list');
    list.innerHTML = '';
    
    let displayTracks = appState.tracks;
    if (appState.searchQueryEdit) {
        displayTracks = displayTracks.filter(t => 
            t.title.toLowerCase().includes(appState.searchQueryEdit) || 
            t.artist.toLowerCase().includes(appState.searchQueryEdit)
        );
    }

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
            
            checkEditFormState();
        });

        const content = document.createElement('div');
        content.className = 'edit-list-content';
        
        let tagsHtml = '';
        if (track.tags && track.tags.length > 0) {
            tagsHtml = `<div class="edit-list-tags" style="display:flex; gap:4px; margin-top:4px;">` + 
                track.tags.map(t => {
                    const text = typeof t === 'string' ? t : t.text;
                    const color = typeof t === 'string' ? '#ccc' : t.color;
                    return `<span class="track-list-tag" style="border: 1px solid ${color}; background-color: ${color}33;" title="${text}">${text}</span>`;
                }).join('') + `</div>`;
        }

        content.innerHTML = `
            <div class="edit-list-title">${track.title}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">${track.artist}</div>
            ${tagsHtml}
        `;

        li.appendChild(checkbox);
        li.appendChild(content);
        
        content.addEventListener('click', () => {
            checkbox.click();
        });

        list.appendChild(li);
    });
    
    checkEditFormState();
}

function checkEditFormState() {
    document.getElementById('edit-selected-count').textContent = 
        appState.selectedEditTracks.size > 0 ? `${appState.selectedEditTracks.size}曲を選択中` : '曲を選択して編集';

    if (appState.selectedEditTracks.size === 1) {
        const singleId = Array.from(appState.selectedEditTracks)[0];
        const t = appState.tracks.find(x => x.id === singleId);
        openEditForm(t);
    } else if (appState.selectedEditTracks.size > 1) {
        openBulkEditForm();
    } else {
        clearEditForm();
    }
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

function openBulkEditForm() {
    document.getElementById('edit-form-area').style.display = 'flex';
    document.getElementById('edit-title').value = '（複数選択中のため変更不可）';
    document.getElementById('edit-title').disabled = true;
    
    document.getElementById('edit-artist').value = '';
    document.getElementById('edit-date').value = '';
    
    appState.editingTags = []; 
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
                if (!isBulk) {
                    track.title = document.getElementById('edit-title').value;
                    track.artist = newArtist;
                    track.date = newDate;
                    track.tags = [...appState.editingTags];
                } else {
                    if (newArtist) track.artist = newArtist;
                    if (newDate) track.date = newDate;
                    
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
