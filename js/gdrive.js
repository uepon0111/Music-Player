/**
 * gdrive.js — Google Drive API v3
 */
const GDrive = (() => {
  let _tok = null, _folderId = null, _cfgFileId = null;
  const BASE = 'https://www.googleapis.com/drive/v3';
  const UP   = 'https://www.googleapis.com/upload/drive/v3';
  const H    = () => ({ 'Authorization': `Bearer ${_tok}`, 'Content-Type': 'application/json' });

  const init = async (token) => { _tok = token; await _ensureFolder(); };

  const _ensureFolder = async () => {
    const q = `name='${CONFIG.DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const r = await fetch(`${BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, { headers: H() });
    const d = await r.json();
    if (d.files?.length) { _folderId = d.files[0].id; return; }
    const cr = await fetch(`${BASE}/files`, { method:'POST', headers:H(), body:JSON.stringify({ name:CONFIG.DRIVE_FOLDER_NAME, mimeType:'application/vnd.google-apps.folder' }) });
    _folderId = (await cr.json()).id;
    App.ui.toast(`Google Drive に「${CONFIG.DRIVE_FOLDER_NAME}」を作成しました`, 'success');
  };

  /* ── 設定ファイル ── */
  const loadConfigFile = async () => {
    if (!_folderId) return null;
    const q = `name='${CONFIG.DRIVE_CONFIG_FILE}' and '${_folderId}' in parents and trashed=false`;
    const r = await fetch(`${BASE}/files?q=${encodeURIComponent(q)}&fields=files(id)`, { headers: H() });
    const d = await r.json();
    if (!d.files?.length) return null;
    const fileId = d.files[0].id;
    const cr = await fetch(`${BASE}/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${_tok}` } });
    _cfgFileId = fileId;
    return { fileId, content: await cr.text() };
  };

  const saveConfigFile = async (json, fileId) => {
    if (!_folderId) return;
    const blob = new Blob([json], { type: 'application/json' });
    const id = fileId || _cfgFileId;
    if (id) {
      await fetch(`${UP}/files/${id}?uploadType=media`, { method:'PATCH', headers:{ Authorization:`Bearer ${_tok}`, 'Content-Type':'application/json' }, body:blob });
    } else {
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ name:CONFIG.DRIVE_CONFIG_FILE, parents:[_folderId], mimeType:'application/json' })], { type:'application/json' }));
      form.append('file', blob);
      const cr = await fetch(`${UP}/files?uploadType=multipart`, { method:'POST', headers:{ Authorization:`Bearer ${_tok}` }, body:form });
      _cfgFileId = (await cr.json()).id;
      Storage.setDriveMode(true, _cfgFileId);
    }
  };

  /* ── 音声ファイル一覧 ── */
  const listAudioFiles = async () => {
    if (!_folderId) return [];
    const mimes = ['audio/mpeg','audio/wav','audio/ogg','audio/mp4','audio/flac','audio/aac','audio/webm','audio/x-flac'].map(m=>`mimeType='${m}'`).join(' or ');
    const q = `(${mimes}) and '${_folderId}' in parents and trashed=false`;
    const r = await fetch(`${BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,mimeType,createdTime)&pageSize=1000`, { headers: H() });
    return (await r.json()).files || [];
  };

  /* ── アップロード (resumable) ── */
  const uploadFile = async (file, onProgress) => {
    if (!_folderId) throw new Error('フォルダ未初期化');
    const initR = await fetch(`${UP}/files?uploadType=resumable`, {
      method:'POST',
      headers:{ ...H(), 'X-Upload-Content-Type':file.type, 'X-Upload-Content-Length':file.size },
      body: JSON.stringify({ name:file.name, parents:[_folderId] })
    });
    const uploadUrl = initR.headers.get('Location');
    const chunk = 5*1024*1024;
    let start = 0, result = null;
    while (start < file.size) {
      const end = Math.min(start+chunk, file.size);
      const r = await fetch(uploadUrl, { method:'PUT', headers:{ 'Content-Range':`bytes ${start}-${end-1}/${file.size}`, 'Content-Type':file.type }, body:file.slice(start,end) });
      if (r.status===200||r.status===201) result = await r.json();
      else if (r.status!==308) throw new Error(`upload error ${r.status}`);
      start = end;
      if (onProgress) onProgress(Math.round(start/file.size*100));
    }
    return result;
  };

  /* ── ダウンロード / ストリームURL ── */
  const getStreamUrl = (fileId) => `${BASE}/files/${fileId}?alt=media&access_token=${_tok}`;
  const downloadFile = async (fileId) => {
    const r = await fetch(`${BASE}/files/${fileId}?alt=media`, { headers:{ Authorization:`Bearer ${_tok}` } });
    if (!r.ok) throw new Error('download failed');
    return r.blob();
  };

  /* ── Google Picker ── */
  const openPicker = () => {
    if (!_tok) { App.ui.toast('先にログインしてください', 'warning'); return; }
    if (!window.google?.picker) { App.ui.toast('Picker 読み込み中...', 'warning'); return; }
    const view = new google.picker.DocsView()
      .setMimeTypes('audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/flac,audio/aac,audio/webm')
      .setSelectFolderEnabled(false);
    new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(_tok)
      .setCallback(_pickerCB)
      .setTitle('音声ファイルを選択')
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .build().setVisible(true);
  };

  const _pickerCB = async (data) => {
    if (data.action !== google.picker.Action.PICKED) return;
    for (const doc of data[google.picker.Response.DOCUMENTS]) {
      await App.files.addFromDrive({ id:doc.id, name:doc.name, mimeType:doc.mimeType, sizeBytes:doc[google.picker.Document.SIZE_BYTES] });
    }
  };

  const getFolderId = () => _folderId;

  return { init, loadConfigFile, saveConfigFile, listAudioFiles, uploadFile, getStreamUrl, downloadFile, openPicker, getFolderId };
})();
