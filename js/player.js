// ===== AUDIO PLAYER ENGINE =====
const audio = new Audio();
let playStartTime = null;
let playStartSeconds = 0;
let currentPlaySeconds = 0;

audio.addEventListener('timeupdate', () => {
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  const fill = document.getElementById('progress-fill');
  const current = document.getElementById('time-current');
  if (fill) fill.style.width = pct + '%';
  if (current) current.textContent = formatTime(audio.currentTime);

  currentPlaySeconds = audio.currentTime - playStartSeconds;
});

audio.addEventListener('loadedmetadata', () => {
  const total = document.getElementById('time-total');
  if (total) total.textContent = formatTime(audio.duration);
  if (AppState.currentTrack) {
    const waveCanvas = document.getElementById('waveform-canvas');
    if (waveCanvas) drawPlayerWaveform();
  }
});

audio.addEventListener('ended', () => {
  onTrackEnd();
});

audio.addEventListener('play', () => {
  AppState.isPlaying = true;
  playStartTime = Date.now();
  playStartSeconds = audio.currentTime;
  updatePlayButton();
  updatePlaylistActiveState();
  updateHeroBg();
});

audio.addEventListener('pause', () => {
  AppState.isPlaying = false;
  updatePlayButton();
  const indicator = document.querySelector('.playlist-item.active .playing-indicator');
  if (indicator) indicator.parentElement.classList.add('paused');

  // Log play time
  if (AppState.currentTrack && currentPlaySeconds > 3) {
    logPlay(AppState.currentTrack.id, currentPlaySeconds);
    currentPlaySeconds = 0;
  }
});

function onTrackEnd() {
  if (AppState.currentTrack) {
    logPlay(AppState.currentTrack.id, currentPlaySeconds);
    currentPlaySeconds = 0;
  }

  switch (AppState.repeat) {
    case 'one':
      audio.currentTime = 0;
      audio.play();
      break;
    case 'all':
      playNext(true);
      break;
    default:
      if (AppState.currentIndex < AppState.playlist.length - 1) {
        playNext(true);
      } else {
        AppState.isPlaying = false;
        updatePlayButton();
      }
  }
}

async function loadTrack(index) {
  if (index < 0 || index >= AppState.playlist.length) return;
  AppState.currentIndex = index;
  const track = AppState.playlist[index];

  // If Drive-only track, fetch audio
  if (track.driveOnly && !track.audioData && track.driveFileId) {
    notify('Driveから読み込み中...', 'info');
    try {
      const blob = await fetchDriveFile(track.driveFileId);
      const arrayBuffer = await blob.arrayBuffer();
      track.audioData = arrayBuffer;
      track.driveOnly = false;
      await dbPut(STORE_TRACKS, track);
    } catch(e) {
      notify('Driveからの読み込みに失敗しました', 'error');
      return;
    }
  }

  if (!track.audioData) return;

  const blob = new Blob([track.audioData], { type: track.mimeType || 'audio/mpeg' });
  const url = URL.createObjectURL(blob);

  // Clean up previous object URL
  if (audio.src && audio.src.startsWith('blob:')) {
    URL.revokeObjectURL(audio.src);
  }

  audio.src = url;
  audio.volume = (document.getElementById('volume-slider')?.value ?? 80) / 100;

  updatePlayerUI(track);
  updatePlaylistActiveState();

  // Update media session
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist || '不明なアーティスト',
      album: track.album || '',
      artwork: track.artwork ? [{ src: track.artwork }] : []
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
    navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
  }

  // Update page title
  document.title = `${track.title} — MusicPortal`;
}

function updatePlayerUI(track) {
  // Bottom bar
  const title = document.getElementById('player-title');
  const artist = document.getElementById('player-artist');
  const thumb = document.getElementById('player-thumb');
  if (title) title.textContent = track.title;
  if (artist) artist.textContent = track.artist || '不明なアーティスト';
  if (thumb) {
    if (track.artwork) {
      thumb.innerHTML = `<img src="${track.artwork}" alt="">`;
    } else {
      thumb.innerHTML = icons.note;
    }
  }

  // Hero section
  const heroTitle = document.getElementById('hero-title');
  const heroArtist = document.getElementById('hero-artist');
  const heroAlbum = document.getElementById('hero-album');
  const heroArtwork = document.getElementById('hero-artwork');
  const heroTags = document.getElementById('hero-tags');

  if (heroTitle) heroTitle.textContent = track.title;
  if (heroArtist) heroArtist.textContent = track.artist || '不明なアーティスト';
  if (heroAlbum) heroAlbum.textContent = track.album || '';
  if (heroArtwork) {
    if (track.artwork) {
      heroArtwork.innerHTML = `<img src="${track.artwork}" alt="">`;
    } else {
      heroArtwork.innerHTML = icons.note;
    }
  }
  if (heroTags && track.tags) {
    heroTags.innerHTML = track.tags.map(t => `<span class="tag">${t}</span>`).join('');
  } else if (heroTags) {
    heroTags.innerHTML = '';
  }

  updateHeroBg();
}

