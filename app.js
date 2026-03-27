/**
 * app.js - Web Music Player
 * 第5弾: 音楽プレイヤー機能とプレイリスト表示の実装
 */

const DB_NAME = 'MusicPlayerDB';
const DB_VERSION = 3; 
let db = null;

// 音声再生用のAudioオブジェクトを作成
const audioPlayer = new Audio();

const appState = {
    tracks: [],
    playlists: [],
    currentTrack: null,
    isPlaying: false,
    editingTrackId: null,
    editingTags: [],
    // プレイヤー用ステート
    currentQueue: [], // 現在再生中のリスト
    currentIndex: -1  // 現在再生中の曲のインデックス
};

document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initDragAndDrop();
    initEditPage();
    initPlayer(); // ★プレイヤーの初期化を追加
    
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
            fileBlob: file, // ここに音声データ本体が入っています
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
    const sortedTracks = [...appState.tracks].sort((a, b) => b.addedAt - a.addedAt);
    
    renderLibraryList(sortedTracks);     // 左サイドバー
    renderEditLibraryList(sortedTracks); // 編集用リスト
    renderCurrentPlaylistItems(sortedTracks); // 中央のメインリスト
}

// ----------------------------------------------------
// ★ NEW: 中央のメインリスト描画（ここから再生可能）
// ----------------------------------------------------
function renderCurrentPlaylistItems(tracks) {
    const list = document.getElementById('current-playlist-items');
    list.innerHTML = '';

    tracks.forEach((track, index) => {
        const li = document.createElement('li');
        li.style.padding = '12px 16px';
        li.style.borderBottom = '1px solid var(--border-color)';
        li.style.cursor = 'pointer';
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.gap = '16px';
        li.style.transition = 'background-color 0.2s';
        
        // マウスホバーで背景色を変える
        li.onmouseenter = () => li.style.backgroundColor = 'var(--bg-hover)';
        li.onmouseleave = () => li.style.backgroundColor = 'transparent';

        // タグを文字列に変換（色情報は無視してテキストだけ表示）
        const tagsText = (track.tags || []).map(t => typeof t === 'object' ? t.text : t).join(', ');

        li.innerHTML = `
            <div style="width: 24px; text-align: right; color: var(--text-secondary); font-size: 14px;">${index + 1}</div>
            <div style="flex: 1; overflow: hidden;">
                <div style="font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${track.title}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${track.artist}</div>
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right;">
                ${tagsText}
            </div>
        `;

        // 曲をクリックしたら再生
        li.addEventListener('click', () => {
            playTrack(track, tracks);
        });
        list.appendChild(li);
    });
}

// ----------------------------------------------------
// ★ NEW: プレイヤーの制御ロジック
// ----------------------------------------------------
function initPlayer() {
    const playBtn = document.getElementById('ctrl-play');
    const prevBtn = document.getElementById('ctrl-prev');
    const nextBtn = document.getElementById('ctrl-next');
    const seekBar = document.getElementById('seek-bar');
    const volumeBar = document.getElementById('volume-bar');
    const timeCurrent = document.getElementById('time-current');
    const timeTotal = document.getElementById('time-total');

    // 再生・一時停止ボタン
    playBtn.addEventListener('click', () => {
        if (!appState.currentTrack) return; // 曲が選ばれてなければ何もしない
        if (audioPlayer.paused) {
            audioPlayer.play();
        } else {
            audioPlayer.pause();
        }
    });

    // オーディオの状態に合わせてアイコンを変更
    audioPlayer.addEventListener('play', () => {
        playBtn.innerHTML = '<span class="material-symbols-outlined">pause</span>';
        appState.isPlaying = true;
    });

    audioPlayer.addEventListener('pause', () => {
        playBtn.innerHTML = '<span class="material-symbols-outlined">play_arrow</span>';
        appState.isPlaying = false;
    });

    // 再生位置の更新（シークバーと時間表示）
    audioPlayer.addEventListener('timeupdate', () => {
        if (audioPlayer.duration) {
            const progressPercent = (audioPlayer.currentTime / audioPlayer.duration) * 100;
            seekBar.value = progressPercent;
            timeCurrent.textContent = formatTime(audioPlayer.currentTime);
            timeTotal.textContent = formatTime(audioPlayer.duration);
        }
    });

    // 曲が終わったら次の曲へ
    audioPlayer.addEventListener('ended', () => {
        playNext();
    });

    // シークバーを動かした時
    seekBar.addEventListener('input', (e) => {
        if (audioPlayer.duration) {
            const seekTime = (e.target.value / 100) * audioPlayer.duration;
            audioPlayer.currentTime = seekTime;
        }
    });

    // 音量バーを動かした時
    volumeBar.addEventListener('input', (e) => {
        audioPlayer.volume = e.target.value / 100;
    });

    prevBtn.addEventListener('click', playPrev);
    nextBtn.addEventListener('click', playNext);
}

