// ===== GOOGLE DRIVE MODULE =====
// IMPORTANT: Replace with your own Google OAuth2 Client ID
// Create one at: https://console.cloud.google.com/
// Enable: Google Drive API, Google Identity Services
const GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let tokenClient = null;

// Initialize Google Identity Services
function initGoogleAuth() {
  if (typeof google === 'undefined' || !google.accounts) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: async (resp) => {
      if (resp.error) {
        notify('Googleログインに失敗しました', 'error');
        return;
      }
      AppState.driveAccessToken = resp.access_token;
      await fetchGoogleUserInfo();
      await initDriveFolder();
      updateAuthUI();
      if (AppState.googleUser) {
        notify(`${AppState.googleUser.name} でログインしました`, 'success');
        await syncFromDrive();
      }
    }
  });
}

async function fetchGoogleUserInfo() {
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
    });
    AppState.googleUser = await resp.json();
  } catch(e) {
    console.error('Failed to fetch user info', e);
  }
}

function loginGoogle() {
  if (!tokenClient) {
    notify('Google認証が初期化されていません。Client IDを設定してください', 'error');
    return;
  }
  tokenClient.requestAccessToken({ prompt: '' });
}

function logoutGoogle() {
  if (AppState.driveAccessToken) {
    google.accounts.oauth2.revoke(AppState.driveAccessToken);
  }
  AppState.googleUser = null;
  AppState.driveAccessToken = null;
  AppState.driveFolderId = null;
  updateAuthUI();
  notify('ログアウトしました');
}

function updateAuthUI() {
  const loginBtn = document.getElementById('btn-google-login');
  const userSection = document.getElementById('google-user-section');
  const driveSection = document.getElementById('drive-section');

  if (AppState.googleUser) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (userSection) {
      userSection.style.display = 'flex';
      const avatar = userSection.querySelector('.user-avatar img');
      const name = userSection.querySelector('.user-name');
      if (avatar && AppState.googleUser.picture) avatar.src = AppState.googleUser.picture;
      if (name) name.textContent = AppState.googleUser.name || AppState.googleUser.email;
    }
    if (driveSection) driveSection.style.display = 'flex';
  } else {
    if (loginBtn) loginBtn.style.display = 'flex';
    if (userSection) userSection.style.display = 'none';
    if (driveSection) driveSection.style.display = 'none';
  }
}

// Find or create the app folder in Drive
async function initDriveFolder() {
  if (!AppState.driveAccessToken) return;
  try {
    // Search for existing folder
    const searchResp = await driveAPI('GET',
      `https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`
    );
    const data = await searchResp.json();
    if (data.files && data.files.length > 0) {
      AppState.driveFolderId = data.files[0].id;
    } else {
      // Create folder
      const createResp = await driveAPI('POST',
        'https://www.googleapis.com/drive/v3/files',
        { name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }
      );
      const folder = await createResp.json();
      AppState.driveFolderId = folder.id;
      notify(`Driveフォルダ「${DRIVE_FOLDER_NAME}」を作成しました`, 'success');
    }
  } catch(e) {
    notify('Driveフォルダの初期化に失敗しました', 'error');
  }
}

