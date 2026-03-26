// ==========================================
// 1. グローバル状態と定数
// ==========================================
const AppState = {
    playlist: [],          // 再生リスト
    currentTrackIndex: -1, // 現在再生中の曲のインデックス
    isPlaying: false,      // 再生状態
    isGoogleLoggedIn: false, // Googleログイン状態
    driveFolderId: null    // 専用のGoogle DriveフォルダID
};

// Google API設定 (※ご自身の取得したものに書き換えてください)
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
const GOOGLE_API_KEY = 'YOUR_API_KEY';
const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

// ==========================================
// 2. IndexedDB (ローカルキャッシュ) の設定
// ==========================================
let db;
const DB_NAME = 'CloudAudioPlayerDB';
const DB_VERSION = 1;

function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            // 音声ファイル本体を保存するストア
            if (!database.objectStoreNames.contains('audioFiles')) {
                database.createObjectStore('audioFiles', { keyPath: 'id' });
            }
            // メタデータや統計ログを保存するストア
            if (!database.objectStoreNames.contains('metadata')) {
                const metaStore = database.createObjectStore('metadata', { keyPath: 'id' });
                metaStore.createIndex('addedAt', 'addedAt', { unique: false });
            }
            if (!database.objectStoreNames.contains('logs')) {
                const logStore = database.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
                logStore.createIndex('date', 'date', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('<i class="fa-solid fa-database"></i> IndexedDB initialized.');
            resolve();
        };

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.error);
            reject(event.target.error);
        };
    });
}

// ==========================================
// 3. Google Drive API 連携
// ==========================================
let tokenClient;
let gapiInited = false;
let gisInited = false;

// index.htmlで読み込まれたgapiの初期化
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: GOOGLE_API_KEY,
            discoveryDocs: DISCOVERY_DOCS,
        });
        gapiInited = true;
        checkAuthSetup();
    } catch (err) {
        console.error('Error initializing GAPI client', err);
    }
}

// index.htmlで読み込まれたGoogle Identity Servicesの初期化
function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: '', // 認証後に動的に設定
    });
    gisInited = true;
    checkAuthSetup();
}

function checkAuthSetup() {
    if (gapiInited && gisInited) {
        const authBtn = document.getElementById('auth-btn');
        authBtn.addEventListener('click', handleAuthClick);
    }
}

function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        AppState.isGoogleLoggedIn = true;
        updateAuthUI(true);
        await ensureDriveFolder();
        await loadDriveFiles();
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

function updateAuthUI(isLoggedIn) {
    const statusText = document.getElementById('auth-status');
    const authBtn = document.getElementById('auth-btn');
    if (isLoggedIn) {
        statusText.className = 'status-text text-online';
        statusText.innerHTML = '<i class="fa-solid fa-cloud"></i> ドライブ同期中';
        authBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> <span>ログアウト</span>';
        authBtn.onclick = handleSignoutClick;
    } else {
        statusText.className = 'status-text text-offline';
        statusText.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> ローカルモード';
        authBtn.innerHTML = '<i class="fa-brands fa-google"></i> <span>ログイン</span>';
        authBtn.onclick = handleAuthClick;
    }
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken('');
            AppState.isGoogleLoggedIn = false;
            AppState.driveFolderId = null;
            updateAuthUI(false);
            // ローカルモードへの切り替え処理（キャッシュ読み込み等）をここに記述
        });
    }
}

// Drive内に専用フォルダ「AudioApp_Data」があるか確認し、なければ作成する
async function ensureDriveFolder() {
    const folderName = 'AudioApp_Data';
    try {
        const response = await gapi.client.drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });
        
        const files = response.result.files;
        if (files && files.length > 0) {
            AppState.driveFolderId = files[0].id;
        } else {
            const folderMetadata = {
                'name': folderName,
                'mimeType': 'application/vnd.google-apps.folder'
            };
            const createResponse = await gapi.client.drive.files.create({
                resource: folderMetadata,
                fields: 'id'
            });
            AppState.driveFolderId = createResponse.result.id;
        }
    } catch (err) {
        console.error('Error ensuring Drive folder:', err);
    }
}

// ==========================================
// 4. UI 制御 (タブ切り替え・ドラッグ＆ドロップ)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initIndexedDB();
    
    // タブ（ビュー）の切り替え
    const navLinks = document.querySelectorAll('.nav-links li');
    const views = document.querySelectorAll('.view-section');

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navLinks.forEach(n => n.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));
            
            link.classList.add('active');
            const targetId = link.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // ドラッグ＆ドロップの設定
    const dropZone = document.getElementById('drop-zone');
    const dropOverlay = document.getElementById('drop-overlay');

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropOverlay.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropOverlay.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropOverlay.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            handleFilesSelected(e.dataTransfer.files);
        }
    });

    // ファイル追加ボタンの設定
    const fileInput = document.getElementById('file-input');
    const addFileBtn = document.getElementById('add-file-btn');
    
    addFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFilesSelected(e.target.files);
        }
    });
});

// ファイル選択時の処理（次回詳細実装）
function handleFilesSelected(files) {
    const modal = document.getElementById('upload-modal');
    const list = document.getElementById('upload-files-list');
    list.innerHTML = ''; // リスト初期化
    
    Array.from(files).forEach(file => {
        if(file.type.startsWith('audio/')) {
            const item = document.createElement('div');
            item.textContent = file.name;
            list.appendChild(item);
        }
    });
    
    modal.classList.remove('hidden');
    
    document.getElementById('btn-upload-cancel').onclick = () => {
        modal.classList.add('hidden');
        document.getElementById('file-input').value = '';
    };
    
    document.getElementById('btn-upload-confirm').onclick = () => {
        // 次回実装：ファイルのパースとメタデータ取得、DB保存、Google Driveアップロード
        modal.classList.add('hidden');
        processAndAddFiles(files); 
    };
}