function updateHeroBg() {
  const heroBg = document.getElementById('hero-bg');
  const track = AppState.currentTrack;
  if (heroBg && track?.artwork) {
    heroBg.style.backgroundImage = `url(${track.artwork})`;
    heroBg.classList.add('visible');
  } else if (heroBg) {
    heroBg.classList.remove('visible');
  }
}

function updatePlayButton() {
  const playBtn = document.getElementById('play-btn');
  if (playBtn) {
    playBtn.innerHTML = AppState.isPlaying ? icons.pause : icons.play;
  }
}

function updatePlaylistActiveState() {
  document.querySelectorAll('.playlist-item').forEach((el, i) => {
    el.classList.toggle('active', i === AppState.currentIndex);
    el.classList.remove('paused');
    const numEl = el.querySelector('.track-num');
    const indEl = el.querySelector('.playing-indicator');
    if (numEl) numEl.style.display = i === AppState.currentIndex ? 'none' : 'block';
    if (indEl) indEl.style.display = i === AppState.currentIndex ? 'flex' : 'none';
  });
}

async function playTrack(index) {
  await loadTrack(index);
  if (audio.src) {
    audio.play().catch(e => console.warn('Play failed:', e));
  }
}

function togglePlay() {
  if (!AppState.currentTrack) {
    if (AppState.playlist.length > 0) playTrack(0);
    return;
  }
  if (AppState.isPlaying) {
    audio.pause();
  } else {
    audio.play();
  }
}

function playNext(auto = false) {
  if (AppState.playlist.length === 0) return;
  if (AppState.shuffle) {
    const idx = Math.floor(Math.random() * AppState.playlist.length);
    playTrack(idx);
  } else {
    const next = (AppState.currentIndex + 1) % AppState.playlist.length;
    playTrack(next);
  }
}

function playPrev() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (AppState.shuffle) {
    const idx = Math.floor(Math.random() * AppState.playlist.length);
    playTrack(idx);
  } else {
    const prev = AppState.currentIndex <= 0
      ? AppState.playlist.length - 1
      : AppState.currentIndex - 1;
    playTrack(prev);
  }
}

function toggleShuffle() {
  AppState.shuffle = !AppState.shuffle;
  document.getElementById('btn-shuffle')?.classList.toggle('active', AppState.shuffle);
  saveSettings();
}

function toggleRepeat() {
  const modes = ['none', 'all', 'one'];
  const idx = modes.indexOf(AppState.repeat);
  AppState.repeat = modes[(idx + 1) % modes.length];
  const btn = document.getElementById('btn-repeat');
  if (btn) {
    btn.classList.toggle('active', AppState.repeat !== 'none');
    btn.innerHTML = AppState.repeat === 'one' ? icons.repeat1 : icons.repeat;
  }
  saveSettings();
}

function seekTo(e) {
  const bar = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  audio.currentTime = pct * audio.duration;
}

// ===== ADD TRACKS =====
async function addTrackFromFile(file, extraData = {}) {
  // Read metadata
  const meta = await readAudioMetadata(file);
  const duration = await getAudioDuration(file);
  const arrayBuffer = await fileToArrayBuffer(file);

  const track = {
    id: generateId(),
    title: meta.title,
    artist: meta.artist || '',
    album: meta.album || '',
    year: meta.year || '',
    tags: [],
    artwork: meta.artwork || null,
    duration,
    mimeType: file.type,
    fileName: file.name,
    audioData: arrayBuffer,
    addedAt: Date.now(),
    ...extraData
  };

  AppState.playlist.push(track);
  await dbPut(STORE_TRACKS, track);
  renderPlaylist();

  if (AppState.googleUser) {
    await saveDriveSettings();
  }

  return track;
}

async function addTracksFromFiles(files, extraData = {}) {
  for (const file of files) {
    if (!file.type.startsWith('audio/')) {
      notify(`${file.name} は音声ファイルではありません`, 'error');
      continue;
    }
    const track = await addTrackFromFile(file, extraData);
    notify(`「${track.title}」を追加しました`, 'success');
  }
}

async function removeTrack(trackId) {
  const idx = AppState.playlist.findIndex(t => t.id === trackId);
  if (idx === -1) return;

  const wasPlaying = AppState.currentIndex === idx;

  // Stop if playing
  if (wasPlaying) {
    audio.pause();
    audio.src = '';
    AppState.isPlaying = false;
    updatePlayButton();
  }

  AppState.playlist.splice(idx, 1);
  if (AppState.currentIndex >= idx && AppState.currentIndex > 0) {
    AppState.currentIndex--;
  }

  await dbDelete(STORE_TRACKS, trackId);
  renderPlaylist();
  notify('削除しました');

  if (AppState.googleUser) await saveDriveSettings();
}

