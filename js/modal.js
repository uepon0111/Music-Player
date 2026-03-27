/**
 * modal.js — モーダル管理
 */
const Modal = (() => {
  let _pendingFile  = null;
  let _isDrive      = false;
  let _addTags      = [];   // [{name,color}]
  let _addThumb     = null;
  let _confirmRes   = null;
  let _promptRes    = null;
  let _atp_trackId  = null; // addToPlaylist 対象
  let _tagTarget    = null; // {tagObj, setter(newTagObj)}
  let _tagColor     = null;

  /* ── 汎用 ── */
  const open  = (id) => document.getElementById(id)?.classList.remove('hidden');
  const close = (id) => document.getElementById(id)?.classList.add('hidden');

  /* ════════════════════════════════════
     ファイル追加モーダル
  ════════════════════════════════════ */
  const openAddFile = (file, meta, isDrive=false) => {
    _pendingFile = file; _isDrive = isDrive;
    _addTags  = (meta.tags||[]).map(t => typeof t==='string' ? {name:t,color:Tags.defaultColor(t)} : t);
    _addThumb = meta.thumbnailBase64 || null;

    document.getElementById('modalFileInfo').innerHTML =
      `<i class="fa-solid fa-file-audio"></i> ${_esc(file.name)}${file.size ? ` (${(file.size/1048576).toFixed(1)} MB)` : ''}`;

    _el('addTitle').value  = meta.title  || '';
    _el('addArtist').value = meta.artist || '';
    _el('addAlbum').value  = meta.album  || '';
    _el('addDate').value   = meta.date   || '';
    _el('addGenre').value  = meta.genre  || '';
    _el('addTagsInput').value = '';
    _renderAddTags();
    _updateAddThumb();

    const ti = _el('addTagsInput');
    ti.onkeydown = (e) => {
      if (e.key==='Enter'||e.key===',') {
        e.preventDefault();
        const v = ti.value.trim().replace(/,/g,'');
        if (v && !_addTags.find(t=>t.name===v)) { _addTags.push({ name:v, color:Tags.defaultColor(v) }); _renderAddTags(); }
        ti.value='';
      }
      if (e.key==='Backspace' && !ti.value && _addTags.length) { _addTags.pop(); _renderAddTags(); }
    };
    open('addFileModal');
  };

  const _renderAddTags = () => {
    const c = _el('addTagsDisplay'); if (!c) return;
    c.innerHTML='';
    _addTags.forEach((tag,i) => {
      const chip = Tags.chip(tag, {
        removable: true,
        onRemove: (name) => { _addTags=_addTags.filter(t=>t.name!==name); _renderAddTags(); },
        onColorClick: (tagObj) => openTagColor(tagObj, (newTag) => { _addTags[_addTags.findIndex(t=>t.name===tagObj.name)]=newTag; _renderAddTags(); })
      });
      c.appendChild(chip);
    });
  };

  const setThumb = (input) => {
    const f=input.files[0]; if (!f) return;
    const r=new FileReader(); r.onload=e=>{ _addThumb=e.target.result; _updateAddThumb(); }; r.readAsDataURL(f); input.value='';
  };
  const _updateAddThumb = () => {
    const m=_el('addThumbPreview'); if(!m) return;
    m.innerHTML = _addThumb ? `<img src="${_addThumb}" alt="" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fa-solid fa-music"></i>`;
  };

  const confirmAdd = async () => {
    const info = {
      title:  _el('addTitle').value.trim(),
      artist: _el('addArtist').value.trim(),
      album:  _el('addAlbum').value.trim(),
      date:   _el('addDate').value,
      genre:  _el('addGenre').value.trim(),
      tags:   [..._addTags],
      thumbnailBase64: _addThumb
    };
    close('addFileModal');
    if (_isDrive) await Files.confirmAddDrive(info);
    else          await Files.confirmAdd(info, _pendingFile);
  };

  const skipAdd = () => { close('addFileModal'); Files.skipAdd(); };

  /* ════════════════════════════════════
     プレイリストに追加モーダル
  ════════════════════════════════════ */
  const openAddToPlaylist = (tid) => {
    _atp_trackId = tid;
    const d     = Storage.get();
    const track = d.tracks[tid];
    _el('addToPlaylistTrackName').textContent = track ? `「${track.title||'不明'}」` : '';
    const list = _el('playlistCheckList');
    list.innerHTML='';
    (d.playlists||[]).forEach(pl => {
      const checked = pl.trackIds.includes(tid);
      const item = document.createElement('div');
      item.className='playlist-check-item';
      item.innerHTML=`<input type="checkbox" id="plck_${pl.id}" value="${pl.id}" ${checked?'checked':''}><label for="plck_${pl.id}">${_esc(pl.name)}</label>`;
      list.appendChild(item);
    });
    if (!d.playlists?.length) list.innerHTML='<p style="color:var(--text-muted);font-size:.86rem;">プレイリストがありません。<br>まず「+」でプレイリストを作成してください。</p>';
    open('addToPlaylistModal');
  };

  const confirmAddToPlaylist = () => {
    const ids = [...document.querySelectorAll('#playlistCheckList input:checked')].map(i=>i.value);
    App.playlists.addToPlaylists(_atp_trackId, ids);
    close('addToPlaylistModal');
    App.ui.toast('プレイリストを更新しました','success');
  };

  /* ════════════════════════════════════
     タグカラーモーダル
  ════════════════════════════════════ */
  /** setter: (newTagObj) => void  — 呼び出し元に色変更を返す */
  const openTagColor = (tagObj, setter) => {
    _tagTarget = { tagObj, setter };
    _tagColor  = tagObj.color || Tags.defaultColor(tagObj.name);
    _el('tagColorName').textContent = `タグ: ${tagObj.name}`;
    const pal = _el('colorPalette');
    pal.innerHTML='';
    Tags.getPalette().forEach(c => {
      const sw=document.createElement('div');
      sw.className='color-swatch'+(c===_tagColor?' selected':'');
      sw.style.background=c; sw.title=c;
      sw.onclick=()=>{ document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected')); sw.classList.add('selected'); _tagColor=c; _el('customColorInput').value=c; };
      pal.appendChild(sw);
    });
    const ci=_el('customColorInput'); ci.value=_tagColor;
    ci.oninput=(e)=>{ _tagColor=e.target.value; document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected')); };
    open('tagColorModal');
  };

  const confirmTagColor = () => {
    if (_tagTarget && _tagColor) {
      const newTag = { name: _tagTarget.tagObj.name, color: _tagColor };
      // 全トラックの同名タグの色を更新
      const d = Storage.get();
      Object.values(d.tracks).forEach(t => {
        if (!t.tags) return;
        const idx = t.tags.findIndex(g=>g.name===newTag.name);
        if (idx>=0) { t.tags[idx]=newTag; Storage.updateTrack(t.id,{tags:t.tags}); }
      });
      if (_tagTarget.setter) _tagTarget.setter(newTag);
      App.playlists.renderList();
    }
    close('tagColorModal');
  };

  /* ════════════════════════════════════
     confirm / prompt
  ════════════════════════════════════ */
  const confirm = (msg, title='確認') => new Promise(res => {
    _confirmRes=res;
    _el('confirmTitle').textContent=title;
    _el('confirmMessage').textContent=msg;
    open('confirmModal');
  });
  const resolveConfirm = (v) => { close('confirmModal'); _confirmRes?.(v); _confirmRes=null; };

  const prompt = (msg, def='', title='入力') => new Promise(res => {
    _promptRes=res;
    _el('promptTitle').textContent=title;
    _el('promptMessage').textContent=msg;
    const inp=_el('promptInput'); inp.value=def;
    inp.onkeydown=e=>{ if(e.key==='Enter') resolvePrompt(inp.value); };
    open('promptModal');
    setTimeout(()=>inp.focus(),80);
  });
  const resolvePrompt = (v) => { close('promptModal'); _promptRes?.(v?.trim()||null); _promptRes=null; };

  /* ── helpers ── */
  const _el  = (id) => document.getElementById(id);
  const _esc = (s)  => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  return {
    open, close,
    openAddFile, setThumb, confirmAdd, skipAdd,
    openAddToPlaylist, confirmAddToPlaylist,
    openTagColor, confirmTagColor,
    confirm, resolveConfirm,
    prompt,  resolvePrompt
  };
})();
