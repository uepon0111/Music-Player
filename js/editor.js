/**
 * editor.js - 音声編集モジュール
 * Web Audio API + OfflineAudioContext でブラウザ内処理
 */

const Editor = (() => {
  let _currentTrackId = null;
  let _audioBuffer = null;
  let _audioContext = null;
  let _previewSource = null;
  let _previewStartTime = 0;
  let _previewOffset = 0;
  let _previewInterval = null;
  let _tags = [];
  let _thumbnailData = null;
  let _driveDoc = null;
  let _ffmpegLoaded = false;

  const _getAudioContext = () => {
    if (!_audioContext || _audioContext.state === 'closed') {
      _audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return _audioContext;
  };

  // ============================================================
  // 初期化
  // ============================================================
  const init = () => {
    // タグ入力
    _initTagsInput('metaTagsInput', 'metaTagsDisplay');

    // エディタータブ切替
    document.querySelectorAll('.editor-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.editor-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab)?.classList.add('active');
      });
    });

    refreshSelect();
    _checkFFmpeg();
  };

  const _checkFFmpeg = () => {
    const statusEl = document.getElementById('ffmpegStatus');
    // FFmpeg.wasm は重いため、変換タブを開いたときに遅延ロード
    if (statusEl) {
      statusEl.textContent = '変換タブを開くとFFmpegが読み込まれます';
      statusEl.className = 'ffmpeg-status';
    }
  };

  const _loadFFmpeg = async () => {
    if (_ffmpegLoaded) return true;
    const statusEl = document.getElementById('ffmpegStatus');
    if (statusEl) { statusEl.textContent = 'FFmpegを読み込み中...'; statusEl.className = 'ffmpeg-status'; }
    try {
      // FFmpeg.wasm CDN
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/ffmpeg/0.12.6/ffmpeg.min.js';
      await new Promise((res, rej) => { script.onload = res; script.onerror = rej; document.head.appendChild(script); });

      const coreScript = document.createElement('script');
      coreScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/ffmpeg/0.12.6/core.min.js';
      await new Promise((res, rej) => { coreScript.onload = res; coreScript.onerror = rej; document.head.appendChild(coreScript); });

      if (typeof FFmpeg !== 'undefined') {
        _ffmpegLoaded = true;
        if (statusEl) { statusEl.textContent = 'FFmpeg 準備完了'; statusEl.className = 'ffmpeg-status ready'; }
        return true;
      }
    } catch(e) {
      console.warn('FFmpeg読み込み失敗:', e);
    }
    if (statusEl) {
      statusEl.textContent = 'FFmpegの読み込みに失敗しました。ブラウザの変換機能を使用します。';
      statusEl.className = 'ffmpeg-status error';
    }
    return false;
  };

  // ============================================================
  // トラック選択
  // ============================================================
  const refreshSelect = () => {
    const sel = document.getElementById('editorTrackSelect');
    if (!sel) return;
    const data = Storage.get();
    const tracks = Object.values(data.tracks || {});
    sel.innerHTML = '<option value="">-- ファイルを選択 --</option>';
    tracks.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.title || t.fileName || t.id;
      sel.appendChild(opt);
    });
    if (_currentTrackId) sel.value = _currentTrackId;
  };

  const updateTrackSelect = (trackId) => {
    const sel = document.getElementById('editorTrackSelect');
    if (sel && sel.value !== trackId) {
      sel.value = trackId;
      // エディターページが表示中なら自動ロード
      if (document.getElementById('page-editor')?.classList.contains('active')) {
        loadTrack(trackId);
      }
    }
  };

  const openForTrack = (trackId) => {
    UI.switchPage('editor');
    setTimeout(() => loadTrack(trackId), 100);
  };

  const loadTrack = async (trackId) => {
    if (!trackId) {
      document.getElementById('editorMain')?.classList.add('hidden');
      return;
    }
    _currentTrackId = trackId;
    const data = Storage.get();
    const track = data.tracks[trackId];
    if (!track) return;

    document.getElementById('editorMain')?.classList.remove('hidden');

    // メタデータ入力を埋める
    document.getElementById('metaTitle').value = track.title || '';
    document.getElementById('metaArtist').value = track.artist || '';
    document.getElementById('metaAlbum').value = track.album || '';
    document.getElementById('metaYear').value = track.year || '';
    document.getElementById('metaGenre').value = track.genre || '';

    // タグ
    _tags = [...(track.tags || [])];
    _renderTags('tagsDisplay', _tags);
    document.getElementById('tagsInput').value = '';

    // サムネイル
    _thumbnailData = track.thumbnailBase64 || null;
    _updateThumbPreview('thumbPreview', 'thumbPreviewImg', _thumbnailData);

    // トリム値をリセット
    document.getElementById('trimStartVal').value = '0';
    document.getElementById('audioVolume').value = 100;
    document.getElementById('audioKey').value = 0;
    document.getElementById('audioTempo').value = 100;
    document.getElementById('volumeVal').textContent = '100';
    document.getElementById('keyVal').textContent = '0';
    document.getElementById('tempoVal').textContent = '100';

    // 波形描画
    await _loadAudioBuffer(track);
    if (track.duration) {
      document.getElementById('trimEndVal').value = track.duration.toFixed(1);
      _updateTrimRegion();
    }
  };

  const _loadAudioBuffer = async (track) => {
    try {
      let blob;
      if (track.source === 'gdrive' && Auth.isLoggedIn()) {
        blob = await GDrive.downloadFile(track.driveFileId);
      } else {
        blob = Storage.getAudioBlob(track.id);
      }
      if (!blob) return;

      const ctx = _getAudioContext();
      const arrayBuffer = await blob.arrayBuffer();
      _audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      document.getElementById('trimEndVal').value = _audioBuffer.duration.toFixed(1);
      _drawWaveform(_audioBuffer);
      document.getElementById('editorPreviewTime').textContent = `0:00 / ${_fmtTime(_audioBuffer.duration)}`;
      _updateTrimRegion();
    } catch(e) {
      console.warn('AudioBuffer読み込みエラー:', e);
    }
  };

  // ============================================================
  // 波形描画
  // ============================================================
  const _drawWaveform = (buffer) => {
    const canvas = document.getElementById('waveformCanvas');
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    const W = canvas.parentElement.offsetWidth;
    const H = canvas.parentElement.offsetHeight;
    canvas.width = W;
    canvas.height = H;

    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / W);
    const amp = H / 2;

    ctx2d.clearRect(0, 0, W, H);
    ctx2d.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || '#f7f7f9';
    ctx2d.fillRect(0, 0, W, H);
    ctx2d.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b5ef6';
    ctx2d.lineWidth = 1;

    for (let i = 0; i < W; i++) {
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step; j++) {
        const val = data[i * step + j] || 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }
      ctx2d.beginPath();
      ctx2d.moveTo(i, (1 + min) * amp);
      ctx2d.lineTo(i, (1 + max) * amp);
      ctx2d.stroke();
    }
  };

  // ============================================================
  // トリム領域
  // ============================================================
  const updateTrimRegion = () => {
    if (!_audioBuffer) return;
    const duration = _audioBuffer.duration;
    const start = parseFloat(document.getElementById('trimStartVal').value) || 0;
    const end = parseFloat(document.getElementById('trimEndVal').value) || duration;
    const canvas = document.getElementById('waveformCanvas');
    if (!canvas) return;
    const W = canvas.width;
    const startPct = (start / duration) * 100;
    const widthPct = ((end - start) / duration) * 100;
    const region = document.getElementById('trimRegion');
    region.style.left = startPct + '%';
    region.style.width = Math.max(0, widthPct) + '%';
  };

  // ============================================================
  // プレビュー再生
  // ============================================================
  const previewPlay = () => {
    if (!_audioBuffer) { UI.toast('音声データが読み込まれていません', 'warning'); return; }
    previewStop();

    const ctx = _getAudioContext();
    _previewSource = ctx.createBufferSource();
    _previewSource.buffer = _audioBuffer;

    // Volume
    const gainNode = ctx.createGain();
    gainNode.gain.value = (parseFloat(document.getElementById('audioVolume').value) || 100) / 100;

    _previewSource.connect(gainNode);
    gainNode.connect(ctx.destination);

    const start = parseFloat(document.getElementById('trimStartVal').value) || 0;
    const end = parseFloat(document.getElementById('trimEndVal').value) || _audioBuffer.duration;
    _previewOffset = start;
    _previewStartTime = ctx.currentTime;

    _previewSource.start(0, start, end - start);
    _previewSource.onended = previewStop;

    _previewInterval = setInterval(() => {
      const elapsed = ctx.currentTime - _previewStartTime;
      const current = _previewOffset + elapsed;
      document.getElementById('editorPreviewTime').textContent =
        `${_fmtTime(current)} / ${_fmtTime(_audioBuffer.duration)}`;
    }, 200);
  };

  const previewStop = () => {
    try { _previewSource?.stop(); } catch(e) {}
    _previewSource = null;
    if (_previewInterval) { clearInterval(_previewInterval); _previewInterval = null; }
  };

  const updatePreview = () => {
    // リアルタイムプレビューが再生中なら再起動
    if (_previewSource) { previewPlay(); }
  };

  // ============================================================
  // タグ入力
  // ============================================================
  const _initTagsInput = (inputId, displayId) => {
    const input = document.getElementById('tagsInput');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = input.value.trim().replace(/,/g,'');
        if (val && !_tags.includes(val)) {
          _tags.push(val);
          _renderTags('tagsDisplay', _tags);
        }
        input.value = '';
      }
      if (e.key === 'Backspace' && !input.value && _tags.length) {
        _tags.pop();
        _renderTags('tagsDisplay', _tags);
      }
    });
  };

  const _renderTags = (containerId, tags) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    tags.forEach((tag, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `${_esc(tag)}<button class="tag-chip-remove" onclick="App.editor.removeTag(${i})"><i class="fa-solid fa-xmark"></i></button>`;
      container.appendChild(chip);
    });
  };

  const removeTag = (index) => {
    _tags.splice(index, 1);
    _renderTags('tagsDisplay', _tags);
  };

  // ============================================================
  // サムネイル
  // ============================================================
  const setThumbnail = (input) => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      _thumbnailData = e.target.result;
      _updateThumbPreview('thumbPreview', 'thumbPreviewImg', _thumbnailData);
    };
    reader.readAsDataURL(file);
    input.value = '';
  };

  const clearThumbnail = () => {
    _thumbnailData = null;
    _updateThumbPreview('thumbPreview', 'thumbPreviewImg', null);
  };

  const _updateThumbPreview = (previewId, imgId, data) => {
    const preview = document.getElementById(previewId);
    const img = document.getElementById(imgId);
    const icon = preview?.querySelector('.thumb-icon');
    if (data) {
      img.src = data;
      img.classList.remove('hidden');
      icon?.classList.add('hidden');
    } else {
      img.src = '';
      img.classList.add('hidden');
      icon?.classList.remove('hidden');
    }
  };

  // ============================================================
  // 適用（保存）
  // ============================================================
  const apply = async () => {
    if (!_currentTrackId) { UI.toast('編集するファイルが選択されていません', 'warning'); return; }

    const saveMode = document.querySelector('input[name="saveMode"]:checked')?.value || 'new';
    UI.showProcessing('処理中...');

    try {
      // メタデータ更新
      const updates = {
        title: document.getElementById('metaTitle').value.trim(),
        artist: document.getElementById('metaArtist').value.trim(),
        album: document.getElementById('metaAlbum').value.trim(),
        year: parseInt(document.getElementById('metaYear').value) || null,
        genre: document.getElementById('metaGenre').value.trim(),
        tags: [..._tags],
        thumbnailBase64: _thumbnailData
      };

      // 音声加工が必要か確認
      const vol = parseFloat(document.getElementById('audioVolume').value);
      const key = parseInt(document.getElementById('audioKey').value);
      const tempo = parseFloat(document.getElementById('audioTempo').value);
      const trimStart = parseFloat(document.getElementById('trimStartVal').value) || 0;
      const trimEnd = parseFloat(document.getElementById('trimEndVal').value) || (_audioBuffer?.duration || 0);
      const needsAudioProcess = vol !== 100 || key !== 0 || tempo !== 100 ||
        trimStart > 0 || (trimEnd < (_audioBuffer?.duration - 0.1));

      if (saveMode === 'overwrite') {
        Storage.updateTrack(_currentTrackId, updates);
        if (needsAudioProcess && _audioBuffer) {
          const newBlob = await _processAudio(_audioBuffer, { vol, key, tempo, trimStart, trimEnd });
          if (newBlob) await Storage.saveAudioBlob(_currentTrackId, newBlob);
        }
        UI.toast('上書き保存しました', 'success');
        App.playlists.renderTrackList();
      } else {
        // 新規トラックとして追加
        const id = Storage.generateId();
        const data = Storage.get();
        const original = data.tracks[_currentTrackId];
        const newTrack = {
          ...original, ...updates, id,
          addedAt: Date.now(),
          title: updates.title + (saveMode === 'new' ? '' : ' (コピー)')
        };
        Storage.addTrack(newTrack);

        if (needsAudioProcess && _audioBuffer) {
          const newBlob = await _processAudio(_audioBuffer, { vol, key, tempo, trimStart, trimEnd });
          if (newBlob) await Storage.saveAudioBlob(id, newBlob);
        } else {
          const origBlob = Storage.getAudioBlob(_currentTrackId);
          if (origBlob) await Storage.saveAudioBlob(id, origBlob);
        }

        // 同じプレイリストに追加
        const activePl = data.settings.activePlaylistId;
        App.playlists.addTrackToPlaylist(id, activePl);
        UI.toast('新規トラックとして追加しました', 'success');
      }
    } catch(e) {
      console.error(e);
      UI.toast('処理に失敗しました: ' + e.message, 'error');
    } finally {
      UI.hideProcessing();
      refreshSelect();
      App.playlists.renderTrackList();
    }
  };

  // ============================================================
  // ダウンロード
  // ============================================================
  const download = async () => {
    if (!_audioBuffer) { UI.toast('音声データが読み込まれていません', 'warning'); return; }
    UI.showProcessing('ダウンロードを準備中...');
    try {
      const vol = parseFloat(document.getElementById('audioVolume').value);
      const key = parseInt(document.getElementById('audioKey').value);
      const tempo = parseFloat(document.getElementById('audioTempo').value);
      const trimStart = parseFloat(document.getElementById('trimStartVal').value) || 0;
      const trimEnd = parseFloat(document.getElementById('trimEndVal').value) || _audioBuffer.duration;
      const format = document.getElementById('convertFormat').value;

      let blob;
      if (vol !== 100 || key !== 0 || tempo !== 100 || trimStart > 0 || trimEnd < _audioBuffer.duration - 0.1) {
        blob = await _processAudio(_audioBuffer, { vol, key, tempo, trimStart, trimEnd, format });
      } else {
        // 元ファイルをそのままダウンロード
        const data = Storage.get();
        const track = data.tracks[_currentTrackId];
        if (track?.source === 'gdrive') {
          blob = await GDrive.downloadFile(track.driveFileId);
        } else {
          blob = Storage.getAudioBlob(_currentTrackId);
        }
      }

      if (!blob) { UI.toast('ダウンロードに失敗しました', 'error'); return; }

      const title = document.getElementById('metaTitle').value || 'audio';
      const ext = format || _getMimeExt(blob.type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      UI.toast('ダウンロードを開始しました', 'success');
    } catch(e) {
      UI.toast('ダウンロードに失敗しました: ' + e.message, 'error');
    } finally {
      UI.hideProcessing();
    }
  };

  // ============================================================
  // 音声処理 (Web Audio API)
  // ============================================================
  const _processAudio = async (buffer, { vol=100, key=0, tempo=100, trimStart=0, trimEnd=null, format='wav' }) => {
    const end = trimEnd ?? buffer.duration;
    const duration = end - trimStart;
    if (duration <= 0) throw new Error('無効なトリム範囲です');

    // OfflineAudioContext でレンダリング
    const sampleRate = buffer.sampleRate;
    const frames = Math.ceil(duration * sampleRate);
    const offCtx = new OfflineAudioContext(buffer.numberOfChannels, frames, sampleRate);

    const src = offCtx.createBufferSource();

    // ピッチシフト (detune は半音 * 100セント)
    src.detune.value = key * 100;
    // テンポ変更 (playbackRate)
    src.playbackRate.value = tempo / 100;

    src.buffer = buffer;

    const gain = offCtx.createGain();
    gain.gain.value = vol / 100;

    src.connect(gain);
    gain.connect(offCtx.destination);
    src.start(0, trimStart, duration);

    const rendered = await offCtx.startRendering();

    // WAVエンコード
    const wav = _encodeWAV(rendered);
    return new Blob([wav], { type: 'audio/wav' });
  };

  const _encodeWAV = (buffer) => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitsPerSample = 16;
    const channels = [];
    for (let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i));
    const interleaved = _interleave(channels);
    const dataLength = interleaved.length * 2;
    const arrayBuffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(arrayBuffer);
    _writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    _writeString(view, 8, 'WAVE');
    _writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    _writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);
    let offset = 44;
    for (let i = 0; i < interleaved.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, interleaved[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return arrayBuffer;
  };

  const _interleave = (channels) => {
    const length = channels[0].length * channels.length;
    const result = new Float32Array(length);
    let offset = 0;
    for (let i = 0; i < channels[0].length; i++) {
      for (let ch = 0; ch < channels.length; ch++) {
        result[offset++] = channels[ch][i];
      }
    }
    return result;
  };

  const _writeString = (view, offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  const _getMimeExt = (mime) => {
    const map = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/flac': 'flac' };
    return map[mime] || 'wav';
  };

  const _fmtTime = (s) => {
    if (!s) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2,'0')}`;
  };
  const _esc = (str) => (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  return {
    init, refreshSelect, updateTrackSelect, openForTrack, loadTrack,
    updateTrimRegion, previewPlay, previewStop, updatePreview,
    removeTag, setThumbnail, clearThumbnail, apply, download
  };
})();
