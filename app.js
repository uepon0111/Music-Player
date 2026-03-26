// ==========================================
// 1. グローバル状態・定数
// ==========================================
const AppState = {
    playlists: [],
    currentPlaylistId: 'default',
    tracks: [],
    currentTrackIndex: -1,
    isPlaying: false,
    isGoogleLoggedIn: false,
    editingTrackId: null
};

const GOOGLE_CLIENT_ID = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com'; // ※ご自身のものに変更
const GOOGLE_API_KEY = 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0'; // ※ご自身のものに変更

// ==========================================
// 2. Google Drive API ログイン連携
// ==========================================
let tokenClient;
let gapiInited = false;
let gisInited = false;

window.gapiLoaded = function() {
    gapi.load('client', initializeGapiClient);
};

async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: GOOGLE_API_KEY,
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
        });
        gapiInited = true;
        checkAuthSetup();
    } catch (err) {
        console.error('Error initializing GAPI client', err);
    }
}

window.gisLoaded = function() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: '',
    });
    gisInited = true;
    checkAuthSetup();
};

function checkAuthSetup() {
    if (gapiInited && gisInited) {
        document.getElementById('auth-btn').onclick = handleAuthClick;
    }
}

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) throw (resp);
        AppState.isGoogleLoggedIn = true;
        updateAuthUI(true);
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

function updateAuthUI(isLoggedIn) {
    const btn = document.getElementById('auth-btn');
    const status = document.getElementById('auth-status');
    if (isLoggedIn) {
        status.className = 'status-text text-online';
        status.innerHTML = '<i class="fa-solid fa-cloud"></i> ログイン済';
        btn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> <span>ログアウト</span>';
        btn.onclick = () => {
            google.accounts.oauth2.revoke(gapi.client.getToken().access_token, () => {
                gapi.client.setToken('');
                AppState.isGoogleLoggedIn = false;
                updateAuthUI(false);
            });
        };
    } else {
        status.className = 'status-text text-offline';
        status.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> ローカル';
        btn.innerHTML = '<i class="fa-brands fa-google"></i> <span>ログイン</span>';
        btn.onclick = handleAuthClick;
    }
}