// 秒数を「分:秒」にフォーマット
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// 曲を再生する関数
async function playTrack(track, queue) {
    appState.currentTrack = track;
    appState.currentQueue = queue;
    appState.currentIndex = queue.findIndex(t => t.id === track.id);

    // 画面下部のプレイヤーの表示を更新
    document.getElementById('player-title').textContent = track.title;
    document.getElementById('player-artist').textContent = track.artist;
    
    const thumb = document.getElementById('player-thumbnail');
    if (track.thumbnailDataUrl) {
        thumb.style.backgroundImage = `url(${track.thumbnailDataUrl})`;
        thumb.innerHTML = '';
    } else {
        thumb.style.backgroundImage = 'none';
        thumb.innerHTML = '<span class="material-symbols-outlined">music_note</span>';
    }

    // Blob（ファイルデータ）から再生用のURLを作成してAudioにセット
    const fileURL = URL.createObjectURL(track.fileBlob);
    audioPlayer.src = fileURL;
    
    try {
        await audioPlayer.play();
    } catch (e) {
        console.error("再生に失敗しました:", e);
    }
}

// 次の曲へ
function playNext() {
    if (appState.currentQueue.length === 0) return;
    appState.currentIndex++;
    // リストの最後までいったら最初に戻る
    if (appState.currentIndex >= appState.currentQueue.length) {
        appState.currentIndex = 0; 
    }
    playTrack(appState.currentQueue[appState.currentIndex], appState.currentQueue);
}

// 前の曲へ
function playPrev() {
    if (appState.currentQueue.length === 0) return;
    appState.currentIndex--;
    // リストの最初から戻ろうとしたら最後に飛ぶ
    if (appState.currentIndex < 0) {
        appState.currentIndex = appState.currentQueue.length - 1;
    }
    playTrack(appState.currentQueue[appState.currentIndex], appState.currentQueue);
}


// ----------------------------------------------------
// 既存の描画ロジック（サイドバー、編集画面）
// ----------------------------------------------------
function renderLibraryList(tracks) {
    const libraryList = document.getElementById('my-library-list');
    libraryList.innerHTML = '';

    tracks.forEach(track => {
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
        // サイドバーからクリックした場合も再生
        li.addEventListener('click', () => playTrack(track, tracks));
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
        
        // もし現在再生中の曲を編集した場合は、プレイヤーの表示も更新
        if (appState.currentTrack && appState.currentTrack.id === track.id) {
            document.getElementById('player-title').textContent = track.title;
            document.getElementById('player-artist').textContent = track.artist;
        }

        alert('情報を保存しました！');
    });
}

function renderEditTags() {
    const list = document.getElementById('edit-tags-list');
    list.innerHTML = '';
    
    appState.editingTags.forEach((tagObj, index) => {
        const span = document.createElement('span');
        span.className = 'tag-item';
        
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

    document.querySelectorAll('.tag-color-picker').forEach(picker => {
        picker.addEventListener('input', (e) => {
            const index = e.target.getAttribute('data-index');
            appState.editingTags[index].color = e.target.value; 
        });
    });
}
