/**
 * playlists.js - プレイリスト管理
 */

const Playlists = (() => {
  let _currentSort = 'manual';
  let _dragSrcIndex = null;

  // ============================================================
  // レンダリング
  // ============================================================
  const render = async () => {
    const data = Storage.get();
    const playlists = data.playlists || [];
    const activeId = data.settings.activePlaylistId || 'default';

    // タブ
    const tabsEl = document.getElementById('playlistTabs');
    tabsEl.innerHTML = '';
    playlists.forEach(pl => {
      const tab = document.createElement('button');
      tab.className = 'playlist-tab' + (pl.id === activeId ? ' active' : '');
      tab.textContent = pl.name;
      tab.onclick = () => switchPlaylist(pl.id);
      tabsEl.appendChild(tab);
    });

    // トラックリスト
    renderTrackList();
  };

  const renderTrackList = () => {
    const data = Storage.get();
    const activeId = data.settings.activePlaylistId || 'default';
    const pl = data.playlists.find(p => p.id === activeId);
    const trackListEl = document.getElementById('trackList');
    const dropZone = document.getElementById('dropZone');

    if (!pl) { trackListEl.innerHTML = ''; return; }

    // ソート
    let ids = [...(pl.trackIds || [])];
    ids = _sortIds(ids, data.tracks, _currentSort);

    if (ids.length === 0) {
      trackListEl.innerHTML = `<li class="empty-list"><i class="fa-solid fa-music"></i>曲がありません<br/>ファイルを追加してください</li>`;
      dropZone.classList.add('visible');
      return;
    }
    dropZone.classList.remove('visible');

    const currentTrackId = Player.getCurrentTrackId();
    trackListEl.innerHTML = '';
    ids.forEach((id, idx) => {
      const track = data.tracks[id];
      if (!track) return;
      const li = _createTrackItem(track, idx, id === currentTrackId);
      trackListEl.appendChild(li);
    });
  };

  const _createTrackItem = (track, idx, isActive) => {
    const li = document.createElement('li');
    li.className = 'track-item' + (isActive ? ' active' : '');
    li.dataset.trackId = track.id;
    li.draggable = true;

    const thumb = track.thumbnailBase64
      ? `<img src="${track.thumbnailBase64}" alt="" />`
      : `<i class="fa-solid fa-music"></i>`;

    const dur = track.duration ? _formatTime(track.duration) : '--:--';
    const sub = [track.artist, track.album].filter(Boolean).join(' / ') || '不明なアーティスト';

    li.innerHTML = `
      <span class="track-num">${idx + 1}</span>
      <div class="track-thumb">${thumb}</div>
      <div class="track-meta">
        <div class="track-name">${_esc(track.title || track.fileName || '不明')}</div>
        <div class="track-sub">${_esc(sub)}</div>
      </div>
      <span class="track-duration">${dur}</span>
      <div class="track-actions">
        <button class="track-action-btn" title="編集" onclick="App.editor.openForTrack('${track.id}')"><i class="fa-solid fa-pen"></i></button>
        <button class="track-action-btn delete" title="削除" onclick="App.playlists.removeTrackPrompt('${track.id}')"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;

    li.addEventListener('click', (e) => {
      if (e.target.closest('.track-actions')) return;
      Player.play(track.id);
      Player.setPlaylist(Storage.get().settings.activePlaylistId);
    });

    // ドラッグ&ドロップ（手動並べ替え）
    li.addEventListener('dragstart', (e) => {
      _dragSrcIndex = idx;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      if (_dragSrcIndex === null || _dragSrcIndex === idx) return;
      _moveTrack(_dragSrcIndex, idx);
      _dragSrcIndex = null;
    });

    return li;
  };

  const _moveTrack = (fromIdx, toIdx) => {
    const data = Storage.get();
    const activeId = data.settings.activePlaylistId;
    const pl = data.playlists.find(p => p.id === activeId);
    if (!pl) return;
    const ids = [...pl.trackIds];
    const [removed] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, removed);
    pl.trackIds = ids;
    Storage.save();
    renderTrackList();
  };

  // ============================================================
  // プレイリスト操作
  // ============================================================
  const switchPlaylist = (id) => {
    const data = Storage.get();
    data.settings.activePlaylistId = id;
    Storage.set('settings', data.settings);
    Player.setPlaylist(id);
    render();
  };

  const create = async () => {
    const name = await UI.prompt('新しいプレイリスト名を入力してください', '新規プレイリスト', '新規プレイリスト');
    if (!name) return;
    const data = Storage.get();
    const newPl = {
      id: 'pl_' + Date.now(),
      name: name.trim(),
      trackIds: [],
      createdAt: Date.now()
    };
    data.playlists.push(newPl);
    data.settings.activePlaylistId = newPl.id;
    Storage.set('playlists', data.playlists);
    Storage.set('settings', data.settings);
    Player.setPlaylist(newPl.id);
    render();
    UI.toast(`「${newPl.name}」を作成しました`, 'success');
  };

  const deleteCurrentPrompt = async () => {
    const data = Storage.get();
    const id = data.settings.activePlaylistId;
    const pl = data.playlists.find(p => p.id === id);
    if (!pl) return;
    if (data.playlists.length === 1) {
      UI.toast('最後のプレイリストは削除できません', 'warning');
      return;
    }
    const ok = await UI.confirm(`「${pl.name}」を削除しますか？\n曲ファイルは削除されません。`);
    if (!ok) return;
    data.playlists = data.playlists.filter(p => p.id !== id);
    data.settings.activePlaylistId = data.playlists[0].id;
    Storage.set('playlists', data.playlists);
    Storage.set('settings', data.settings);
    render();
    UI.toast('プレイリストを削除しました');
  };

  const renamePrompt = async () => {
    const data = Storage.get();
    const id = data.settings.activePlaylistId;
    const pl = data.playlists.find(p => p.id === id);
    if (!pl) return;
    const name = await UI.prompt('新しい名前を入力してください', pl.name, 'プレイリスト名変更');
    if (!name || name.trim() === pl.name) return;
    pl.name = name.trim();
    Storage.set('playlists', data.playlists);
    render();
    UI.toast('名前を変更しました');
  };

  // ============================================================
  // トラック追加・削除
  // ============================================================
  const addTrackToPlaylist = (trackId, playlistId) => {
    const data = Storage.get();
    const pl = data.playlists.find(p => p.id === (playlistId || data.settings.activePlaylistId));
    if (!pl) return;
    if (!pl.trackIds.includes(trackId)) {
      pl.trackIds.push(trackId);
      Storage.set('playlists', data.playlists);
    }
    renderTrackList();
  };

  const removeTrackPrompt = async (trackId) => {
    const data = Storage.get();
    const track = data.tracks[trackId];
    const ok = await UI.confirm(`「${track?.title || '曲'}」を削除しますか？\nすべてのプレイリストから削除されます。`);
    if (!ok) return;
    // キャッシュもクリア
    Storage.clearAudioCache(trackId);
    Storage.removeTrack(trackId);
    if (Player.getCurrentTrackId() === trackId) {
      Player.next();
    }
    render();
    App.editor.refreshSelect();
    UI.toast('削除しました');
  };

  // ============================================================
  // ソート
  // ============================================================
  const sort = (mode) => {
    _currentSort = mode;
    renderTrackList();
  };

  const _sortIds = (ids, tracks, mode) => {
    if (mode === 'manual') return ids;
    const withTrack = ids.map(id => ({ id, t: tracks[id] })).filter(x => x.t);
    switch(mode) {
      case 'name-asc':   withTrack.sort((a,b) => (a.t.title||'').localeCompare(b.t.title||'', 'ja')); break;
      case 'name-desc':  withTrack.sort((a,b) => (b.t.title||'').localeCompare(a.t.title||'', 'ja')); break;
      case 'added-asc':  withTrack.sort((a,b) => (a.t.addedAt||0) - (b.t.addedAt||0)); break;
      case 'added-desc': withTrack.sort((a,b) => (b.t.addedAt||0) - (a.t.addedAt||0)); break;
      case 'duration-asc':  withTrack.sort((a,b) => (a.t.duration||0) - (b.t.duration||0)); break;
      case 'duration-desc': withTrack.sort((a,b) => (b.t.duration||0) - (a.t.duration||0)); break;
      case 'date-asc':  withTrack.sort((a,b) => (a.t.year||0) - (b.t.year||0)); break;
      case 'date-desc': withTrack.sort((a,b) => (b.t.year||0) - (a.t.year||0)); break;
      case 'random':    withTrack.sort(() => Math.random() - 0.5); break;
    }
    return withTrack.map(x => x.id);
  };

  // ============================================================
  // UI 補助
  // ============================================================
  const updateActiveTrack = (trackId) => {
    document.querySelectorAll('.track-item').forEach(el => {
      el.classList.toggle('active', el.dataset.trackId === trackId);
    });
  };

  const updateTrackDuration = (trackId, duration) => {
    // 表示を更新
    document.querySelectorAll(`.track-item[data-track-id="${trackId}"]`).forEach(el => {
      const durEl = el.querySelector('.track-duration');
      if (durEl) durEl.textContent = _formatTime(duration);
    });
  };

  const refreshEditorSelect = () => App.editor.refreshSelect();

  // ============================================================
  // Helpers
  // ============================================================
  const _formatTime = (s) => {
    if (!s || isNaN(s)) return '--:--';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };
  const _esc = (str) => (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  return {
    render, renderTrackList, switchPlaylist, create,
    deleteCurrentPrompt, renamePrompt,
    addTrackToPlaylist, removeTrackPrompt, sort,
    updateActiveTrack, updateTrackDuration
  };
})();
