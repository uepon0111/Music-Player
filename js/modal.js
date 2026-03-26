/**
 * modal.js - モーダル管理
 */

const Modal = (() => {
  let _pendingFile = null;
  let _pendingDriveDoc = null;
  let _addTags = [];
  let _addThumbData = null;

  // ============================================================
  // 汎用
  // ============================================================
  const open = (id) => {
    document.getElementById(id)?.classList.remove('hidden');
  };

  const close = (id) => {
    document.getElementById(id)?.classList.add('hidden');
  };

  // ============================================================
  // ファイル追加モーダル
  // ============================================================
  const openAddFile = (file, meta, driveDoc = null) => {
    _pendingFile = file;
    _pendingDriveDoc = driveDoc;
    _addTags = [...(meta.tags || [])];
    _addThumbData = null;

    // ファイル情報
    const infoEl = document.getElementById('modalFileInfo');
    const sizeStr = file.size ? ` (${(file.size / 1024 / 1024).toFixed(1)} MB)` : '';
    infoEl.innerHTML = `<i class="fa-solid fa-file-audio"></i> ${_esc(file.name)}${sizeStr}`;

    // フォームに値をセット
    document.getElementById('addTitle').value = meta.title || file.name.replace(/\.[^.]+$/, '');
    document.getElementById('addArtist').value = meta.artist || '';
    document.getElementById('addAlbum').value = meta.album || '';
    document.getElementById('addYear').value = meta.year || '';
    document.getElementById('addGenre').value = meta.genre || '';
    document.getElementById('addTagsInput').value = '';

    // タグ
    _renderAddTags();

    // サムネイル
    _updateAddThumb(null);

    // プレイリスト選択
    const sel = document.getElementById('addPlaylistSelect');
    const data = Storage.get();
    sel.innerHTML = data.playlists.map(pl =>
      `<option value="${pl.id}" ${pl.id === data.settings.activePlaylistId ? 'selected' : ''}>${_esc(pl.name)}</option>`
    ).join('');

    // タグ入力
    const tagInput = document.getElementById('addTagsInput');
    tagInput.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = tagInput.value.trim().replace(/,/g,'');
        if (val && !_addTags.includes(val)) {
          _addTags.push(val);
          _renderAddTags();
        }
        tagInput.value = '';
      }
      if (e.key === 'Backspace' && !tagInput.value && _addTags.length) {
        _addTags.pop();
        _renderAddTags();
      }
    };

    open('addFileModal');
  };

  const _renderAddTags = () => {
    const container = document.getElementById('addTagsDisplay');
    if (!container) return;
    container.innerHTML = '';
    _addTags.forEach((tag, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `${_esc(tag)}<button class="tag-chip-remove" onclick="App.modal.removeAddTag(${i})"><i class="fa-solid fa-xmark"></i></button>`;
      container.appendChild(chip);
    });
  };

  const removeAddTag = (idx) => {
    _addTags.splice(idx, 1);
    _renderAddTags();
  };

  const setThumb = (input) => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      _addThumbData = e.target.result;
      _updateAddThumb(_addThumbData);
    };
    reader.readAsDataURL(file);
    input.value = '';
  };

  const _updateAddThumb = (data) => {
    const mini = document.getElementById('addThumbPreview');
    if (!mini) return;
    if (data) {
      mini.innerHTML = `<img src="${data}" alt="" style="width:100%;height:100%;object-fit:cover;" />`;
    } else {
      mini.innerHTML = `<i class="fa-solid fa-music"></i>`;
    }
  };

  const confirmAdd = async () => {
    const trackInfo = {
      title: document.getElementById('addTitle').value.trim(),
      artist: document.getElementById('addArtist').value.trim(),
      album: document.getElementById('addAlbum').value.trim(),
      year: document.getElementById('addYear').value,
      genre: document.getElementById('addGenre').value.trim(),
      tags: [..._addTags],
      thumbnailBase64: _addThumbData
    };
    const playlistId = document.getElementById('addPlaylistSelect').value;

    close('addFileModal');

    if (_pendingDriveDoc) {
      await Files.confirmAddFromDrive(trackInfo, _pendingDriveDoc, playlistId);
    } else if (_pendingFile) {
      await Files.confirmAdd(trackInfo, _pendingFile, playlistId);
    }

    _pendingFile = null;
    _pendingDriveDoc = null;
  };

  // ============================================================
  // 確認ダイアログ
  // ============================================================
  const confirm = (message, title = '確認') => {
    return new Promise((resolve) => {
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMessage').textContent = message;
      const btn = document.getElementById('confirmOkBtn');
      const handler = () => {
        close('confirmModal');
        btn.removeEventListener('click', handler);
        resolve(true);
      };
      btn.addEventListener('click', handler);
      // キャンセル時も解決
      const cancelBtns = document.querySelectorAll('#confirmModal .btn-secondary, #confirmModal .modal-close');
      cancelBtns.forEach(b => {
        b.addEventListener('click', () => {
          close('confirmModal');
          resolve(false);
        }, { once: true });
      });
      open('confirmModal');
    });
  };

  // ============================================================
  // 入力ダイアログ
  // ============================================================
  const prompt = (message, defaultValue = '', title = '入力') => {
    return new Promise((resolve) => {
      document.getElementById('promptTitle').textContent = title;
      document.getElementById('promptMessage').textContent = message;
      const input = document.getElementById('promptInput');
      input.value = defaultValue;
      const btn = document.getElementById('promptOkBtn');
      const handler = () => {
        close('promptModal');
        btn.removeEventListener('click', handler);
        resolve(input.value.trim() || null);
      };
      btn.addEventListener('click', handler);
      input.onkeydown = (e) => { if (e.key === 'Enter') handler(); };
      const cancelBtns = document.querySelectorAll('#promptModal .btn-secondary, #promptModal .modal-close');
      cancelBtns.forEach(b => {
        b.addEventListener('click', () => {
          close('promptModal');
          resolve(null);
        }, { once: true });
      });
      open('promptModal');
      setTimeout(() => input.focus(), 100);
    });
  };

  const _esc = (str) => (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  return { open, close, openAddFile, removeAddTag, setThumb, confirmAdd, confirm, prompt };
})();
