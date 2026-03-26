/**
 * gdrive.js - Google Drive 連携モジュール
 */

const GDrive = (() => {
  let _token = null;
  let _folderId = null;
  let _configFileId = null;

  const BASE_URL = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';

  const _headers = () => ({
    'Authorization': `Bearer ${_token}`,
    'Content-Type': 'application/json'
  });

  const init = async (token) => {
    _token = token;
    await _ensureFolder();
  };

  // ============================================================
  // フォルダ管理
  // ============================================================
  const _ensureFolder = async () => {
    // 既存フォルダを検索
    const res = await fetch(
      `${BASE_URL}/files?q=name='${CONFIG.DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
      { headers: _headers() }
    );
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      _folderId = data.files[0].id;
    } else {
      // フォルダ作成
      const createRes = await fetch(`${BASE_URL}/files`, {
        method: 'POST',
        headers: _headers(),
        body: JSON.stringify({
          name: CONFIG.DRIVE_FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder'
        })
      });
      const folder = await createRes.json();
      _folderId = folder.id;
      UI.toast(`Google Driveに「${CONFIG.DRIVE_FOLDER_NAME}」フォルダを作成しました`, 'success');
    }
  };

  // ============================================================
  // 設定ファイル (JSON)
  // ============================================================
  const loadConfigFile = async () => {
    if (!_folderId) return null;
    const res = await fetch(
      `${BASE_URL}/files?q=name='${CONFIG.DRIVE_CONFIG_FILE}' and '${_folderId}' in parents and trashed=false&fields=files(id,name)`,
      { headers: _headers() }
    );
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      const fileId = data.files[0].id;
      const contentRes = await fetch(`${BASE_URL}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${_token}` }
      });
      const content = await contentRes.text();
      _configFileId = fileId;
      return { fileId, content };
    }
    return null;
  };

  const saveConfigFile = async (jsonContent, fileId) => {
    if (!_folderId) return;
    const blob = new Blob([jsonContent], { type: 'application/json' });

    if (fileId || _configFileId) {
      const id = fileId || _configFileId;
      await fetch(`${UPLOAD_URL}/files/${id}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${_token}`,
          'Content-Type': 'application/json'
        },
        body: blob
      });
    } else {
      // 新規作成
      const metadata = {
        name: CONFIG.DRIVE_CONFIG_FILE,
        parents: [_folderId],
        mimeType: 'application/json'
      };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);
      const res = await fetch(`${UPLOAD_URL}/files?uploadType=multipart`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${_token}` },
        body: form
      });
      const created = await res.json();
      _configFileId = created.id;
      Storage.setDriveMode(true, _configFileId);
    }
  };

  // ============================================================
  // 音声ファイル一覧
  // ============================================================
  const listAudioFiles = async () => {
    if (!_folderId) return [];
    const audioMimes = [
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'audio/mp4', 'audio/flac', 'audio/aac', 'audio/webm'
    ].map(m => `mimeType='${m}'`).join(' or ');

    const res = await fetch(
      `${BASE_URL}/files?q=(${audioMimes}) and '${_folderId}' in parents and trashed=false&fields=files(id,name,size,mimeType,createdTime,modifiedTime)&pageSize=1000`,
      { headers: _headers() }
    );
    const data = await res.json();
    return data.files || [];
  };

  // ============================================================
  // ファイルアップロード
  // ============================================================
  const uploadFile = async (file, onProgress) => {
    if (!_folderId) throw new Error('フォルダが初期化されていません');

    const metadata = {
      name: file.name,
      parents: [_folderId]
    };

    // Resumable upload
    const initRes = await fetch(`${UPLOAD_URL}/files?uploadType=resumable`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${_token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': file.type,
        'X-Upload-Content-Length': file.size
      },
      body: JSON.stringify(metadata)
    });
    const uploadUrl = initRes.headers.get('Location');

    // チャンク送信
    const chunkSize = 5 * 1024 * 1024; // 5MB
    let start = 0;
    let uploadedFile = null;

    while (start < file.size) {
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${start}-${end-1}/${file.size}`,
          'Content-Type': file.type
        },
        body: chunk
      });
      if (res.status === 200 || res.status === 201) {
        uploadedFile = await res.json();
      } else if (res.status !== 308) {
        throw new Error(`アップロードエラー: ${res.status}`);
      }
      start = end;
      if (onProgress) onProgress(Math.round((start / file.size) * 100));
    }
    return uploadedFile;
  };

  // ============================================================
  // ファイルダウンロード (再生用URL取得)
  // ============================================================
  const getStreamUrl = (fileId) => {
    return `${BASE_URL}/files/${fileId}?alt=media&access_token=${_token}`;
  };

  const downloadFile = async (fileId) => {
    const res = await fetch(`${BASE_URL}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${_token}` }
    });
    if (!res.ok) throw new Error('ダウンロード失敗');
    return await res.blob();
  };

  // ============================================================
  // Google Picker (ファイル選択UI)
  // ============================================================
  const openPicker = () => {
    if (!_token) { UI.toast('先にGoogleアカウントでログインしてください', 'warning'); return; }
    if (!window.google?.picker) {
      UI.toast('Google Picker が読み込まれていません', 'error');
      return;
    }
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setMimeTypes('audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/flac,audio/aac,audio/webm')
      .setSelectFolderEnabled(false);

    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(_token)
      .setCallback(_pickerCallback)
      .setTitle('音声ファイルを選択')
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .build();
    picker.setVisible(true);
  };

  const _pickerCallback = async (data) => {
    if (data.action !== google.picker.Action.PICKED) return;
    const docs = data[google.picker.Response.DOCUMENTS];
    for (const doc of docs) {
      await App.files.addFromDrive(doc);
    }
  };

  const getFolderId = () => _folderId;
  const getToken = () => _token;

  return {
    init, loadConfigFile, saveConfigFile, listAudioFiles,
    uploadFile, getStreamUrl, downloadFile, openPicker, getFolderId
  };
})();