// ==========================================
// 3. IndexedDB (ローカルキャッシュ) 
// ==========================================
let db;
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('CloudAudioAppDB', 2);
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('audioFiles')) database.createObjectStore('audioFiles', { keyPath: 'id' });
            if (!database.objectStoreNames.contains('metadata')) {
                const metaStore = database.createObjectStore('metadata', { keyPath: 'id' });
                metaStore.createIndex('playlistId', 'playlistId', { unique: false });
            }
            if (!database.objectStoreNames.contains('playlists')) database.createObjectStore('playlists', { keyPath: 'id' });
            if (!database.objectStoreNames.contains('logs')) database.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
        };
        request.onsuccess = async (e) => {
            db = e.target.result;
            await loadPlaylists();
            resolve();
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

// ==========================================
// 4. プレイリスト管理
// ==========================================
async function loadPlaylists() {
    return new Promise((resolve) => {
        const tx = db.transaction('playlists', 'readonly');
        const store = tx.objectStore('playlists');
        const req = store.getAll();
        req.onsuccess = () => {
            let lists = req.result;
            if (lists.length === 0) {
                const defaultList = { id: 'default', name: 'デフォルトリスト' };
                db.transaction('playlists', 'readwrite').objectStore('playlists').put(defaultList);
                lists = [defaultList];
            }
            AppState.playlists = lists;
            updatePlaylistDropdown();
            loadTracks(AppState.currentPlaylistId);
            resolve();
        };
    });
}

function updatePlaylistDropdown() {
    const select = document.getElementById('playlist-select');
    select.innerHTML = '';
    AppState.playlists.forEach(pl => {
        const opt = document.createElement('option');
        opt.value = pl.id;
        opt.textContent = pl.name;
        if(pl.id === AppState.currentPlaylistId) opt.selected = true;
        select.appendChild(opt);
    });
}

document.getElementById('playlist-select').addEventListener('change', (e) => {
    AppState.currentPlaylistId = e.target.value;
    loadTracks(AppState.currentPlaylistId);
});

document.getElementById('new-playlist-btn').addEventListener('click', () => {
    const name = prompt('新しい再生リストの名前を入力:');
    if (name) {
        const newId = 'pl_' + Date.now();
        const pl = { id: newId, name: name };
        db.transaction('playlists', 'readwrite').objectStore('playlists').put(pl);
        AppState.playlists.push(pl);
        AppState.currentPlaylistId = newId;
        updatePlaylistDropdown();
        loadTracks(newId);
    }
});

document.getElementById('delete-playlist-btn').addEventListener('click', () => {
    if (AppState.playlists.length <= 1) return alert('最後のリストは削除できません');
    if (confirm('現在のリストを削除しますか？(曲も削除されます)')) {
        db.transaction('playlists', 'readwrite').objectStore('playlists').delete(AppState.currentPlaylistId);
        AppState.playlists = AppState.playlists.filter(p => p.id !== AppState.currentPlaylistId);
        AppState.currentPlaylistId = AppState.playlists[0].id;
        updatePlaylistDropdown();
        loadTracks(AppState.currentPlaylistId);
    }
});

// ==========================================
// 5. トラック読み込み・表示
// ==========================================
function loadTracks(playlistId) {
    const tx = db.transaction('metadata', 'readonly');
    const index = tx.objectStore('metadata').index('playlistId');
    const req = index.getAll(playlistId);
    req.onsuccess = () => {
        AppState.tracks = req.result;
        renderPlaylist();
    };
}

async function processAndAddFiles(files) {
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('audio/')) continue;
        
        jsmediatags.read(file, {
            onSuccess: async (tag) => await saveTrack(createTrackData(file, tag.tags)),
            onError: async () => await saveTrack(createTrackData(file, {}))
        });
    }
}

function createTrackData(file, tags) {
    let coverUrl = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23ccc"/></svg>';
    if (tags && tags.picture) {
        let base64String = "";
        for (let j = 0; j < tags.picture.data.length; j++) base64String += String.fromCharCode(tags.picture.data[j]);
        coverUrl = `data:${tags.picture.format};base64,${window.btoa(base64String)}`;
    }
    return {
        id: crypto.randomUUID(),
        file: file,
        playlistId: AppState.currentPlaylistId,
        title: (tags && tags.title) ? tags.title : file.name.replace(/\.[^/.]+$/, ""),
        artist: (tags && tags.artist) ? tags.artist : 'Unknown Artist',
        duration: 0,
        addedAt: Date.now(),
        date: (tags && tags.year) ? tags.year : '',
        tags: '',
        coverUrl: coverUrl,
        trimStart: 0,
        trimEnd: 0,
        volume: 100,
        key: 0
    };
}

async function saveTrack(trackData) {
    return new Promise((resolve) => {
        const tx = db.transaction(['audioFiles', 'metadata'], 'readwrite');
        tx.objectStore('audioFiles').put({ id: trackData.id, file: trackData.file });
        const { file, ...meta } = trackData;
        tx.objectStore('metadata').put(meta);
        tx.oncomplete = () => {
            if(meta.playlistId === AppState.currentPlaylistId) {
                // 既存の更新か新規追加か判定
                const existingIdx = AppState.tracks.findIndex(t => t.id === meta.id);
                if(existingIdx > -1) {
                    AppState.tracks[existingIdx] = meta;
                } else {
                    AppState.tracks.push(meta);
                }
                renderPlaylist();
            }
            resolve();
        };
    });
}

