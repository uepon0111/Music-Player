// ===== EDIT PAGE =====
function populateEditForm(track) {
  if (!track) return;

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('edit-title', track.title);
  setVal('edit-artist', track.artist);
  setVal('edit-album', track.album);
  setVal('edit-year', track.year);
  setVal('edit-convert-format', track.mimeType === 'audio/ogg' ? 'ogg' : track.mimeType === 'audio/wav' ? 'wav' : 'mp3');
  setVal('edit-volume', 100);
  setVal('edit-key', 0);
  setVal('edit-trim-start', '0');
  setVal('edit-trim-end', track.duration ? Math.floor(track.duration).toString() : '0');

  const volumeVal = document.getElementById('edit-volume-val');
  const keyVal = document.getElementById('edit-key-val');
  if (volumeVal) volumeVal.textContent = '100%';
  if (keyVal) keyVal.textContent = '0';

  // Artwork preview
  const artPreview = document.getElementById('edit-artwork-preview');
  if (artPreview) {
    if (track.artwork) {
      artPreview.innerHTML = `<img src="${track.artwork}" alt="">`;
    } else {
      artPreview.innerHTML = '';
    }
  }

  // Tags
  renderEditTags(track.tags || []);

  // Selector info
  const selectorTitle = document.getElementById('edit-selector-title');
  const selectorArtist = document.getElementById('edit-selector-artist');
  const selectorThumb = document.getElementById('edit-selector-thumb');
  if (selectorTitle) selectorTitle.textContent = track.title;
  if (selectorArtist) selectorArtist.textContent = track.artist || '不明なアーティスト';
  if (selectorThumb) {
    if (track.artwork) {
      selectorThumb.innerHTML = `<img src="${track.artwork}" alt="">`;
    } else {
      selectorThumb.innerHTML = icons.note.replace('28','22');
    }
  }

  // Draw waveform for trim
  drawEditWaveform(track);
}

async function drawEditWaveform(track) {
  const canvas = document.getElementById('trim-canvas');
  if (!canvas || !track.audioData) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(track.audioData.slice(0));
    canvas.width = canvas.offsetWidth || 600;
    canvas.height = 60;
    drawWaveform(canvas, buf, '#7c6af7');
    ctx.close();
    updateTrimOverlay(track.duration || 0);
  } catch(e) {}
}

function updateTrimOverlay(duration) {
  const start = parseFloat(document.getElementById('edit-trim-start')?.value || 0);
  const end = parseFloat(document.getElementById('edit-trim-end')?.value || duration);
  const overlay = document.getElementById('trim-range-overlay');
  const canvas = document.getElementById('trim-canvas');
  if (!overlay || !canvas || !duration) return;

  const pStart = (start / duration) * 100;
  const pEnd = (end / duration) * 100;
  overlay.style.left = pStart + '%';
  overlay.style.width = (pEnd - pStart) + '%';
}

// Edit tags UI
let editTags = [];

function renderEditTags(tags) {
  editTags = [...tags];
  const container = document.getElementById('edit-tags-list');
  if (!container) return;
  container.innerHTML = editTags.map((tag, i) => `
    <span class="tag-badge">
      ${escapeHtml(tag)}
      <button onclick="removeEditTag(${i})" title="削除">${icons.x}</button>
    </span>
  `).join('');
}

function removeEditTag(index) {
  editTags.splice(index, 1);
  renderEditTags(editTags);
}

function addEditTag() {
  const input = document.getElementById('tag-input');
  const val = input?.value.trim();
  if (val && !editTags.includes(val)) {
    editTags.push(val);
    renderEditTags(editTags);
    if (input) input.value = '';
  }
}

