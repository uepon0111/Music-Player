/**
 * config.js
 * Google OAuth を使う場合:
 *  1. https://console.cloud.google.com/ でプロジェクト作成
 *  2. Google Drive API / Google Picker API を有効化
 *  3. OAuth 2.0 クライアントID 作成 (ウェブアプリ)
 *  4. 承認済み JavaScript 生成元に GitHub Pages の URL を追加
 *  5. 下記 GOOGLE_CLIENT_ID を書き換える
 */
const CONFIG = {
  GOOGLE_CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  GOOGLE_SCOPES: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata profile email',
  DRIVE_FOLDER_NAME: 'Harmonia Music Player',
  DRIVE_CONFIG_FILE:  'harmonia_config.json',
  APP_NAME:    'Harmonia',
  APP_VERSION: '2.0.0',
  STORAGE_KEY: 'harmonia_v2',
  SUPPORTED_AUDIO: ['mp3','wav','ogg','m4a','aac','flac','opus','webm'],
  get gisAvailable() { return this.GOOGLE_CLIENT_ID !== 'YOUR_CLIENT_ID.apps.googleusercontent.com'; }
};
