/**
 * player.js — 再生エンジン
 */
const Player = (() => {
  const audio = new Audio();
  let _tid = null;       // 再生中トラックID
  let _ctxId = 'library'; // 現在のプレイリストコンテキスト
  let _shuffle = false;
  let _repeat   = 'none'; // none|all|one
  let _seeking  = false;
  let _started  = null;   // 再生開始 Date.now()
  let _played   = 0;      // 累計再生秒

  /* ── 初期化 ── */
  const init = () => {
    const d = Storage.get();
    _shuffle = d.settings.shuffle  || false;
    _repeat  = d.settings.repeat   || 'none';
    _ctxId   = d.settings.activePlaylistId || 'library';
    const vol = d.settings.volume ?? 80;
    audio.volume = vol / 100;
    _el('volumeSlider').value = vol;
    _el('volValue').textContent = vol + '%';
    _updateShuffleBtn(); _updateRepeatBtn();

    audio.addEventListener('timeupdate',    _onTime);
    audio.addEventListener('ended',         _onEnded);
    audio.addEventListener('loadedmetadata',_onMeta);
    audio.addEventListener('error',         () => App.ui.toast('再生エラー', 'error'));
    audio.addEventListener('play',          _onPlay);
    audio.addEventListener('pause',         _onPause);

    const pc = _el('progressContainer');
    pc.addEventListener('mousedown', _seekStart);
    pc.addEventListener('touchstart', e => _seekStartTouch(e), { passive: true });

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play',          () => _doPlay());
      navigator.mediaSession.setActionHandler('pause',         () => audio.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => prev());
      navigator.mediaSession.setActionHandler('nexttrack',     () => next());
    }

    // 前回のトラックを復元
    const tid = d.settings.activeTrackId;
    if (tid && d.tracks[tid]) _load(tid, false);
  };

  /* ── トラック読み込み ── */
  const _load = async (tid, autoPlay = true) => {
    const d = Storage.get();
    const t = d.tracks[tid];
    if (!t) return;

    // 前トラックのログ
    if (_tid && _started) _saveLog();

    _tid = tid; _played = 0; _started = null;
    _updateNP(t);

    if (t.source === 'gdrive') {
      if (Auth.isLoggedIn()) audio.src = GDrive.getStreamUrl(t.driveFileId);
      else { App.ui.toast('Google Drive のファイルはログインが必要です', 'warning'); return; }
    } else {
      const blob = Storage.getBlob(tid);
      if (blob) audio.src = URL.createObjectURL(blob);
      else { App.ui.toast('音声データが見つかりません', 'error'); return; }
    }

    d.settings.activeTrackId = tid;
    Storage.set('settings', d.settings);
    App.playlists.markActive(tid);
    App.editor.syncSelect(tid);

    if (autoPlay) { try { await audio.play(); } catch(e) { console.warn('autoplay blocked', e); } }
  };

  const _updateNP = (t) => {
    _el('trackTitle').textContent  = t.title  || '不明なタイトル';
    _el('trackArtist').textContent = t.artist || '不明なアーティスト';
    _el('trackAlbum').textContent  = t.album  || '不明なアルバム';
    const img  = _el('albumArtImg');
    const icon = _el('albumArtIcon');
    if (t.thumbnailBase64) { img.src = t.thumbnailBase64; img.classList.remove('hidden'); icon?.classList.add('hidden'); }
    else { img.src = ''; img.classList.add('hidden'); icon?.classList.remove('hidden'); }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title||'', artist: t.artist||'', album: t.album||'',
        artwork: t.thumbnailBase64 ? [{ src: t.thumbnailBase64, sizes:'512x512', type:'image/jpeg' }] : []
      });
    }
  };

  /* ── コントロール ── */
  const play      = (tid) => { if (tid) _load(tid); else if (_tid) _doPlay(); else _playFirst(); };
  const _doPlay   = async () => { try { await audio.play(); } catch(e) { console.warn(e); } };
  const togglePlay = () => { audio.paused ? _doPlay() : audio.pause(); };

  const prev = () => {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    const ids = _ctxIds();
    const i = ids.indexOf(_tid);
    if (i <= 0) { if (_repeat === 'all') _load(ids[ids.length-1]); else audio.currentTime = 0; }
    else _load(ids[i-1]);
  };

  const next = () => {
    const ids = _ctxIds();
    if (!ids.length) return;
    if (_shuffle) {
      const others = ids.filter(x => x !== _tid);
      _load(others.length ? others[Math.floor(Math.random()*others.length)] : ids[Math.floor(Math.random()*ids.length)]);
    } else {
      const i = ids.indexOf(_tid);
      if (i < 0 || i >= ids.length-1) { if (_repeat === 'all') _load(ids[0]); else audio.pause(); }
      else _load(ids[i+1]);
    }
  };

  /** 全曲 / シャッフル全曲再生 */
  const playAll = (shuffle) => {
    let ids = App.playlists.currentIds();
    if (!ids.length) { App.ui.toast('曲がありません', 'warning'); return; }
    if (shuffle) ids = [...ids].sort(() => Math.random() - 0.5);
    _load(ids[0]);
    // シャッフル状態を合わせる
    if (shuffle !== _shuffle) { _shuffle = shuffle; const d=Storage.get(); d.settings.shuffle=_shuffle; Storage.set('settings',d.settings); _updateShuffleBtn(); }
  };

  const _playFirst = () => { const ids = _ctxIds(); if (ids.length) _load(ids[0]); };
  const _ctxIds   = () => App.playlists.currentIds();

  const toggleShuffle = () => {
    _shuffle = !_shuffle;
    const d = Storage.get(); d.settings.shuffle = _shuffle; Storage.set('settings', d.settings);
    _updateShuffleBtn();
    App.ui.toast(_shuffle ? 'シャッフル ON' : 'シャッフル OFF');
  };

  const toggleRepeat = () => {
    const m = ['none','all','one'];
    _repeat = m[(m.indexOf(_repeat)+1)%m.length];
    const d = Storage.get(); d.settings.repeat = _repeat; Storage.set('settings', d.settings);
    _updateRepeatBtn();
    App.ui.toast({ none:'リピート OFF', all:'全曲リピート', one:'1曲リピート' }[_repeat]);
  };

  const setVolume = (v) => {
    v = parseInt(v); audio.volume = v/100;
    _el('volValue').textContent = v + '%';
    _el('volIcon').className = v===0?'fa-solid fa-volume-xmark vol-icon':v<50?'fa-solid fa-volume-low vol-icon':'fa-solid fa-volume-high vol-icon';
    const d=Storage.get(); d.settings.volume=v; Storage.set('settings',d.settings);
  };

  const toggleMute = () => {
    audio.muted = !audio.muted;
    _el('volIcon').className = audio.muted ? 'fa-solid fa-volume-xmark vol-icon' : 'fa-solid fa-volume-high vol-icon';
  };

  const setCtx = (id) => { _ctxId = id; };

  /* ── シーク ── */
  const _seekStart = (e) => {
    _seeking = true; _seekMove(e);
    const mu = (e) => _seekMove(e);
    const up = () => { _seeking=false; removeEventListener('mousemove',mu); removeEventListener('mouseup',up); };
    addEventListener('mousemove',mu); addEventListener('mouseup',up);
  };
  const _seekStartTouch = (e) => {
    _seeking = true; _seekMoveT(e);
    const mu = e => _seekMoveT(e);
    const up = () => { _seeking=false; removeEventListener('touchmove',mu); removeEventListener('touchend',up); };
    addEventListener('touchmove',mu); addEventListener('touchend',up);
  };
  const _seekMove  = (e) => { const r=_el('progressContainer').getBoundingClientRect(); const ratio=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)); if(audio.duration) audio.currentTime=ratio*audio.duration; };
  const _seekMoveT = (e) => { if(!e.touches.length) return; const r=_el('progressContainer').getBoundingClientRect(); const ratio=Math.max(0,Math.min(1,(e.touches[0].clientX-r.left)/r.width)); if(audio.duration) audio.currentTime=ratio*audio.duration; };

  /* ── イベント ── */
  const _onTime = () => {
    if (_seeking || !audio.duration) return;
    const r = audio.currentTime / audio.duration;
    _el('progressBar').style.width    = (r*100)+'%';
    _el('progressHandle').style.left  = (r*100)+'%';
    _el('currentTime').textContent    = _fmt(audio.currentTime);
  };
  const _onMeta = () => {
    _el('totalTime').textContent = _fmt(audio.duration);
    if (_tid) { Storage.updateTrack(_tid, { duration: audio.duration }); App.playlists.refreshDuration(_tid, audio.duration); }
  };
  const _onEnded = () => {
    _saveLog();
    if (_repeat === 'one') { audio.currentTime=0; _doPlay(); } else next();
  };
  const _onPlay  = () => { _started = Date.now(); _el('playIcon').className='fa-solid fa-pause'; };
  const _onPause = () => { if (_started) { _played += (Date.now()-_started)/1000; _started=null; } _el('playIcon').className='fa-solid fa-play'; };

  const _saveLog = () => {
    if (!_tid || _played < 1) return;
    const t = (Storage.get('tracks')||{})[_tid]; if (!t) return;
    Storage.addLog({ trackId:_tid, title:t.title, artist:t.artist, tags:t.tags||[], date:t.date||'', duration:_played, timestamp:Date.now() });
    _played = 0;
  };

  /* ── UI ── */
  const _updateShuffleBtn = () => _el('btnShuffle')?.classList.toggle('active', _shuffle);
  const _updateRepeatBtn  = () => {
    const btn = _el('btnRepeat'); if (!btn) return;
    btn.classList.toggle('active', _repeat !== 'none');
    btn.querySelector('i').className = _repeat==='one'?'fa-solid fa-repeat fa-xs':'fa-solid fa-repeat';
    btn.title = { none:'リピート', all:'全曲リピート', one:'1曲リピート' }[_repeat];
  };

  const _fmt  = (s) => { if(!s||isNaN(s)) return '0:00'; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`; };
  const _el   = (id) => document.getElementById(id);

  const getCurrentId = () => _tid;
  const isPlaying    = () => !audio.paused;
  const getAudio     = () => audio;

  return { init, play, togglePlay, prev, next, playAll, toggleShuffle, toggleRepeat, setVolume, toggleMute, setCtx, getCurrentId, isPlaying, getAudio };
})();
