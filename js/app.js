/**
 * app.js — エントリーポイント
 */

// jsmediatags (MP3 メタデータ読み込み)
(() => { const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.7/jsmediatags.min.js'; s.async=true; document.head.appendChild(s); })();

const App = {
  auth: Auth, gdrive: GDrive, player: Player, playlists: Playlists,
  files: Files, editor: Editor, logs: Logs, modal: Modal, ui: UI
};

document.addEventListener('DOMContentLoaded', async () => {
  await Storage.init(false);
  UI.initNav();
  Player.init();
  Editor.init();
  Logs.init();
  await App.playlists.render();
  Files.initDrop();
  Auth.init().catch(e => console.warn('auth init:', e));
  UI.switchPage('player');
  console.log(`${CONFIG.APP_NAME} v${CONFIG.APP_VERSION} ready`);
});
