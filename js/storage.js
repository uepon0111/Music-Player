/**
 * storage.js - データ永続化モジュール
 * Googleログイン時: Google Driveに同期
 * 未ログイン時: LocalStorageを使用
 */

const Storage = (() => {
  // デフォルトデータ構造
  const defaultData = () => ({
    version: CONFIG.APP_VERSION,
    playlists: [
      { id: 'default', name: CONFIG.DEFAULT_PLAYLIST, trackIds: [], createdAt: Date.now() }
    ],
    tracks: {},         // trackId -> TrackInfo
    audioBlobs: {},     // trackId -> base64 (ローカルのみ)
    logs: [],           // 再生ログ
    settings: {
      volume: 80,
      shuffle: false,
      repeat: 'none',   // 'none' | 'all' | 'one'
      activePlaylistId: 'default',
      activeTrackId: null
    },
    lastUpdated: Date.now()
  });

  let _data = null;
  let _isDriveUser = false;
  let _driveSyncTimeout = null;
  let _driveConfigFileId = null;

  // ============================================================
  // TrackInfo 型定義（コメント用）
  // {
  //   id, title, artist, album, year, genre, tags:[],
  //   duration, addedAt, thumbnailBase64,
  //   source: 'local' | 'gdrive',
  //   driveFileId (if source=gdrive),
  //   mimeType, size
  // }
  // ============================================================

  const _loadLocal = () => {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // マージ: 不足フィールドをデフォルトで補完
        return Object.assign(defaultData(), parsed);
      }
    } catch(e) { console.warn('Storage load error', e); }
    return defaultData();
  };

  const _saveLocal = (data) => {
    try {
      // BlobデータはLocalStorage用に別管理（大容量対策）
      const toSave = { ...data };
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(toSave));
    } catch(e) {
      console.error('Storage save error', e);
      // クォータ超過の場合はblobsを削除して再試行
      if (e.name === 'QuotaExceededError') {
        const slim = { ...data, audioBlobs: {} };
        try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(slim)); } catch(e2){}
      }
    }
  };

  const _scheduleDriveSync = () => {
    if (!_isDriveUser) return;
    if (_driveSyncTimeout) clearTimeout(_driveSyncTimeout);
    _driveSyncTimeout = setTimeout(() => _syncToDrive(), 2000);
  };

  const _syncToDrive = async () => {
    if (!_isDriveUser || !App.gdrive) return;
    try {
      // audioBlobs は Drive には保存しない（ファイル自体がDriveにある）
      const toSync = { ..._data, audioBlobs: {} };
      const json = JSON.stringify(toSync, null, 2);
      await App.gdrive.saveConfigFile(json, _driveConfigFileId);
    } catch(e) { console.warn('Drive sync error', e); }
  };

  const init = async (isDriveUser = false) => {
    _isDriveUser = isDriveUser;
    if (isDriveUser) {
      // Drive からロード
      try {
        const result = await App.gdrive.loadConfigFile();
        if (result) {
          _driveConfigFileId = result.fileId;
          const parsed = JSON.parse(result.content);
          _data = Object.assign(defaultData(), parsed);
          // audioBlobs はローカルから
          const local = _loadLocal();
          _data.audioBlobs = local.audioBlobs || {};
        } else {
          _data = _loadLocal();
        }
      } catch(e) {
        console.warn('Drive load failed, using local', e);
        _data = _loadLocal();
      }
    } else {
      _data = _loadLocal();
    }
    return _data;
  };

  const get = (key) => {
    if (!_data) _data = _loadLocal();
    return key ? _data[key] : _data;
  };

  const set = (key, value) => {
    if (!_data) _data = _loadLocal();
    _data[key] = value;
    _data.lastUpdated = Date.now();
    _saveLocal(_data);
    _scheduleDriveSync();
  };

  const save = () => {
    if (!_data) return;
    _data.lastUpdated = Date.now();
    _saveLocal(_data);
    _scheduleDriveSync();
  };

  // トラック追加
  const addTrack = (track) => {
    if (!_data) _data = _loadLocal();
    _data.tracks[track.id] = track;
    _saveLocal(_data);
    _scheduleDriveSync();
  };

  // トラック更新
  const updateTrack = (id, updates) => {
    if (!_data) _data = _loadLocal();
    if (_data.tracks[id]) {
      _data.tracks[id] = { ..._data.tracks[id], ...updates };
      _saveLocal(_data);
      _scheduleDriveSync();
    }
  };

  // トラック削除
  const removeTrack = (id) => {
    if (!_data) _data = _loadLocal();
    delete _data.tracks[id];
    delete _data.audioBlobs[id];
    // 全プレイリストから削除
    _data.playlists.forEach(pl => {
      pl.trackIds = pl.trackIds.filter(tid => tid !== id);
    });
    if (_data.settings.activeTrackId === id) {
      _data.settings.activeTrackId = null;
    }
    _saveLocal(_data);
    _scheduleDriveSync();
  };

  // Blobデータ保存（IndexedDB推奨だが簡易でbase64）
  const saveAudioBlob = async (id, blob) => {
    if (!_data) _data = _loadLocal();
    try {
      const b64 = await _blobToBase64(blob);
      _data.audioBlobs[id] = b64;
      _saveLocal(_data);
    } catch(e) { console.warn('Blob save error', e); }
  };

  const getAudioBlob = (id) => {
    if (!_data) _data = _loadLocal();
    const b64 = _data.audioBlobs[id];
    if (!b64) return null;
    try {
      return _base64ToBlob(b64);
    } catch(e) { return null; }
  };

  // 再生ログ追加
  const addLog = (log) => {
    if (!_data) _data = _loadLocal();
    _data.logs.push(log);
    // ログは1000件上限
    if (_data.logs.length > 5000) _data.logs = _data.logs.slice(-5000);
    _saveLocal(_data);
    _scheduleDriveSync();
  };

  // ローカルキャッシュクリア（音声ファイル削除時）
  const clearAudioCache = (id) => {
    if (!_data) return;
    delete _data.audioBlobs[id];
    _saveLocal(_data);
  };

  // 全データリセット
  const reset = () => {
    _data = defaultData();
    localStorage.removeItem(CONFIG.STORAGE_KEY);
  };

  // ドライブモード切替
  const setDriveMode = (enabled, fileId) => {
    _isDriveUser = enabled;
    _driveConfigFileId = fileId || null;
  };

  // ============================================================
  // Helpers
  // ============================================================
  const _blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const _base64ToBlob = (dataUrl) => {
    const [header, data] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };

  const generateId = () => `t_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;

  return {
    init, get, set, save, addTrack, updateTrack, removeTrack,
    saveAudioBlob, getAudioBlob, addLog, clearAudioCache,
    reset, setDriveMode, generateId,
    getData: () => _data
  };
})();
