/**
 * files.js — ファイル処理 (ローカル & Google Drive)
 */
const Files = (() => {
  let _queue    = [];
  let _qIdx     = 0;
  let _driveDoc = null; // 処理中の Drive ドキュメント

  /* ══ ローカルファイル ══ */
  const handleInput = (files) => {
    const valid = [...files].filter(f => _isAudio(f.name));
    if (!valid.length) { App.ui.toast('対応する音声ファイルを選択してください','warning'); return; }
    _queue = valid; _qIdx = 0; _driveDoc = null;
    _next();
  };

  const _next = async () => {
    if (_qIdx >= _queue.length) {
      _queue = []; _qIdx = 0;
      App.playlists.render();
      App.editor.refreshSelect();
      return;
    }
    const file = _queue[_qIdx];
    const meta = await _readMeta(file);
    App.modal.openAddFile(file, meta, false);
  };

  /* ── ID3 メタデータ ── */
  const _readMeta = (file) => new Promise(res => {
    const base = {
      title: file.name.replace(/\.[^.]+$/,''), artist:'', album:'',
      date:'', genre:'', tags:[], thumbnailBase64:null
    };
    if (!window.jsmediatags) { res(base); return; }
    jsmediatags.read(file, {
      onSuccess: (tag) => {
        const t = tag.tags;
        base.title  = t.title  || base.title;
        base.artist = t.artist || '';
        base.album  = t.album  || '';
        base.genre  = t.genre  || '';
        // year → date (YYYY-MM-DD)
        if (t.year) {
          const y = String(t.year).trim();
          base.date = /^\d{4}$/.test(y) ? `${y}-01-01` : (/^\d{4}-\d{2}-\d{2}$/.test(y) ? y : '');
        }
        // カバーアート
        if (t.picture) {
          try {
            const blob = new Blob([new Uint8Array(t.picture.data)], { type: t.picture.format });
            const r = new FileReader();
            r.onloadend = () => { base.thumbnailBase64 = r.result; res(base); };
            r.readAsDataURL(blob);
            return;
          } catch {}
        }
        res(base);
      },
      onError: () => res(base)
    });
  });

  /* ── 追加確定 (ローカル) ── */
  const confirmAdd = async (info, file) => {
    App.ui.showProcessing('ファイルを追加中...');
    try {
      const id = Storage.genId();
      const track = _mkTrack(id, info, {
        source:'local', mimeType:file.type, size:file.size, fileName:file.name
      });
      Storage.addTrack(track);
      await Storage.saveBlob(id, file);
      App.playlists.addToLibrary(id);
      App.ui.toast(`「${track.title}」を追加しました`, 'success');
    } catch(e) { App.ui.toast('追加失敗: '+e.message,'error'); }
    finally { App.ui.hideProcessing(); }
    _qIdx++;
    _next();
  };

  const skipAdd = () => { _qIdx++; _next(); };

  /* ══ Google Drive ══ */
  const addFromDrive = (doc) => {
    _driveDoc = doc;
    const meta = {
      title: doc.name.replace(/\.[^.]+$/,''), artist:'', album:'',
      date:'', genre:'', tags:[], thumbnailBase64:null
    };
    App.modal.openAddFile({ name:doc.name, size:doc.sizeBytes||0 }, meta, true);
  };

  const confirmAddDrive = async (info) => {
    if (!_driveDoc) return;
    App.ui.showProcessing('Google Drive から追加中...');
    try {
      const id = Storage.genId();
      const track = _mkTrack(id, info, {
        source:'gdrive', driveFileId:_driveDoc.id, mimeType:_driveDoc.mimeType, fileName:_driveDoc.name
      });
      Storage.addTrack(track);
      App.playlists.addToLibrary(id);
      App.ui.toast(`「${track.title}」を追加しました`, 'success');
    } catch(e) { App.ui.toast('追加失敗: '+e.message,'error'); }
    finally { App.ui.hideProcessing(); _driveDoc=null; }
    App.playlists.render();
    App.editor.refreshSelect();
  };

  const getDriveDoc = () => _driveDoc;

  /* ══ ドラッグ&ドロップゾーン初期化 ══ */
  const initDrop = () => {
    const main = document.getElementById('mainContent');
    const zone = document.getElementById('dropZone');
    main.addEventListener('dragover', e => {
      if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); zone?.classList.add('visible','dragover'); }
    });
    main.addEventListener('dragleave', e => { if (!main.contains(e.relatedTarget)) zone?.classList.remove('dragover'); });
    main.addEventListener('drop', e => {
      e.preventDefault(); zone?.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleInput(e.dataTransfer.files);
    });
    zone?.addEventListener('click', () => document.getElementById('fileInput')?.click());
  };

  const _mkTrack = (id, info, extra) => ({
    id,
    title:    info.title  || extra.fileName?.replace(/\.[^.]+$/,'') || '不明',
    artist:   info.artist || '',
    album:    info.album  || '',
    date:     info.date   || '',
    genre:    info.genre  || '',
    tags:     info.tags   || [],
    thumbnailBase64: info.thumbnailBase64 || null,
    addedAt:  Date.now(),
    duration: null,
    ...extra
  });

  const _isAudio = (name) => CONFIG.SUPPORTED_AUDIO.includes(name.split('.').pop().toLowerCase());

  return { handleInput, confirmAdd, skipAdd, addFromDrive, confirmAddDrive, getDriveDoc, initDrop };
})();