function driveAPI(method, url, body = null, headers = {}) {
  return fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${AppState.driveAccessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

// List audio files in Drive folder
async function listDriveFiles() {
  if (!AppState.driveFolderId) return [];
  try {
    const audioMimes = [
      'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
      'audio/flac', 'audio/aac', 'audio/webm', 'audio/x-m4a'
    ].map(m => `mimeType='${m}'`).join(' or ');
    const resp = await driveAPI('GET',
      `https://www.googleapis.com/drive/v3/files?q=(${audioMimes}) and '${AppState.driveFolderId}' in parents and trashed=false&fields=files(id,name,size,modifiedTime,mimeType)&pageSize=100`
    );
    const data = await resp.json();
    return data.files || [];
  } catch(e) {
    return [];
  }
}

// Fetch audio file content from Drive as Blob
async function fetchDriveFile(fileId) {
  const resp = await driveAPI('GET',
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  return resp.blob();
}

// Upload file to Drive
async function uploadToDrive(file, metadata = {}) {
  if (!AppState.driveFolderId) {
    notify('Driveフォルダが初期化されていません', 'error');
    return null;
  }
  try {
    const boundary = '-------314159265358979323846';
    const meta = JSON.stringify({
      name: file.name,
      parents: [AppState.driveFolderId],
      ...metadata
    });
    const form = new FormData();
    form.append('metadata', new Blob([meta], { type: 'application/json' }));
    form.append('file', file);

    const resp = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${AppState.driveAccessToken}` },
        body: form
      }
    );
    return await resp.json();
  } catch(e) {
    notify('Driveへのアップロードに失敗しました', 'error');
    return null;
  }
}

// Save settings JSON to Drive
async function saveDriveSettings() {
  if (!AppState.driveAccessToken || !AppState.driveFolderId) return;
  try {
    const settingsData = {
      playlist: AppState.playlist.map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        year: t.year,
        duration: t.duration,
        tags: t.tags,
        driveFileId: t.driveFileId,
        addedAt: t.addedAt,
        artwork: t.artwork ? t.artwork.substring(0, 100) + '...' : null // Save thumb reference only
      })),
      sortMode: AppState.sortMode,
      lastUpdated: Date.now()
    };
    const blob = new Blob([JSON.stringify(settingsData, null, 2)], { type: 'application/json' });
    const file = new File([blob], DRIVE_SETTINGS_FILE);

    // Check if settings file exists
    const searchResp = await driveAPI('GET',
      `https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_SETTINGS_FILE}' and '${AppState.driveFolderId}' in parents and trashed=false&fields=files(id)`
    );
    const searchData = await searchResp.json();

    if (searchData.files && searchData.files.length > 0) {
      // Update existing
      const fileId = searchData.files[0].id;
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${AppState.driveAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settingsData)
      });
    } else {
      // Create new
      await uploadToDrive(file);
    }
  } catch(e) {
    console.error('Failed to save settings to Drive', e);
  }
}

// Sync from Drive (load playlist from Drive settings)
async function syncFromDrive() {
  if (!AppState.driveFolderId) return;
  try {
    const searchResp = await driveAPI('GET',
      `https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_SETTINGS_FILE}' and '${AppState.driveFolderId}' in parents and trashed=false&fields=files(id)`
    );
    const searchData = await searchResp.json();
    if (!searchData.files || searchData.files.length === 0) return;

    const fileResp = await driveAPI('GET',
      `https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`
    );
    const settings = await fileResp.json();

    if (settings.playlist && settings.playlist.length > 0) {
      // Merge with local, Drive takes priority
      const localIds = new Set(AppState.playlist.map(t => t.id));
      let added = 0;
      for (const track of settings.playlist) {
        if (!localIds.has(track.id) && track.driveFileId) {
          // Mark as Drive-only track (lazy load audio)
          track.driveOnly = true;
          AppState.playlist.push(track);
          await dbPut(STORE_TRACKS, track);
          added++;
        }
      }
      if (added > 0) {
        notify(`Driveから${added}曲を同期しました`, 'success');
        renderPlaylist();
      }
    }
  } catch(e) {
    console.error('Sync from drive failed', e);
  }
}

// Open Drive file picker modal
async function openDrivePicker() {
  const modal = document.getElementById('drive-picker-modal');
  if (!modal) return;
  modal.classList.add('active');

  const list = document.getElementById('drive-files-list');
  list.innerHTML = '<div class="skeleton" style="height:40px;margin:6px 0;"></div>'.repeat(3);

  const files = await listDriveFiles();
  if (files.length === 0) {
    list.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:0.82rem;">Driveフォルダ内に音声ファイルが見つかりません</div>`;
    return;
  }

  const existingDriveIds = new Set(AppState.playlist.filter(t => t.driveFileId).map(t => t.driveFileId));

  list.innerHTML = files.map(f => `
    <label class="drive-file-item">
      <input type="checkbox" value="${f.id}" data-name="${f.name}" ${existingDriveIds.has(f.id) ? 'disabled checked' : ''}>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem;">${f.name}</span>
      <span style="font-size:0.7rem;color:var(--text-muted);flex-shrink:0;">${f.size ? (f.size/1024/1024).toFixed(1)+'MB' : ''}</span>
    </label>
  `).join('');
}

async function addSelectedDriveFiles() {
  const checkboxes = document.querySelectorAll('#drive-files-list input[type=checkbox]:checked:not(:disabled)');
  if (checkboxes.length === 0) {
    notify('ファイルを選択してください');
    return;
  }

  const modal = document.getElementById('drive-picker-modal');
  modal.classList.remove('active');

  for (const cb of checkboxes) {
    const fileId = cb.value;
    const fileName = cb.dataset.name;
    notify(`読み込み中: ${fileName}`, 'info');

    try {
      const blob = await fetchDriveFile(fileId);
      const file = new File([blob], fileName, { type: blob.type });
      await addTrackFromFile(file, { driveFileId: fileId });
    } catch(e) {
      notify(`${fileName} の読み込みに失敗しました`, 'error');
    }
  }
}
