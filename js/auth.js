/**
 * auth.js - Google 認証モジュール
 */

const Auth = (() => {
  let _tokenClient = null;
  let _accessToken = null;
  let _userInfo = null;
  let _isLoggedIn = false;

  const _loadGIS = () => new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('GIS読み込み失敗'));
    document.head.appendChild(s);
  });

  const _loadGAPI = () => new Promise((resolve, reject) => {
    if (window.gapi) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = () => {
      gapi.load('picker', resolve);
    };
    s.onerror = () => reject(new Error('GAPI読み込み失敗'));
    document.head.appendChild(s);
  });

  const init = async () => {
    if (!CONFIG.gisAvailable) {
      console.info('Google Client IDが未設定です。ローカルモードで動作します。');
      _updateUI(false);
      return;
    }
    try {
      await _loadGIS();
      await _loadGAPI();
      _setupTokenClient();
      // 既存セッションの確認
      const saved = sessionStorage.getItem('harmonia_token');
      if (saved) {
        const data = JSON.parse(saved);
        if (data.expiry > Date.now()) {
          _accessToken = data.token;
          await _fetchUserInfo();
        }
      }
    } catch(e) {
      console.warn('Google認証の初期化に失敗しました:', e);
      _updateUI(false);
    }
  };

  const _setupTokenClient = () => {
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: CONFIG.GOOGLE_SCOPES,
      callback: async (response) => {
        if (response.error) {
          UI.toast('ログインに失敗しました: ' + response.error, 'error');
          return;
        }
        _accessToken = response.access_token;
        // トークン保存（セッション内）
        sessionStorage.setItem('harmonia_token', JSON.stringify({
          token: _accessToken,
          expiry: Date.now() + (response.expires_in * 1000)
        }));
        await _fetchUserInfo();
      }
    });
  };

  const _fetchUserInfo = async () => {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${_accessToken}` }
      });
      if (!res.ok) throw new Error('ユーザー情報の取得失敗');
      _userInfo = await res.json();
      _isLoggedIn = true;
      _updateUI(true);
      // ストレージをDriveモードで再初期化
      await App.gdrive.init(_accessToken);
      const configResult = await App.gdrive.loadConfigFile();
      Storage.setDriveMode(true, configResult?.fileId);
      await Storage.init(true);
      // UIを更新
      await App.playlists.render();
      UI.toast(`${_userInfo.name}としてログインしました`, 'success');
      document.getElementById('btnGDrive').style.display = '';
    } catch(e) {
      console.error('ユーザー情報取得エラー:', e);
      _accessToken = null;
      _isLoggedIn = false;
      _updateUI(false);
    }
  };

  const login = () => {
    if (!CONFIG.gisAvailable) {
      UI.toast('Google Client IDが設定されていません。config.jsを確認してください。', 'warning');
      return;
    }
    if (!_tokenClient) {
      UI.toast('Google認証の初期化中です。しばらくお待ちください。', 'warning');
      init().then(login);
      return;
    }
    _tokenClient.requestAccessToken({ prompt: 'consent' });
  };

  const logout = async () => {
    if (!_isLoggedIn) return;
    try {
      google.accounts.oauth2.revoke(_accessToken, () => {});
    } catch(e) {}
    _accessToken = null;
    _userInfo = null;
    _isLoggedIn = false;
    sessionStorage.removeItem('harmonia_token');
    Storage.setDriveMode(false);
    await Storage.init(false);
    _updateUI(false);
    document.getElementById('btnGDrive').style.display = 'none';
    await App.playlists.render();
    UI.toast('ログアウトしました');
  };

  const _updateUI = (loggedIn) => {
    const btnLogin = document.getElementById('btnLogin');
    const userInfoEl = document.getElementById('userInfo');
    const mobileBtnLogin = document.getElementById('mobileBtnLogin');
    const mobileUserInfo = document.getElementById('mobileUserInfo');

    if (loggedIn && _userInfo) {
      btnLogin?.classList.add('hidden');
      userInfoEl?.classList.remove('hidden');
      mobileBtnLogin?.classList.add('hidden');
      mobileUserInfo?.classList.remove('hidden');

      const setUserInfo = (avatarId, nameId) => {
        const avatar = document.getElementById(avatarId);
        const name = document.getElementById(nameId);
        if (avatar) { avatar.src = _userInfo.picture || ''; avatar.alt = _userInfo.name; }
        if (name) name.textContent = _userInfo.name || _userInfo.email;
      };
      setUserInfo('userAvatar', 'userName');
      setUserInfo('mobileUserAvatar', 'mobileUserName');
    } else {
      btnLogin?.classList.remove('hidden');
      userInfoEl?.classList.add('hidden');
      mobileBtnLogin?.classList.remove('hidden');
      mobileUserInfo?.classList.add('hidden');
    }
  };

  const toggleMobileAuth = () => {
    const popup = document.getElementById('mobileAuthPopup');
    popup?.classList.toggle('hidden');
  };

  const getToken = () => _accessToken;
  const isLoggedIn = () => _isLoggedIn;
  const getUser = () => _userInfo;

  return { init, login, logout, getToken, isLoggedIn, getUser, toggleMobileAuth };
})();
