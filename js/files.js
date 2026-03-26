/**
 * files.js - ファイル管理モジュール
 */

const Files = (() => {
  let _pendingFiles = [];
  let _pendingIndex = 0;
  let _pendingThumbnailData = null;
  let _pendingTags = [];

  // ============================================================
  // ローカルファイル処理
  // ============================================================
  const handleInput = (files) => {
    const valid = Array.from(files).filter(f => _isAudio(f.name));
    if (!valid.length) { UI.toast('対応している音声ファイルを選択してください', 'warning'); return; }
    _processFiles(valid);
  };

  const _processFiles = async (files) => {
    _pendingFiles = files;
    _pendingIndex = 0;
    _showNextAddModal();
  };

  const _showNextAddModal = async () => {
    if (_pendingIndex >= _pendingFiles.length) {
      _pendingFiles = [];
      _pendingIndex = 0;
      App.playlists.render();
      App.editor.refreshSelect();
      return;
    }
    const file = _pendingFiles[_pendingIndex];
    // メタデータ読み取り試行
    const meta = await _readMetadata(file);
    App.modal.openAddFile(file, meta);
  };

  const _readMetadata = async (file) => {
    return new Promise((resolve) => {
      const result = {
        title: file.name.replace(/\.[^.]+$/, ''),
        artist: '', album: '', year: '', genre: '', tags: []
      };
      // jsmediatags がある場合は使用（CDNから読み込み）
      if (window.jsmediatags) {
        jsmediatags.read(file, {
          onSuccess: (tag) => {
            const t = tag.tags;
            result.title = t.title || result.title;
            result.artist = t.artist || '';
            result.album = t.album || '';
            result.year = t.year || '';
            result.genre = t.genre || '';
            resolve(result);
          },
          onError: () => resolve(result)
        });
      } else {
        resolve(result);
      }
    });
  };

  // ============================================================
  // モーダル確認後の追加
  // ============================================================
  const confirmAdd = async (trackInfo, blob, playlistId) => {
    UI.showProcessing('ファイルを追加中...');
    try {
      const id = Storage.generateId();
      const track = {
        id,
        title: trackInfo.title || 'Unknown',
        artist: trackInfo.artist || '',
        album: trackInfo.album || '',
        year: parseInt(trackInfo.year) || null,
        genre: trackInfo.genre || '',
        tags: trackInfo.tags || [],
        thumbnailBase64: trackInfo.thumbnailBase64 || null,
        source: 'local',
        mimeType: blob.type,
        size: blob.size,
        addedAt: Date.now(),
        duration: null,
        fileName: blob.name || trackInfo.title
      };
      Storage.addTrack(track);
      await Storage.saveAudioBlob(id, blob);
      App.playlists.addTrackToPlaylist(id, playlistId);
      UI.toast(`「${track.title}」を追加しました`, 'success');
    } catch(e) {
      console.error(e);
      UI.toast('追加に失敗しました: ' + e.message, 'error');
    } finally {
      UI.hideProcessing();
    }

    _pendingIndex++;
    _showNextAddModal();
  };

  // ============================================================
  // Google Drive からの追加
  // ============================================================
  const addFromDrive = async (doc) => {
    // Picker からの doc: { id, name, mimeType, ... }
    const meta = {
      title: doc.name.replace(/\.[^.]+$/, ''),
      artist: '', album: '', year: '', genre: '', tags: []
    };
    App.modal.openAddFile({ name: doc.name, size: doc.sizeBytes }, meta, doc);
  };

  const confirmAddFromDrive = async (trackInfo, driveDoc, playlistId) => {
    UI.showProcessing('Google Driveから追加中...');
    try {
      const id = Storage.generateId();
      const track = {
        id,
        title: trackInfo.title || driveDoc.name,
        artist: trackInfo.artist || '',
        album: trackInfo.album || '',
        year: parseInt(trackInfo.year) || null,
        genre: trackInfo.genre || '',
        tags: trackInfo.tags || [],
        thumbnailBase64: trackInfo.thumbnailBase64 || null,
        source: 'gdrive',
        driveFileId: driveDoc.id,
        mimeType: driveDoc.mimeType,
        addedAt: Date.now(),
        duration: null,
        fileName: driveDoc.name
      };
      Storage.addTrack(track);
      App.playlists.addTrackToPlaylist(id, playlistId);
      UI.toast(`「${track.title}」をGoogle Driveから追加しました`, 'success');
    } catch(e) {
      UI.toast('追加失敗: ' + e.message, 'error');
    } finally {
      UI.hideProcessing();
    }
    App.playlists.render();
    App.editor.refreshSelect();
  };

  // ============================================================
  // Google Drive へのアップロード
  // ============================================================
  const uploadToDrive = async (file, trackInfo) => {
    if (!Auth.isLoggedIn()) {
      UI.toast('Google Driveへのアップロードにはログインが必要です', 'warning');
      return;
    }
    UI.showProcessing('Google Driveにアップロード中...');
    try {
      const driveFile = await GDrive.uploadFile(file, (pct) => {
        UI.updateProcessingProgress(pct);
      });
      await confirmAddFromDrive(trackInfo, driveFile, null);
    } catch(e) {
      UI.toast('アップロード失敗: ' + e.message, 'error');
    } finally {
      UI.hideProcessing();
    }
  };

  // ============================================================
  // ドラッグ&ドロップ初期化
  // ============================================================
  const initDropZone = () => {
    const dropZone = document.getElementById('dropZone');
    const trackListContainer = document.querySelector('.track-list-container');
    const mainContent = document.getElementById('mainContent');

    // ページ全体のドロップ対応
    mainContent.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        dropZone.classList.add('visible', 'dragover');
      }
    });
    mainContent.addEventListener('dragleave', (e) => {
      if (!mainContent.contains(e.relatedTarget)) {
        dropZone.classList.remove('dragover');
      }
    });
    mainContent.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length) handleInput(files);
    });

    dropZone.addEventListener('click', () => document.getElementById('fileInput').click());
  };

  // ============================================================
  // Helpers
  // ============================================================
  const _isAudio = (name) => {
    const ext = name.split('.').pop().toLowerCase();
    return CONFIG.SUPPORTED_AUDIO.includes(ext);
  };

  const getPendingFile = () => _pendingFiles[_pendingIndex];
  const getPendingDriveDoc = () => null;

  return {
    handleInput, confirmAdd, addFromDrive, confirmAddFromDrive,
    uploadToDrive, initDropZone, getPendingFile
  };
})();