function renderPlaylist() {
    const playlistEl = document.getElementById('playlist');
    playlistEl.innerHTML = '';
    AppState.tracks.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'playlist-item';
        if (index === AppState.currentTrackIndex) li.style.backgroundColor = 'var(--hover-color)';
        li.innerHTML = `
            <i class="fa-solid fa-music text-secondary"></i>
            <div class="info">
                <div class="title">${track.title}</div>
                <div class="artist">${track.artist}</div>
            </div>
            <div class="actions">
                <button class="btn icon-btn play-track-btn" data-index="${index}"><i class="fa-solid fa-play"></i></button>
                <button class="btn icon-btn edit-track-btn" data-id="${track.id}"><i class="fa-solid fa-pen"></i></button>
                <button class="btn icon-btn danger delete-track-btn" data-id="${track.id}"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        playlistEl.appendChild(li);
    });

    document.querySelectorAll('.play-track-btn').forEach(btn => btn.onclick = (e) => playTrack(parseInt(e.currentTarget.dataset.index)));
    document.querySelectorAll('.delete-track-btn').forEach(btn => btn.onclick = (e) => deleteTrack(e.currentTarget.dataset.id));
    document.querySelectorAll('.edit-track-btn').forEach(btn => btn.onclick = (e) => openEditor(e.currentTarget.dataset.id, true));

    updateEditorTrackSelect(); // エディターのドロップダウンも更新
}

function deleteTrack(id) {
    const tx = db.transaction(['audioFiles', 'metadata'], 'readwrite');
    tx.objectStore('audioFiles').delete(id);
    tx.objectStore('metadata').delete(id);
    tx.oncomplete = () => {
        AppState.tracks = AppState.tracks.filter(t => t.id !== id);
        if (AppState.currentTrackIndex >= AppState.tracks.length) AppState.currentTrackIndex--;
        if (AppState.editingTrackId === id) {
            AppState.editingTrackId = null;
            document.getElementById('edit-target-name').textContent = 'ファイル未選択';
        }
        renderPlaylist();
    };
}

// ==========================================
// 6. プレイヤー制御 (連続再生・ボタン対応)
// ==========================================
const audioPlayer = new Audio();
const playBtn = document.getElementById('play-btn');

audioPlayer.addEventListener('timeupdate', () => {
    if (!isNaN(audioPlayer.duration)) {
        document.getElementById('seek-bar').value = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        document.getElementById('time-current').textContent = formatTime(audioPlayer.currentTime);
    }
});
audioPlayer.addEventListener('loadedmetadata', () => {
    document.getElementById('time-total').textContent = formatTime(audioPlayer.duration);
});

// 曲が終わったら自動で次の曲へ
audioPlayer.addEventListener('ended', playNextTrack);

function playTrack(index) {
    if (AppState.tracks.length === 0) return;
    if (index < 0 || index >= AppState.tracks.length) return;
    
    AppState.currentTrackIndex = index;
    const trackMeta = AppState.tracks[index];
    
    db.transaction('audioFiles', 'readonly').objectStore('audioFiles').get(trackMeta.id).onsuccess = (e) => {
        if (e.target.result) {
            audioPlayer.src = URL.createObjectURL(e.target.result.file);
            audioPlayer.currentTime = trackMeta.trimStart || 0;
            audioPlayer.volume = (trackMeta.volume || 100) / 100;
            audioPlayer.play();
            AppState.isPlaying = true;
            updatePlayerUI(trackMeta);
        }
    };
}

function playNextTrack() { 
    if(AppState.tracks.length === 0) return;
    playTrack((AppState.currentTrackIndex + 1) % AppState.tracks.length); 
}

function playPrevTrack() { 
    if(AppState.tracks.length === 0) return;
    playTrack((AppState.currentTrackIndex - 1 + AppState.tracks.length) % AppState.tracks.length); 
}

function togglePlay() {
    if (audioPlayer.src) {
        audioPlayer.paused ? audioPlayer.play() : audioPlayer.pause();
        AppState.isPlaying = !audioPlayer.paused;
        updatePlayButton();
    }
}

function updatePlayerUI(track) {
    document.getElementById('current-title').textContent = track.title;
    document.getElementById('current-artist').textContent = track.artist;
    document.getElementById('current-thumb').src = track.coverUrl;
    updatePlayButton();
    renderPlaylist(); // リストのハイライト位置を更新
}

function updatePlayButton() { 
    playBtn.innerHTML = AppState.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>'; 
}

function formatTime(sec) { 
    return `${Math.floor(sec/60)}:${Math.floor(sec%60).toString().padStart(2,'0')}`; 
}

// プレイヤーのボタンイベント割り当て
playBtn.onclick = togglePlay;
document.getElementById('next-btn').onclick = playNextTrack;
document.getElementById('prev-btn').onclick = playPrevTrack;
document.getElementById('seek-bar').oninput = (e) => audioPlayer.currentTime = (e.target.value / 100) * audioPlayer.duration;
document.getElementById('volume-bar').oninput = (e) => audioPlayer.volume = e.target.value / 100;

// ==========================================
// 7. エディター画面・プレビュー (Web Audio API)
// ==========================================
let editorAudioCtx = null;
let editorSource = null;

// エディターのドロップダウンを更新
function updateEditorTrackSelect() {
    const select = document.getElementById('edit-track-select');
    if(!select) return;
    select.innerHTML = '<option value="">-- ファイルを選択 --</option>';
    AppState.tracks.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.title;
        if(t.id === AppState.editingTrackId) opt.selected = true;
        select.appendChild(opt);
    });
}

// ドロップダウンでファイルを選択した時
document.getElementById('edit-track-select').addEventListener('change', (e) => {
    if(e.target.value) {
        openEditor(e.target.value, false); // タブは移動せず読み込みのみ
    } else {
        AppState.editingTrackId = null;
        document.getElementById('edit-target-name').textContent = 'ファイル未選択';
    }
});

function openEditor(id, switchTab = true) {
    const track = AppState.tracks.find(t => t.id === id);
    if (!track) return;
    AppState.editingTrackId = id;
    
    document.getElementById('edit-target-name').textContent = track.title;
    document.getElementById('edit-title').value = track.title;
    document.getElementById('edit-artist').value = track.artist;
    document.getElementById('edit-date').value = track.date || '';
    document.getElementById('edit-tags').value = track.tags || '';
    document.getElementById('edit-thumb-preview').src = track.coverUrl;
    document.getElementById('edit-trim-start').value = track.trimStart || 0;
    document.getElementById('edit-trim-end').value = track.trimEnd || 0;
    document.getElementById('edit-volume').value = track.volume || 100;
    document.getElementById('edit-volume-val').textContent = (track.volume || 100) + '%';
    document.getElementById('edit-key').value = track.key || 0;
    document.getElementById('edit-track-select').value = id;

    if (switchTab) {
        document.querySelectorAll('.nav-links li').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
        document.querySelector('[data-target="editor-view"]').classList.add('active');
        document.getElementById('editor-view').classList.add('active');
    }
}

document.getElementById('edit-volume').oninput = (e) => document.getElementById('edit-volume-val').textContent = e.target.value + '%';

// サムネイル変更
document.getElementById('btn-change-thumb').onclick = () => document.getElementById('edit-thumb-input').click();
document.getElementById('edit-thumb-input').onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => document.getElementById('edit-thumb-preview').src = ev.target.result;
        reader.readAsDataURL(file);
    }
};

// プレビュー再生
document.getElementById('btn-preview').onclick = async () => {
    if (!AppState.editingTrackId) return alert('ファイルを選択してください');
    if (editorAudioCtx) editorAudioCtx.close();
    
    editorAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    db.transaction('audioFiles', 'readonly').objectStore('audioFiles').get(AppState.editingTrackId).onsuccess = async (e) => {
        const file = e.target.result.file;
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await editorAudioCtx.decodeAudioData(arrayBuffer);
        
        editorSource = editorAudioCtx.createBufferSource();
        editorSource.buffer = audioBuffer;
        
        // 音量
        const gainNode = editorAudioCtx.createGain();
        gainNode.gain.value = document.getElementById('edit-volume').value / 100;
        
        // キー変更 (playbackRateで簡易的に実装)
        const keyShift = parseFloat(document.getElementById('edit-key').value);
        editorSource.playbackRate.value = Math.pow(2, keyShift / 12);
        
        editorSource.connect(gainNode);
        gainNode.connect(editorAudioCtx.destination);
        
        const startTime = parseFloat(document.getElementById('edit-trim-start').value) || 0;
        const endTime = parseFloat(document.getElementById('edit-trim-end').value) || audioBuffer.duration;
        const duration = endTime - startTime;
        
        editorSource.start(0, startTime, duration > 0 ? duration : undefined);
    };
};

document.getElementById('btn-stop-preview').onclick = () => {
    if (editorSource) { editorSource.stop(); editorSource = null; }
};

// 保存と変換
document.getElementById('btn-save-overwrite').onclick = () => saveEditedTrack(true);
document.getElementById('btn-save-new').onclick = () => saveEditedTrack(false);

async function saveEditedTrack(overwrite) {
    if (!AppState.editingTrackId) return;
    const track = AppState.tracks.find(t => t.id === AppState.editingTrackId);
    
    const newMeta = {
        ...track,
        title: document.getElementById('edit-title').value,
        artist: document.getElementById('edit-artist').value,
        date: document.getElementById('edit-date').value,
        tags: document.getElementById('edit-tags').value,
        coverUrl: document.getElementById('edit-thumb-preview').src,
        trimStart: parseFloat(document.getElementById('edit-trim-start').value) || 0,
        trimEnd: parseFloat(document.getElementById('edit-trim-end').value) || 0,
        volume: parseInt(document.getElementById('edit-volume').value),
        key: parseFloat(document.getElementById('edit-key').value)
    };

    if (!overwrite) {
        newMeta.id = crypto.randomUUID();
        newMeta.title += ' (Copy)';
        db.transaction('audioFiles', 'readonly').objectStore('audioFiles').get(track.id).onsuccess = (e) => {
            const newFile = new File([e.target.result.file], newMeta.title, {type: e.target.result.file.type});
            saveTrack({ ...newMeta, file: newFile }).then(() => {
                alert('別名で保存しました');
                openEditor(newMeta.id, false);
            });
        };
    } else {
        saveTrack(newMeta).then(() => alert('上書き保存しました'));
    }
}

// ==========================================
// 8. UI イベント初期化・並べ替え
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initIndexedDB();
    
    // タブ切り替え
    document.querySelectorAll('.nav-links li').forEach(link => {
        link.onclick = () => {
            document.querySelectorAll('.nav-links li').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
            link.classList.add('active');
            document.getElementById(link.dataset.target).classList.add('active');
        };
    });

    // D&D
    const dropZone = document.getElementById('drop-zone');
    const overlay = document.getElementById('drop-overlay');
    dropZone.ondragover = (e) => { e.preventDefault(); overlay.classList.add('drag-over'); };
    dropZone.ondragleave = (e) => { e.preventDefault(); overlay.classList.remove('drag-over'); };
    dropZone.ondrop = (e) => {
        e.preventDefault(); overlay.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) processAndAddFiles(e.dataTransfer.files);
    };
    
    document.getElementById('add-file-btn').onclick = () => document.getElementById('file-input').click();
    document.getElementById('file-input').onchange = (e) => processAndAddFiles(e.target.files);
});

document.getElementById('sort-select').onchange = (e) => {
    const [key, order] = e.target.value.split('_');
    AppState.tracks.sort((a, b) => {
        let valA = a[key === 'name' ? 'title' : key]; let valB = b[key === 'name' ? 'title' : key];
        if (valA < valB) return order === 'asc' ? -1 : 1;
        if (valA > valB) return order === 'asc' ? 1 : -1; return 0;
    });
    renderPlaylist();
};

document.getElementById('shuffle-btn').onclick = () => {
    for (let i = AppState.tracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [AppState.tracks[i], AppState.tracks[j]] = [AppState.tracks[j], AppState.tracks[i]];
    }
    renderPlaylist();
};
