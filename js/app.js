/**
 * app.js - アプリケーション エントリーポイント
 */

// jsmediatags CDN ロード（メタデータ読み込み用）
(function() {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.7/jsmediatags.min.js';
  s.async = true;
  document.head.appendChild(s);
})();

// ============================================================
// App - 各モジュールへのアクセスポイント
// ============================================================
const App = {
  auth: Auth,
  gdrive: GDrive,
  player: Player,
  playlists: Playlists,
  files: Files,
  editor: Editor,
  logs: Logs,
  modal: Modal,
  ui: UI
};

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // ストレージ初期化（ローカルモード）
  await Storage.init(false);

  // UI / ナビゲーション
  UI.initNav();

  // プレイヤー
  Player.init();

  // エディター
  Editor.init();

  // ログ
  Logs.init();

  // プレイリスト
  await Playlists.render();

  // ドロップゾーン
  Files.initDropZone();

  // Google認証（非同期・失敗しても続行）
  Auth.init().catch(e => console.warn('Auth init error:', e));

  // ページ初期表示
  UI.switchPage('player');

  console.log(`${CONFIG.APP_NAME} v${CONFIG.APP_VERSION} 起動完了`);
});
