/**
 * storage.js — ローカル + Google Drive 永続化
 *
 * Track オブジェクト構造:
 * { id, title, artist, album, date(YYYY-MM-DD), genre,
 *   tags:[{name,color}], thumbnailBase64, source('local'|'gdrive'),
 *   driveFileId?, mimeType, size, duration, addedAt, fileName }
 */
const Storage = (() => {
  const mk = () => ({
    version: CONFIG.APP_VERSION,
    // マイライブラリ = 全トラックの順序リスト
    libraryOrder: [],
    // カスタムプレイリスト
    playlists: [],
    tracks: {},       // id -> Track
    audioBlobs: {},   // id -> base64 dataURL  (ローカルのみ)
    logs: [],
    settings: {
      volume: 80, shuffle: false, repeat: 'none',
      activePlaylistId: 'library', activeTrackId: null
    },
    lastUpdated: Date.now()
  });

  let _d = null;
  let _driveMode = false;
  let _driveFileId = null;
  let _syncTimer = null;

  /* ── ローカル ── */
  const _read = () => {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        const base = mk();
        return {
          ...base, ...p,
          settings:   { ...base.settings,   ...(p.settings   || {}) },
          libraryOrder: p.libraryOrder || Object.keys(p.tracks || {}),
          playlists:  p.playlists  || [],
          tracks:     p.tracks     || {},
          audioBlobs: p.audioBlobs || {},
          logs:       p.logs       || []
        };
      }
    } catch(e) { console.warn('storage read', e); }
    return mk();
  };

  const _write = () => {
    if (!_d) return;
    try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(_d)); }
    catch(e) {
      if (e.name === 'QuotaExceededError') {
        const slim = { ..._d, audioBlobs: {} };
        try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(slim)); } catch {}
      }
    }
  };

  /* ── Drive 同期 ── */
  const _scheduleSync = () => {
    if (!_driveMode) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
      try {
        const payload = { ..._d, audioBlobs: {} };
        await App.gdrive.saveConfigFile(JSON.stringify(payload, null, 2), _driveFileId);
      } catch(e) { console.warn('drive sync', e); }
    }, 2500);
  };

  /* ── 初期化 ── */
  const init = async (driveMode = false) => {
    _driveMode = driveMode;
    if (driveMode) {
      try {
        const res = await App.gdrive.loadConfigFile();
        if (res) {
          _driveFileId = res.fileId;
          const p = JSON.parse(res.content);
          const base = mk();
          _d = {
            ...base, ...p,
            settings:    { ...base.settings,    ...(p.settings    || {}) },
            libraryOrder: p.libraryOrder || Object.keys(p.tracks || {}),
            playlists:   p.playlists  || [],
            tracks:      p.tracks     || {},
            logs:        p.logs       || []
          };
          // ローカルの audioBlobs を補完
          const loc = _read();
          _d.audioBlobs = { ...(loc.audioBlobs || {}), ...(_d.audioBlobs || {}) };
        } else { _d = _read(); }
      } catch(e) { console.warn('drive load', e); _d = _read(); }
    } else {
      _d = _read();
    }
    return _d;
  };

  /* ── アクセサ ── */
  const get  = (k)       => { if (!_d) _d = _read(); return k ? _d[k] : _d; };
  const set  = (k, v)    => { if (!_d) _d = _read(); _d[k] = v; _d.lastUpdated = Date.now(); _write(); _scheduleSync(); };
  const save = ()        => { if (!_d) return; _d.lastUpdated = Date.now(); _write(); _scheduleSync(); };

  /* ── トラック CRUD ── */
  const addTrack = (track) => {
    if (!_d) _d = _read();
    _d.tracks[track.id] = track;
    if (!_d.libraryOrder.includes(track.id)) _d.libraryOrder.push(track.id);
    _write(); _scheduleSync();
  };
  const updateTrack = (id, upd) => {
    if (!_d) _d = _read();
    if (_d.tracks[id]) { _d.tracks[id] = { ..._d.tracks[id], ...upd }; _write(); _scheduleSync(); }
  };
  const removeTrack = (id) => {
    if (!_d) _d = _read();
    delete _d.tracks[id]; delete _d.audioBlobs[id];
    _d.libraryOrder = (_d.libraryOrder || []).filter(x => x !== id);
    _d.playlists.forEach(pl => { pl.trackIds = pl.trackIds.filter(x => x !== id); });
    if (_d.settings.activeTrackId === id) _d.settings.activeTrackId = null;
    _write(); _scheduleSync();
  };

  /* ── Blob ── */
  const saveBlob = async (id, blob) => {
    if (!_d) _d = _read();
    try { _d.audioBlobs[id] = await _toB64(blob); _write(); }
    catch(e) { console.warn('saveBlob', e); }
  };
  const getBlob = (id) => {
    if (!_d) _d = _read();
    const b = _d.audioBlobs[id];
    return b ? _fromB64(b) : null;
  };
  const clearBlob = (id) => {
    if (!_d) return;
    delete _d.audioBlobs[id]; _write();
  };

  /* ── ログ ── */
  const addLog = (log) => {
    if (!_d) _d = _read();
    _d.logs.push(log);
    if (_d.logs.length > 5000) _d.logs = _d.logs.slice(-5000);
    _write(); _scheduleSync();
  };

  /* ── ユーティリティ ── */
  const setDriveMode = (on, fid) => { _driveMode = on; _driveFileId = fid || null; };
  const reset = () => { _d = mk(); localStorage.removeItem(CONFIG.STORAGE_KEY); };
  const genId = () => `t_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

  const _toB64   = blob  => new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  const _fromB64 = data  => { try { const [h,d]=data.split(','); const m=h.match(/:(.*?);/)[1]; const b=atob(d); const a=new Uint8Array(b.length); for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i); return new Blob([a],{type:m}); } catch{ return null; } };

  return { init, get, set, save, addTrack, updateTrack, removeTrack, saveBlob, getBlob, clearBlob, addLog, reset, setDriveMode, genId };
})();
