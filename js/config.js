/**
 * config.js - アプリ設定
 * 
 * Google OAuth を使用する場合:
 * 1. https://console.cloud.google.com/ でプロジェクトを作成
 * 2. "Google Drive API" と "Google Picker API" を有効化
 * 3. OAuth 2.0 クライアントIDを作成（アプリケーションの種類: ウェブアプリケーション）
 * 4. 承認済みの JavaScript 生成元にGitHub PagesのURLを追加
 * 5. 下記の YOUR_CLIENT_ID を置き換えてください
 */

const CONFIG = {
  // Google OAuth クライアントID (要変更)
  GOOGLE_CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  
  // Google API スコープ
  GOOGLE_SCOPES: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.appdata',
    'profile',
    'email'
  ].join(' '),

  // Google Drive フォルダ名
  DRIVE_FOLDER_NAME: 'Harmonia Music Player',
  DRIVE_CONFIG_FILE: 'harmonia_config.json',

  // アプリバージョン
  APP_VERSION: '1.0.0',
  APP_NAME: 'Harmonia',

  // LocalStorage キー
  STORAGE_KEY: 'harmonia_data',
  CACHE_VERSION_KEY: 'harmonia_cache_v',

  // サポートする音声フォーマット
  SUPPORTED_AUDIO: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'webm'],

  // デフォルトプレイリスト名
  DEFAULT_PLAYLIST: 'マイライブラリ',

  // GIS (Google Identity Services) が利用可能かどうか
  get gisAvailable() {
    return this.GOOGLE_CLIENT_ID !== 'YOUR_CLIENT_ID.apps.googleusercontent.com';
  }
};
