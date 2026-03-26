// ===== CONSTANTS =====
const DB_NAME = 'MusicPlayerDB';
const DB_VERSION = 2;
const STORE_TRACKS = 'tracks';
const STORE_SETTINGS = 'settings';
const STORE_LOGS = 'logs';
const DRIVE_FOLDER_NAME = 'MusicPlayer_ポータル';
const DRIVE_SETTINGS_FILE = 'music_player_settings.json';

// ===== APP STATE =====
const AppState = {
  db: null,
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  shuffle: false,
  repeat: 'none', // none | one | all
  sortMode: 'added-desc',
  googleUser: null,
  driveAccessToken: null,
  driveFolderId: null,
  currentPage: 'player',
  editingTrack: null,
  audioContext: null,
  analyser: null,
  logInterval: null,

  get currentTrack() {
    return this.playlist[this.currentIndex] ?? null;
  }
};

// ===== INDEXED DB =====
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        const ts = db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
        ts.createIndex('title', 'title');
        ts.createIndex('artist', 'artist');
        ts.createIndex('addedAt', 'addedAt');
        ts.createIndex('duration', 'duration');
        ts.createIndex('year', 'year');
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_LOGS)) {
        const ls = db.createObjectStore(STORE_LOGS, { keyPath: 'id', autoIncrement: true });
        ls.createIndex('trackId', 'trackId');
        ls.createIndex('timestamp', 'timestamp');
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx = AppState.db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = AppState.db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(store, value) {
  return new Promise((resolve, reject) => {
    const tx = AppState.db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const tx = AppState.db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbClear(store) {
  return new Promise((resolve, reject) => {
    const tx = AppState.db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ===== UTILITIES =====
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDuration(seconds) {
  if (!seconds) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  return `${m}:${s.toString().padStart(2,'0')}`;
}

function formatPlaytime(seconds) {
  if (!seconds || seconds < 60) return `${Math.floor(seconds || 0)}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}時間`;
  if (seconds < 604800) return `${(seconds / 86400).toFixed(1)}日`;
  return `${(seconds / 604800).toFixed(1)}週`;
}

function notify(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `notification ${type}`;
  const icon = type === 'success' ? icons.check : type === 'error' ? icons.x : icons.info;
  el.innerHTML = `${icon}<span>${msg}</span>`;
  document.getElementById('notifications').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function sanitizeFilename(name) {
  return name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
}

// File to ArrayBuffer
function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// File to DataURL
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Read ID3 tags (basic)
async function readAudioMetadata(file) {
  const meta = {
    title: sanitizeFilename(file.name),
    artist: '',
    album: '',
    year: '',
    artwork: null
  };
  try {
    if (typeof jsmediatags !== 'undefined') {
      await new Promise(resolve => {
        jsmediatags.read(file, {
          onSuccess: tag => {
            const t = tag.tags;
            if (t.title) meta.title = t.title;
            if (t.artist) meta.artist = t.artist;
            if (t.album) meta.album = t.album;
            if (t.year) meta.year = t.year;
            if (t.picture) {
              const { data, format } = t.picture;
              const bytes = new Uint8Array(data);
              let binary = '';
              bytes.forEach(b => binary += String.fromCharCode(b));
              meta.artwork = `data:${format};base64,${btoa(binary)}`;
            }
            resolve();
          },
          onError: () => resolve()
        });
      });
    }
  } catch(e) {}
  return meta;
}

// Get audio duration
function getAudioDuration(file) {
  return new Promise(resolve => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.onloadedmetadata = () => {
      resolve(audio.duration);
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => resolve(0);
    audio.src = url;
  });
}

// Sort playlist
function sortPlaylist(tracks, mode) {
  const arr = [...tracks];
  switch (mode) {
    case 'name-asc': arr.sort((a,b) => a.title.localeCompare(b.title, 'ja')); break;
    case 'name-desc': arr.sort((a,b) => b.title.localeCompare(a.title, 'ja')); break;
    case 'added-asc': arr.sort((a,b) => a.addedAt - b.addedAt); break;
    case 'added-desc': arr.sort((a,b) => b.addedAt - a.addedAt); break;
    case 'duration-asc': arr.sort((a,b) => (a.duration||0) - (b.duration||0)); break;
    case 'duration-desc': arr.sort((a,b) => (b.duration||0) - (a.duration||0)); break;
    case 'year-asc': arr.sort((a,b) => (a.year||'9999').localeCompare(b.year||'9999')); break;
    case 'year-desc': arr.sort((a,b) => (b.year||'0000').localeCompare(a.year||'0000')); break;
    case 'random': arr.sort(() => Math.random() - 0.5); break;
  }
  return arr;
}

// Draw waveform on canvas
function drawWaveform(canvas, audioBuffer, color = '#7c6af7') {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / w);
  ctx.fillStyle = color;
  for (let i = 0; i < w; i++) {
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step; j++) {
      const v = data[i * step + j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const yMin = ((1 + min) / 2) * h;
    const yMax = ((1 + max) / 2) * h;
    ctx.fillRect(i, yMax, 1, Math.max(1, yMin - yMax));
  }
}

// Export: save settings to IndexedDB
async function saveSettings() {
  const settings = {
    key: 'app',
    sortMode: AppState.sortMode,
    shuffle: AppState.shuffle,
    repeat: AppState.repeat,
    volume: document.getElementById('volume-slider')?.value ?? 80
  };
  await dbPut(STORE_SETTINGS, settings);
}

async function loadSettings() {
  const s = await dbGet(STORE_SETTINGS, 'app');
  if (!s) return;
  AppState.sortMode = s.sortMode || 'added-desc';
  AppState.shuffle = s.shuffle || false;
  AppState.repeat = s.repeat || 'none';
  if (s.volume && document.getElementById('volume-slider')) {
    document.getElementById('volume-slider').value = s.volume;
  }
}

// Log play event
async function logPlay(trackId, seconds) {
  if (!trackId || seconds < 3) return;
  await dbPut(STORE_LOGS, {
    trackId,
    timestamp: Date.now(),
    seconds
  });
}
