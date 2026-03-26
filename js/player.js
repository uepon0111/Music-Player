/**
 * player.js - 音声再生エンジン
 */

const Player = (() => {
  const audio = new Audio();
  let _currentTrackId = null;
  let _currentPlaylistId = null;
  let _shuffle = false;
  let _repeat = 'none'; // 'none' | 'all' | 'one'
  let _isSeeking = false;
  let _playbackStarted = null; // 再生開始時刻
  let _totalPlayed = 0;        // 今のトラックの累計再生秒数
  let _driveStreamUrl = null;

  // ============================================================
  // 初期化
  // ============================================================
  const init = () => {
    const data = Storage.get();
    _shuffle = data.settings.shuffle || false;
    _repeat = data.settings.repeat || 'none';
    const vol = data.settings.volume ?? 80;
    audio.volume = vol / 100;

    document.getElementById('volumeSlider').value = vol;
    document.getElementById('volValue').textContent = vol + '%';
    _updateShuffleBtn();
    _updateRepeatBtn();

    // イベントリスナー
    audio.addEventListener('timeupdate', _onTimeUpdate);
    audio.addEventListener('ended', _onEnded);
    audio.addEventListener('loadedmetadata', _onLoadedMetadata);
    audio.addEventListener('error', _onError);
    audio.addEventListener('play', _onPlay);
    audio.addEventListener('pause', _onPause);

    // シーク
    const progressContainer = document.getElementById('progressContainer');
    progressContainer.addEventListener('mousedown', _startSeek);
    progressContainer.addEventListener('touchstart', _startSeekTouch, { passive: true });

    // メディアセッション API
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => _play());
      navigator.mediaSession.setActionHandler('pause', () => _pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => next());
    }

    // 前回の曲を復元
    const activeId = data.settings.activeTrackId;
    _currentPlaylistId = data.settings.activePlaylistId || 'default';
    if (activeId && data.tracks[activeId]) {
      _loadTrack(activeId, false);
    }
  };

  // ============================================================
  // トラック読み込み
  // ============================================================
  const _loadTrack = async (trackId, autoPlay = true) => {
    const data = Storage.get();
    const track = data.tracks[trackId];
    if (!track) return;

    // 前のトラックのログ保存
    if (_currentTrackId && _playbackStarted) _saveLog();

    _currentTrackId = trackId;
    _totalPlayed = 0;
    _playbackStarted = null;

    // UIを先に更新
    _updateNowPlaying(track);

    // Audio source設定
    if (track.source === 'gdrive') {
      if (Auth.isLoggedIn()) {
        _driveStreamUrl = GDrive.getStreamUrl(track.driveFileId);
        audio.src = _driveStreamUrl;
      } else {
        UI.toast('Google Driveのファイルを再生するにはログインが必要です', 'warning');
        return;
      }
    } else {
      const blob = Storage.getAudioBlob(trackId);
      if (blob) {
        audio.src = URL.createObjectURL(blob);
      } else {
        UI.toast('音声データが見つかりません', 'error');
        return;
      }
    }

    // 設定保存
    data.settings.activeTrackId = trackId;
    Storage.set('settings', data.settings);

    // トラックリストのアクティブ状態を更新
    App.playlists.updateActiveTrack(trackId);

    // エディターのセレクトを更新
    App.editor.updateTrackSelect(trackId);

    if (autoPlay) {
      try {
        await audio.play();
      } catch(e) { console.warn('自動再生がブロックされました:', e); }
    }
  };

  const _updateNowPlaying = (track) => {
    document.getElementById('trackTitle').textContent = track.title || '不明なタイトル';
    document.getElementById('trackArtist').textContent = track.artist || '不明なアーティスト';
    document.getElementById('trackAlbum').textContent = track.album || '不明なアルバム';

    // サムネイル
    const artImg = document.getElementById('albumArtImg');
    const artIcon = document.querySelector('.album-art-icon');
    if (track.thumbnailBase64) {
      artImg.src = track.thumbnailBase64;
      artImg.classList.remove('hidden');
      artIcon?.classList.add('hidden');
    } else {
      artImg.src = '';
      artImg.classList.add('hidden');
      artIcon?.classList.remove('hidden');
    }

    // メディアセッション
    if ('mediaSession' in navigator) {
      const artwork = track.thumbnailBase64
        ? [{ src: track.thumbnailBase64, sizes: '512x512', type: 'image/jpeg' }]
        : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '不明',
        artist: track.artist || '不明',
        album: track.album || '不明',
        artwork
      });
    }
  };

  // ============================================================
  // 再生コントロール
  // ============================================================
  const play = (trackId) => {
    if (trackId) _loadTrack(trackId);
    else if (_currentTrackId) _play();
    else _playFirst();
  };

  const _play = async () => {
    try {
      await audio.play();
    } catch(e) { console.warn('再生エラー:', e); }
  };

  const _pause = () => audio.pause();

  const togglePlay = () => {
    if (audio.paused) _play();
    else _pause();
  };

  const prev = () => {
    // 3秒以上再生していたら先頭に戻る
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const ids = _getPlaylistTrackIds();
    const idx = ids.indexOf(_currentTrackId);
    if (idx <= 0) {
      if (_repeat === 'all') _loadTrack(ids[ids.length - 1]);
      else audio.currentTime = 0;
    } else {
      _loadTrack(ids[idx - 1]);
    }
  };

  const next = () => {
    const ids = _getPlaylistTrackIds();
    if (!ids.length) return;

    if (_shuffle) {
      const others = ids.filter(id => id !== _currentTrackId);
      if (others.length) _loadTrack(others[Math.floor(Math.random() * others.length)]);
      else if (_repeat === 'all') _loadTrack(ids[Math.floor(Math.random() * ids.length)]);
    } else {
      const idx = ids.indexOf(_currentTrackId);
      if (idx === -1 || idx >= ids.length - 1) {
        if (_repeat === 'all') _loadTrack(ids[0]);
        else _pause();
      } else {
        _loadTrack(ids[idx + 1]);
      }
    }
  };

  const _playFirst = () => {
    const ids = _getPlaylistTrackIds();
    if (ids.length) _loadTrack(ids[0]);
  };

  const _getPlaylistTrackIds = () => {
    const data = Storage.get();
    const pl = data.playlists.find(p => p.id === _currentPlaylistId);
    return pl ? pl.trackIds : [];
  };

  const toggleShuffle = () => {
    _shuffle = !_shuffle;
    const data = Storage.get();
    data.settings.shuffle = _shuffle;
    Storage.set('settings', data.settings);
    _updateShuffleBtn();
    UI.toast(_shuffle ? 'シャッフルON' : 'シャッフルOFF');
  };

  const toggleRepeat = () => {
    const modes = ['none', 'all', 'one'];
    const idx = modes.indexOf(_repeat);
    _repeat = modes[(idx + 1) % modes.length];
    const data = Storage.get();
    data.settings.repeat = _repeat;
    Storage.set('settings', data.settings);
    _updateRepeatBtn();
    const labels = { none: 'リピートOFF', all: '全曲リピート', one: '1曲リピート' };
    UI.toast(labels[_repeat]);
  };

  const setVolume = (val) => {
    const v = parseInt(val);
    audio.volume = v / 100;
    document.getElementById('volValue').textContent = v + '%';
    const icon = document.getElementById('volIcon');
    if (v === 0) icon.className = 'fa-solid fa-volume-xmark vol-icon';
    else if (v < 50) icon.className = 'fa-solid fa-volume-low vol-icon';
    else icon.className = 'fa-solid fa-volume-high vol-icon';
    const data = Storage.get();
    data.settings.volume = v;
    Storage.set('settings', data.settings);
  };

  const toggleMute = () => {
    audio.muted = !audio.muted;
    const icon = document.getElementById('volIcon');
    icon.className = audio.muted ? 'fa-solid fa-volume-xmark vol-icon' : 'fa-solid fa-volume-high vol-icon';
  };

  // ============================================================
  // シーク
  // ============================================================
  const _startSeek = (e) => {
    _isSeeking = true;
    _doSeek(e);
    const onMove = (e) => _doSeek(e);
    const onUp = () => { _isSeeking = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const _startSeekTouch = (e) => {
    _isSeeking = true;
    _doSeekTouch(e);
    const onMove = (e) => _doSeekTouch(e);
    const onEnd = () => { _isSeeking = false; window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onEnd); };
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onEnd);
  };

  const _doSeek = (e) => {
    const container = document.getElementById('progressContainer');
    const rect = container.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audio.duration) audio.currentTime = ratio * audio.duration;
  };

  const _doSeekTouch = (e) => {
    if (!e.touches.length) return;
    const container = document.getElementById('progressContainer');
    const rect = container.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    if (audio.duration) audio.currentTime = ratio * audio.duration;
  };

  // ============================================================
  // イベント
  // ============================================================
  const _onTimeUpdate = () => {
    if (_isSeeking || !audio.duration) return;
    const ratio = audio.currentTime / audio.duration;
    document.getElementById('progressBar').style.width = (ratio * 100) + '%';
    const handle = document.getElementById('progressHandle');
    handle.style.left = (ratio * 100) + '%';
    document.getElementById('currentTime').textContent = _formatTime(audio.currentTime);
  };

  const _onLoadedMetadata = () => {
    document.getElementById('totalTime').textContent = _formatTime(audio.duration);
    // Durationを保存
    if (_currentTrackId) {
      Storage.updateTrack(_currentTrackId, { duration: audio.duration });
      App.playlists.updateTrackDuration(_currentTrackId, audio.duration);
    }
  };

  const _onEnded = () => {
    _saveLog();
    if (_repeat === 'one') {
      audio.currentTime = 0;
      _play();
    } else {
      next();
    }
  };

  const _onError = (e) => {
    console.error('Audio error:', e);
    UI.toast('再生エラーが発生しました', 'error');
  };

  const _onPlay = () => {
    _playbackStarted = Date.now();
    document.getElementById('playIcon').className = 'fa-solid fa-pause';
  };

  const _onPause = () => {
    if (_playbackStarted) {
      _totalPlayed += (Date.now() - _playbackStarted) / 1000;
      _playbackStarted = null;
    }
    document.getElementById('playIcon').className = 'fa-solid fa-play';
  };

  // ============================================================
  // ログ保存
  // ============================================================
  const _saveLog = () => {
    if (!_currentTrackId || _totalPlayed < 1) return;
    const data = Storage.get();
    const track = data.tracks[_currentTrackId];
    if (!track) return;
    Storage.addLog({
      trackId: _currentTrackId,
      title: track.title,
      artist: track.artist,
      tags: track.tags || [],
      year: track.year,
      duration: _totalPlayed,
      timestamp: Date.now()
    });
    _totalPlayed = 0;
  };

  // ============================================================
  // UI 更新
  // ============================================================
  const _updateShuffleBtn = () => {
    const btn = document.getElementById('btnShuffle');
    btn?.classList.toggle('active', _shuffle);
  };

  const _updateRepeatBtn = () => {
    const btn = document.getElementById('btnRepeat');
    if (!btn) return;
    btn.classList.toggle('active', _repeat !== 'none');
    const icon = btn.querySelector('i');
    if (_repeat === 'one') icon.className = 'fa-solid fa-repeat fa-xs';
    else icon.className = 'fa-solid fa-repeat';
  };

  const setPlaylist = (playlistId) => {
    _currentPlaylistId = playlistId;
    const data = Storage.get();
    data.settings.activePlaylistId = playlistId;
    Storage.set('settings', data.settings);
  };

  // ============================================================
  // Helpers
  // ============================================================
  const _formatTime = (s) => {
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const getCurrentTrackId = () => _currentTrackId;
  const getAudio = () => audio;
  const isPlaying = () => !audio.paused;

  return {
    init, play, togglePlay, prev, next,
    toggleShuffle, toggleRepeat, setVolume, toggleMute,
    setPlaylist, getCurrentTrackId, getAudio, isPlaying
  };
})();