// ===== PLAYLIST RENDERING =====
function renderPlaylist() {
  const container = document.getElementById('playlist');
  const sorted = sortPlaylist(AppState.playlist, AppState.sortMode);
  // Remap indices after sort
  AppState.playlist = sorted;

  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="playlist-empty">
        ${icons.note}
        <span>プレイリストは空です</span>
        <span>音声ファイルを追加してください</span>
      </div>`;
    return;
  }

  container.innerHTML = sorted.map((track, i) => `
    <div class="playlist-item ${i === AppState.currentIndex ? 'active' : ''}"
         data-id="${track.id}"
         data-index="${i}"
         draggable="true">
      <div class="track-num">${i + 1}</div>
      <div class="playing-indicator" style="display:${i === AppState.currentIndex ? 'flex' : 'none'}">
        <div class="playing-bar">
          <span></span><span></span><span></span>
        </div>
      </div>
      <div class="track-thumb">
        ${track.artwork
          ? `<img src="${track.artwork}" alt="" loading="lazy">`
          : icons.note.replace('width="28"','width="16"').replace('height="28"','height="16"')
        }
      </div>
      <div class="track-info">
        <div class="track-title">${escapeHtml(track.title)}</div>
        <div class="track-artist">${escapeHtml(track.artist || '不明なアーティスト')}</div>
      </div>
      <div class="track-duration">${formatDuration(track.duration)}</div>
      <div class="item-actions">
        <button class="btn-icon" onclick="event.stopPropagation();openEditModal('${track.id}')" title="編集">
          ${icons.edit}
        </button>
        <button class="btn-icon" onclick="event.stopPropagation();removeTrack('${track.id}')" title="削除">
          ${icons.trash}
        </button>
      </div>
    </div>
  `).join('');

  // Click to play
  container.querySelectorAll('.playlist-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index);
      playTrack(idx);
      if (window.innerWidth <= 768) closeMobileSidebar();
    });

    // Drag & drop reorder
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    el.addEventListener('dragend', onDragEnd);

    // Context menu
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      showContextMenu(e, el.dataset.id);
    });
  });
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== DRAG & DROP REORDER =====
let dragSrcIndex = -1;

function onDragStart(e) {
  dragSrcIndex = parseInt(e.currentTarget.dataset.index);
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  const targetIndex = parseInt(e.currentTarget.dataset.index);
  if (dragSrcIndex === targetIndex) return;

  const moved = AppState.playlist.splice(dragSrcIndex, 1)[0];
  AppState.playlist.splice(targetIndex, 0, moved);

  // Update current index
  if (AppState.currentIndex === dragSrcIndex) {
    AppState.currentIndex = targetIndex;
  } else if (dragSrcIndex < AppState.currentIndex && targetIndex >= AppState.currentIndex) {
    AppState.currentIndex--;
  } else if (dragSrcIndex > AppState.currentIndex && targetIndex <= AppState.currentIndex) {
    AppState.currentIndex++;
  }

  renderPlaylist();
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('drag-over'));
}

// ===== CONTEXT MENU =====
let contextMenu = null;

function showContextMenu(e, trackId) {
  if (!contextMenu) {
    contextMenu = document.getElementById('context-menu');
  }
  const track = AppState.playlist.find(t => t.id === trackId);
  if (!track) return;

  contextMenu.innerHTML = `
    <div class="context-item" onclick="playTrack(${AppState.playlist.indexOf(track)});hideContextMenu()">
      ${icons.play} 再生
    </div>
    <div class="context-item" onclick="openEditModal('${trackId}');hideContextMenu()">
      ${icons.edit} 編集
    </div>
    <div class="context-divider"></div>
    <div class="context-item danger" onclick="removeTrack('${trackId}');hideContextMenu()">
      ${icons.trash} 削除
    </div>
  `;

  contextMenu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  contextMenu.style.top = Math.min(e.clientY, window.innerHeight - 120) + 'px';
  contextMenu.classList.add('visible');
}

function hideContextMenu() {
  if (contextMenu) contextMenu.classList.remove('visible');
}

// ===== WAVEFORM =====
async function drawPlayerWaveform() {
  const canvas = document.getElementById('waveform-canvas');
  if (!canvas || !AppState.currentTrack?.audioData) return;

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(AppState.currentTrack.audioData.slice(0));
    canvas.width = canvas.offsetWidth || 800;
    canvas.height = canvas.offsetHeight || 48;
    drawWaveform(canvas, buf, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    ctx.close();
  } catch(e) {}
}

function openEditModal(trackId) {
  const track = AppState.playlist.find(t => t.id === trackId);
  if (!track) return;
  AppState.editingTrack = track;
  navigateTo('edit');
  populateEditForm(track);
}