// Apply edits
async function applyEdits(overwrite = false) {
  const track = AppState.editingTrack;
  if (!track) return;

  const newData = {
    title: document.getElementById('edit-title')?.value || track.title,
    artist: document.getElementById('edit-artist')?.value || '',
    album: document.getElementById('edit-album')?.value || '',
    year: document.getElementById('edit-year')?.value || '',
    tags: editTags,
    artwork: null
  };

  // Artwork
  const artPreview = document.getElementById('edit-artwork-preview')?.querySelector('img');
  newData.artwork = artPreview?.src || track.artwork;

  let audioData = track.audioData;

  // Volume / Key / Trim processing (Web Audio API)
  const volume = parseFloat(document.getElementById('edit-volume')?.value || 100) / 100;
  const key = parseInt(document.getElementById('edit-key')?.value || 0);
  const trimStart = parseFloat(document.getElementById('edit-trim-start')?.value || 0);
  const trimEnd = parseFloat(document.getElementById('edit-trim-end')?.value || track.duration);
  const convertFormat = document.getElementById('edit-convert-format')?.value || 'mp3';

  const needsProcessing = volume !== 1 || key !== 0 || trimStart > 0 || trimEnd < track.duration;

  if (needsProcessing && audioData) {
    notify('音声を処理中...', 'info');
    try {
      audioData = await processAudio(audioData, { volume, key, trimStart, trimEnd });
    } catch(e) {
      notify('音声処理に失敗しました', 'error');
    }
  }

  if (overwrite) {
    Object.assign(track, newData);
    track.audioData = audioData;
    track.duration = trimEnd - trimStart;
    await dbPut(STORE_TRACKS, track);
    notify('上書き保存しました', 'success');
  } else {
    // Create new track
    const newTrack = {
      ...track,
      ...newData,
      id: generateId(),
      audioData,
      duration: needsProcessing ? trimEnd - trimStart : track.duration,
      addedAt: Date.now()
    };
    AppState.playlist.push(newTrack);
    await dbPut(STORE_TRACKS, newTrack);
    notify('別トラックとして追加しました', 'success');
  }

  if (AppState.googleUser) await saveDriveSettings();
  renderPlaylist();
  populateEditForm(AppState.editingTrack);
}

// Download processed audio
async function downloadProcessed() {
  const track = AppState.editingTrack;
  if (!track?.audioData) return;

  const format = document.getElementById('edit-convert-format')?.value || 'mp3';
  const volume = parseFloat(document.getElementById('edit-volume')?.value || 100) / 100;
  const key = parseInt(document.getElementById('edit-key')?.value || 0);
  const trimStart = parseFloat(document.getElementById('edit-trim-start')?.value || 0);
  const trimEnd = parseFloat(document.getElementById('edit-trim-end')?.value || track.duration);

  notify('ダウンロード準備中...', 'info');
  let audioData = track.audioData;

  const needsProcessing = volume !== 1 || key !== 0 || trimStart > 0 || trimEnd < track.duration;
  if (needsProcessing) {
    try {
      audioData = await processAudio(audioData, { volume, key, trimStart, trimEnd });
    } catch(e) {}
  }

  const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' };
  const mimeType = mimeMap[format] || 'audio/mpeg';
  const blob = new Blob([audioData], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${track.title}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

// Audio processing with Web Audio API
async function processAudio(audioData, options) {
  const { volume = 1, key = 0, trimStart = 0, trimEnd } = options;
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  const srcBuf = await actx.decodeAudioData(audioData.slice(0));

  const sampleRate = srcBuf.sampleRate;
  const startSample = Math.floor(trimStart * sampleRate);
  const endSample = Math.floor((trimEnd || srcBuf.duration) * sampleRate);
  const frameCount = endSample - startSample;

  const outBuf = actx.createBuffer(srcBuf.numberOfChannels, frameCount, sampleRate);

  for (let ch = 0; ch < srcBuf.numberOfChannels; ch++) {
    const srcData = srcBuf.getChannelData(ch);
    const outData = outBuf.getChannelData(ch);
    for (let i = 0; i < frameCount; i++) {
      outData[i] = (srcData[startSample + i] || 0) * volume;
    }
  }

  // Offline render (for pitch shift, we use a simple playback rate trick via offline context)
  const offlineCtx = new OfflineAudioContext(
    outBuf.numberOfChannels,
    key !== 0 ? Math.floor(outBuf.duration * Math.pow(2, -key/12) * sampleRate) : outBuf.length,
    sampleRate
  );

  const src = offlineCtx.createBufferSource();
  src.buffer = outBuf;
  if (key !== 0) {
    src.playbackRate.value = Math.pow(2, key / 12);
    src.detune.value = 0;
  }
  src.connect(offlineCtx.destination);
  src.start();

  const rendered = await offlineCtx.startRendering();
  actx.close();

  // Convert to WAV
  return audioBufferToWav(rendered);
}

function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numCh * 2;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, length, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }
  return arrayBuffer;
}

// ===== LOGS PAGE =====
let logCharts = {};

