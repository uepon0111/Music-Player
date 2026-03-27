/**
 * playlists.js — プレイリスト管理
 *
 * activeId === 'library' → マイライブラリ (libraryOrder)
 * activeId === 'pl_xxx'  → カスタムプレイリスト (playlist.trackIds)
 */
const Playlists = (() => {
  let _sort         = 'manual';
  let _query        = '';
  let _tagFilters   = new Set(); // Set of tag names
  let _dragSrcId    = null;

  /* ═══════════════════════════════════════════════
     公開 API
  ═══════════════════════════════════════════════ */

  /** 全体を再描画 */
  const render = async () => {
    const d = Storage.get();
    const aid = d.settings.activePlaylistId || 'library';
    _renderTabs(d, aid);
    _renderTagBar();
    _renderList(d, aid);
    _updateHeader(d, aid);
  };

  /** トラックリストだけ更新 */
  const renderList = () => {
    const d = Storage.get();
    _renderList(d, d.settings.activePlaylistId || 'library');
  };

  /** アクティブトラックのハイライト */
  const markActive = (tid) => {
    document.querySelectorAll('.track-item').forEach(el =>
      el.classList.toggle('active', el.dataset.trackId === tid)
    );
  };

  /** 再生時間を表示に反映 */
  const refreshDuration = (tid, sec) => {
    document.querySelectorAll(`.track-item[data-track-id="${tid}"] .track-duration`).forEach(el => el.textContent = _fmt(sec));
  };

  /** 現在コンテキストの (ソート済み) ID 配列 */
  const currentIds = () => {
    const d = Storage.get();
    const aid = d.settings.activePlaylistId || 'library';
    return _sorted(_ids(d, aid), d.tracks, _sort);
  };

  /* ═══════════════════════════════════════════════
     タブ
  ═══════════════════════════════════════════════ */
  const _renderTabs = (d, aid) => {
    // ライブラリタブ
    document.querySelector('.playlist-tab[data-pid="library"]')?.classList.toggle('active', aid === 'library');
    // カスタム
    const wrap = document.getElementById('playlistTabs');
    if (!wrap) return;
    wrap.innerHTML = '';
    (d.playlists || []).forEach(pl => {
      const btn = document.createElement('button');
      btn.className = 'playlist-tab' + (pl.id === aid ? ' active' : '');
      btn.dataset.pid = pl.id;
      btn.textContent = pl.name;
      btn.onclick = () => switchPlaylist(pl.id);
      wrap.appendChild(btn);
    });
  };

  /* ═══════════════════════════════════════════════
     タグフィルターバー
  ═══════════════════════════════════════════════ */
  const _renderTagBar = () => {
    const bar = document.getElementById('tagFilterBar');
    if (!bar) return;
    const all = Tags.allTags();
    if (!all.length) { bar.innerHTML = ''; return; }
    bar.innerHTML = '';
    all.forEach(tag => {
      const c = Tags.filterChip(tag, _tagFilters.has(tag.name), () => {
        _tagFilters.has(tag.name) ? _tagFilters.delete(tag.name) : _tagFilters.add(tag.name);
        _renderTagBar();
        renderList();
      });
      bar.appendChild(c);
    });
  };

  /* ═══════════════════════════════════════════════
     トラックリスト
  ═══════════════════════════════════════════════ */
  const _renderList = (d, aid) => {
    const listEl = document.getElementById('trackList');
    const dropZone = document.getElementById('dropZone');
    if (!listEl) return;

    let ids = _sorted(_ids(d, aid), d.tracks, _sort);
    ids = _filter(ids, d.tracks);

    const isEmpty = ids.length === 0;
    const noResults = isEmpty && (_query || _tagFilters.size > 0);

    if (isEmpty && !noResults) {
      listEl.innerHTML = '<li class="empty-list"><i class="fa-solid fa-music"></i><span>曲がありません<br>ファイルを追加してください</span></li>';
      dropZone?.classList.add('visible');
      return;
    }
    dropZone?.classList.remove('visible');

    if (noResults) {
      listEl.innerHTML = '<li class="empty-list"><i class="fa-solid fa-magnifying-glass"></i><span>検索結果がありません</span></li>';
      return;
    }

    const curTid = Player.getCurrentId();
    listEl.innerHTML = '';
    ids.forEach((id, idx) => {
      const t = d.tracks[id];
      if (!t) return;
      listEl.appendChild(_mkItem(t, idx, id === curTid, aid));
    });
  };

  const _mkItem = (t, idx, active, aid) => {
    const li = document.createElement('li');
    li.className = 'track-item' + (active ? ' active' : '');
    li.dataset.trackId = t.id;
    li.draggable = _sort === 'manual';

    // サムネイル
    const thumbEl = document.createElement('div');
    thumbEl.className = 'track-thumb';
    if (t.thumbnailBase64) { const img=document.createElement('img'); img.src=t.thumbnailBase64; img.alt=''; thumbEl.appendChild(img); }
    else { thumbEl.innerHTML='<i class="fa-solid fa-music"></i>'; }

    // メタ
    const metaEl = document.createElement('div');
    metaEl.className = 'track-meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'track-name';
    nameEl.textContent = t.title || t.fileName || '不明';
    const subEl = document.createElement('div');
    subEl.className = 'track-sub';
    const sub = [t.artist, t.date ? t.date.slice(0,4) : ''].filter(Boolean).join('  ·  ');
    subEl.textContent = sub || '不明なアーティスト';
    metaEl.appendChild(nameEl);
    metaEl.appendChild(subEl);

    // タグ chips
    if (t.tags?.length) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'track-tags';
      t.tags.forEach(tag => tagsEl.appendChild(Tags.miniChip(tag)));
      metaEl.appendChild(tagsEl);
    }

    // 再生時間
    const durEl = document.createElement('span');
    durEl.className = 'track-duration';
    durEl.textContent = t.duration ? _fmt(t.duration) : '--:--';

    // アクションボタン
    const actEl = document.createElement('div');
    actEl.className = 'track-actions';
    if (aid === 'library') {
      actEl.innerHTML =
        `<button class="track-action-btn" title="プレイリストに追加" onclick="App.modal.openAddToPlaylist('${t.id}')"><i class="fa-solid fa-list-plus"></i></button>
         <button class="track-action-btn" title="編集" onclick="App.editor.openFor('${t.id}')"><i class="fa-solid fa-pen"></i></button>
         <button class="track-action-btn danger" title="削除" onclick="App.playlists.promptRemoveTrack('${t.id}')"><i class="fa-solid fa-trash"></i></button>`;
    } else {
      actEl.innerHTML =
        `<button class="track-action-btn" title="プレイリストから外す" onclick="App.playlists.removeFromPlaylist('${t.id}','${aid}')"><i class="fa-solid fa-minus"></i></button>
         <button class="track-action-btn" title="編集" onclick="App.editor.openFor('${t.id}')"><i class="fa-solid fa-pen"></i></button>`;
    }

    // 番号
    const numEl = document.createElement('span');
    numEl.className = 'track-num';
    numEl.textContent = idx + 1;

    li.appendChild(numEl);
    li.appendChild(thumbEl);
    li.appendChild(metaEl);
    li.appendChild(durEl);
    li.appendChild(actEl);

    // 再生
    li.addEventListener('click', e => {
      if (e.target.closest('.track-actions')) return;
      Player.play(t.id);
      Player.setCtx(aid);
    });

    // ドラッグ&ドロップ（手動順のみ）
    if (_sort === 'manual') {
      li.addEventListener('dragstart', e => { _dragSrcId=t.id; e.dataTransfer.effectAllowed='move'; li.classList.add('dragging'); });
      li.addEventListener('dragend',   () => { li.classList.remove('dragging','doh','dob'); });
      li.addEventListener('dragover',  e => { e.preventDefault(); const mid=li.getBoundingClientRect().top+li.offsetHeight/2; li.classList.toggle('doh',e.clientY<mid); li.classList.toggle('dob',e.clientY>=mid); });
      li.addEventListener('dragleave', () => li.classList.remove('doh','dob'));
      li.addEventListener('drop',      e => {
        e.preventDefault();
        const after = li.classList.contains('dob');
        li.classList.remove('doh','dob');
        if (!_dragSrcId || _dragSrcId===t.id) return;
        _moveTrack(_dragSrcId, t.id, after, aid);
        _dragSrcId = null;
      });
    }

    return li;
  };

  /* ── D&D 並び替え ── */
  const _moveTrack = (srcId, tgtId, after, aid) => {
    const d = Storage.get();
    let arr = aid==='library' ? [...(d.libraryOrder||[])] : [...((d.playlists.find(p=>p.id===aid)||{}).trackIds||[])];
    const si = arr.indexOf(srcId); if (si<0) return;
    arr.splice(si,1);
    let ti = arr.indexOf(tgtId); if (after) ti++;
    arr.splice(ti,0,srcId);
    if (aid==='library') { d.libraryOrder=arr; Storage.set('libraryOrder',arr); }
    else { const pl=d.playlists.find(p=>p.id===aid); if(pl){pl.trackIds=arr; Storage.set('playlists',d.playlists);} }
    renderList();
  };

  /* ═══════════════════════════════════════════════
     プレイリスト CRUD
  ═══════════════════════════════════════════════ */
  const switchPlaylist = (id) => {
    const d = Storage.get();
    d.settings.activePlaylistId = id;
    Storage.set('settings', d.settings);
    Player.setCtx(id);
    render();
  };

  const create = async () => {
    const name = await App.modal.prompt('プレイリスト名を入力してください', '新規プレイリスト', 'プレイリスト作成');
    if (!name?.trim()) return;
    const d = Storage.get();
    const pl = { id:'pl_'+Date.now(), name:name.trim(), trackIds:[], createdAt:Date.now() };
    d.playlists.push(pl);
    d.settings.activePlaylistId = pl.id;
    Storage.set('playlists', d.playlists);
    Storage.set('settings',  d.settings);
    Player.setCtx(pl.id);
    render();
    App.ui.toast(`「${pl.name}」を作成しました`, 'success');
  };

  const renamePrompt = async () => {
    const d = Storage.get();
    const aid = d.settings.activePlaylistId;
    if (aid==='library') { App.ui.toast('マイライブラリは名前変更できません','warning'); return; }
    const pl = d.playlists.find(p=>p.id===aid); if (!pl) return;
    const name = await App.modal.prompt('新しい名前を入力してください', pl.name, '名前変更');
    if (!name?.trim() || name.trim()===pl.name) return;
    pl.name = name.trim();
    Storage.set('playlists', d.playlists);
    render();
    App.ui.toast('名前を変更しました');
  };

  const deleteCurrentPrompt = async () => {
    const d = Storage.get();
    const aid = d.settings.activePlaylistId;
    if (aid==='library') { App.ui.toast('マイライブラリは削除できません','warning'); return; }
    const pl = d.playlists.find(p=>p.id===aid); if (!pl) return;
    const ok = await App.modal.confirm(`「${pl.name}」を削除しますか？\n（曲ファイルは削除されません）`);
    if (!ok) return;
    d.playlists = d.playlists.filter(p=>p.id!==aid);
    d.settings.activePlaylistId = 'library';
    Storage.set('playlists', d.playlists);
    Storage.set('settings',  d.settings);
    Player.setCtx('library');
    render();
    App.ui.toast('削除しました');
  };

  /* ── トラック追加 ── */
  const addToLibrary = (tid) => {
    const d = Storage.get();
    if (!(d.libraryOrder||[]).includes(tid)) {
      d.libraryOrder = [...(d.libraryOrder||[]), tid];
      Storage.set('libraryOrder', d.libraryOrder);
    }
    renderList();
  };

  const addToPlaylists = (tid, plIds) => {
    const d = Storage.get();
    plIds.forEach(pid => {
      const pl = d.playlists.find(p=>p.id===pid);
      if (pl && !pl.trackIds.includes(tid)) pl.trackIds.push(tid);
    });
    Storage.set('playlists', d.playlists);
    renderList();
  };

  const removeFromPlaylist = (tid, pid) => {
    const d = Storage.get();
    const pl = d.playlists.find(p=>p.id===pid); if (!pl) return;
    pl.trackIds = pl.trackIds.filter(x=>x!==tid);
    Storage.set('playlists', d.playlists);
    renderList();
    App.ui.toast('プレイリストから削除しました');
  };

  const promptRemoveTrack = async (tid) => {
    const t = (Storage.get('tracks')||{})[tid];
    const ok = await App.modal.confirm(`「${t?.title||'曲'}」を完全に削除しますか？\n全プレイリストから削除されます。`);
    if (!ok) return;
    Storage.clearBlob(tid);
    Storage.removeTrack(tid);
    if (Player.getCurrentId()===tid) Player.next();
    render();
    App.editor.refreshSelect();
    App.ui.toast('削除しました');
  };

  /* ─── ソート・フィルター ─── */
  const sort = (mode) => { _sort = mode; renderList(); };

  const applyFilter = () => {
    _query = (document.getElementById('searchInput')?.value || '').trim();
    document.getElementById('searchClear')?.classList.toggle('hidden', !_query);
    renderList();
  };
  const clearSearch = () => {
    if (document.getElementById('searchInput')) document.getElementById('searchInput').value = '';
    _query = '';
    document.getElementById('searchClear')?.classList.add('hidden');
    renderList();
  };

  const _ids = (d, aid) => {
    if (aid==='library') return [...(d.libraryOrder || Object.keys(d.tracks||{}))];
    const pl = (d.playlists||[]).find(p=>p.id===aid);
    return pl ? [...(pl.trackIds||[])] : [];
  };

  const _filter = (ids, tracks) => {
    let out = ids;
    if (_query) {
      const q = _query.toLowerCase();
      out = out.filter(id => {
        const t = tracks[id]; if (!t) return false;
        return (t.title||'').toLowerCase().includes(q)
          || (t.artist||'').toLowerCase().includes(q)
          || (t.album||'').toLowerCase().includes(q)
          || (t.date||'').includes(q)
          || (t.genre||'').toLowerCase().includes(q);
      });
    }
    if (_tagFilters.size) {
      out = out.filter(id => {
        const t = tracks[id]; if (!t) return false;
        const names = (t.tags||[]).map(g=>g.name);
        return [..._tagFilters].every(f => names.includes(f));
      });
    }
    return out;
  };

  const _sorted = (ids, tracks, mode) => {
    if (mode==='manual') return ids;
    const wt = ids.map(id=>({id,t:tracks[id]})).filter(x=>x.t);
    const c = (a,b,key,asc) => { const av=a.t[key]||'', bv=b.t[key]||''; return asc ? String(av).localeCompare(String(bv),'ja') : String(bv).localeCompare(String(av),'ja'); };
    switch(mode) {
      case 'name-asc':      wt.sort((a,b)=>c(a,b,'title',true));    break;
      case 'name-desc':     wt.sort((a,b)=>c(a,b,'title',false));   break;
      case 'added-asc':     wt.sort((a,b)=>(a.t.addedAt||0)-(b.t.addedAt||0)); break;
      case 'added-desc':    wt.sort((a,b)=>(b.t.addedAt||0)-(a.t.addedAt||0)); break;
      case 'duration-asc':  wt.sort((a,b)=>(a.t.duration||0)-(b.t.duration||0)); break;
      case 'duration-desc': wt.sort((a,b)=>(b.t.duration||0)-(a.t.duration||0)); break;
      case 'date-asc':      wt.sort((a,b)=>c(a,b,'date',true));     break;
      case 'date-desc':     wt.sort((a,b)=>c(a,b,'date',false));    break;
      case 'random':        wt.sort(()=>Math.random()-.5);           break;
    }
    return wt.map(x=>x.id);
  };

  /* ─── ヘッダー更新 ─── */
  const _updateHeader = (d, aid) => {
    const titleEl = document.getElementById('panelTitle');
    if (titleEl) titleEl.textContent = aid==='library' ? 'マイライブラリ' : ((d.playlists||[]).find(p=>p.id===aid)?.name || 'プレイリスト');
    // 編集ボタン: ライブラリ時は非表示
    document.getElementById('playlistEditBtns')?.classList.toggle('hidden', aid==='library');
  };

  const _fmt = (s) => { if(!s||isNaN(s)) return '--:--'; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`; };

  return {
    render, renderList, markActive, refreshDuration, currentIds,
    switchPlaylist, create, renamePrompt, deleteCurrentPrompt,
    addToLibrary, addToPlaylists, removeFromPlaylist, promptRemoveTrack,
    sort, applyFilter, clearSearch
  };
})();
