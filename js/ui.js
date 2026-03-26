/**
 * ui.js - UI ユーティリティ
 */

const UI = (() => {
  // ============================================================
  // ページ切替
  // ============================================================
  const switchPage = (pageName) => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${pageName}`)?.classList.add('active');

    // ナビゲーションのアクティブ状態
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === pageName);
    });

    // ページ固有の処理
    if (pageName === 'logs') Logs.render();
    if (pageName === 'editor') App.editor.refreshSelect();

    // モバイルの認証ポップアップを閉じる
    document.getElementById('mobileAuthPopup')?.classList.add('hidden');
  };

  // ============================================================
  // トースト通知
  // ============================================================
  const toast = (message, type = 'info', duration = 3000) => {
    const container = document.getElementById('toastContainer');
    const t = document.createElement('div');
    const icons = {
      info: 'fa-circle-info',
      success: 'fa-circle-check',
      error: 'fa-circle-xmark',
      warning: 'fa-triangle-exclamation'
    };
    t.className = `toast ${type}`;
    t.innerHTML = `<i class="fa-solid ${icons[type] || 'fa-circle-info'}"></i> ${message}`;
    container.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(20px)';
      t.style.transition = 'all 0.3s ease';
      setTimeout(() => t.remove(), 300);
    }, duration);
  };

  // ============================================================
  // 処理オーバーレイ
  // ============================================================
  const showProcessing = (message = '処理中...') => {
    const overlay = document.getElementById('processingOverlay');
    document.getElementById('processingMessage').textContent = message;
    document.getElementById('processingBar').style.width = '0%';
    overlay?.classList.remove('hidden');
  };

  const hideProcessing = () => {
    document.getElementById('processingOverlay')?.classList.add('hidden');
  };

  const updateProcessingProgress = (pct) => {
    document.getElementById('processingBar').style.width = pct + '%';
    document.getElementById('processingMessage').textContent = `アップロード中... ${pct}%`;
  };

  // ============================================================
  // confirm / prompt をモーダルでラップ
  // ============================================================
  const confirm = (message, title) => Modal.confirm(message, title);
  const prompt = (message, defaultValue, title) => Modal.prompt(message, defaultValue, title);

  // ============================================================
  // ナビゲーション初期化
  // ============================================================
  const initNav = () => {
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(item => {
      if (!item.id) {
        item.addEventListener('click', () => switchPage(item.dataset.page));
      }
    });
  };

  return { switchPage, toast, showProcessing, hideProcessing, updateProcessingProgress, confirm, prompt, initNav };
})();