async function renderLogsPage() {
  const logs = await dbGetAll(STORE_LOGS);
  const tracks = AppState.playlist;

  // Compute stats
  const totalSeconds = logs.reduce((sum, l) => sum + (l.seconds || 0), 0);
  const totalTracks = new Set(logs.map(l => l.trackId)).size;
  const totalSessions = logs.length;

  document.getElementById('stat-total-time').textContent = formatPlaytime(totalSeconds);
  document.getElementById('stat-total-tracks').textContent = totalTracks;
  document.getElementById('stat-total-sessions').textContent = totalSessions;
  document.getElementById('stat-avg-session').textContent = totalSessions ? formatPlaytime(totalSeconds / totalSessions) : '0秒';

  // Get selected period filter
  const period = document.querySelector('.filter-chip.active[data-period]')?.dataset.period || 'month';
  const category = document.querySelector('.filter-chip.active[data-cat]')?.dataset.cat || 'total';

  renderOverallChart(logs, period);
  renderBreakdownChart(logs, tracks, category);
}

function getPeriodRange(period) {
  const now = Date.now();
  const day = 86400000;
  switch(period) {
    case 'hour': return { from: now - 3600000, step: 5*60*1000, count: 12, fmt: t => new Date(t).getHours()+':'+String(new Date(t).getMinutes()).padStart(2,'0') };
    case 'day': return { from: now - day, step: 3600000, count: 24, fmt: t => new Date(t).getHours()+'時' };
    case 'week': return { from: now - 7*day, step: day, count: 7, fmt: t => ['日','月','火','水','木','金','土'][new Date(t).getDay()] };
    case 'month': return { from: now - 30*day, step: day, count: 30, fmt: t => new Date(t).getDate()+'日' };
    case 'year': return { from: now - 365*day, step: 30*day, count: 12, fmt: t => (new Date(t).getMonth()+1)+'月' };
    default: return { from: now - 30*day, step: day, count: 30, fmt: t => new Date(t).getDate()+'日' };
  }
}

function renderOverallChart(logs, period) {
  const range = getPeriodRange(period);
  const buckets = Array.from({ length: range.count }, (_, i) => ({
    label: range.fmt(range.from + i * range.step),
    value: 0
  }));

  logs.forEach(log => {
    if (log.timestamp < range.from) return;
    const idx = Math.floor((log.timestamp - range.from) / range.step);
    if (idx >= 0 && idx < buckets.length) {
      buckets[idx].value += log.seconds || 0;
    }
  });

  const canvas = document.getElementById('chart-overall');
  if (!canvas) return;

  if (logCharts.overall) logCharts.overall.destroy();
  logCharts.overall = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: buckets.map(b => b.label),
      datasets: [{
        label: '再生時間（秒）',
        data: buckets.map(b => Math.round(b.value)),
        backgroundColor: 'rgba(124,106,247,0.6)',
        borderColor: '#7c6af7',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: '#9090b0', callback: v => formatPlaytime(v) },
          grid: { color: '#2a2a38' }
        },
        x: { ticks: { color: '#9090b0', maxRotation: 45 }, grid: { display: false } }
      }
    }
  });
}

function renderBreakdownChart(logs, tracks, category) {
  const trackMap = Object.fromEntries(tracks.map(t => [t.id, t]));
  const data = {};

  logs.forEach(log => {
    const track = trackMap[log.trackId];
    if (!track) return;
    let key;
    switch(category) {
      case 'artist': key = track.artist || '不明'; break;
      case 'tag': key = track.tags?.length ? track.tags[0] : 'タグなし'; break;
      case 'year': key = track.year || '年不明'; break;
      default: key = track.title; break;
    }
    data[key] = (data[key] || 0) + (log.seconds || 0);
  });

  const sorted = Object.entries(data).sort((a,b) => b[1]-a[1]).slice(0, 10);
  const canvas = document.getElementById('chart-breakdown');
  if (!canvas) return;

  const colors = ['#7c6af7','#3dd6c8','#c9a84c','#f06292','#64b5f6','#a5d6a7','#ffcc80','#ef9a9a','#ce93d8','#80cbc4'];

  if (logCharts.breakdown) logCharts.breakdown.destroy();
  logCharts.breakdown = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{
        data: sorted.map(([,v]) => Math.round(v)),
        backgroundColor: colors,
        borderColor: '#111118',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#9090b0', font: { size: 11 }, boxWidth: 12, padding: 10 }
        },
        tooltip: {
          callbacks: { label: ctx => `${ctx.label}: ${formatPlaytime(ctx.raw)}` }
        }
      }
    }
  });
}
