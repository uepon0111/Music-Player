/**
 * auth.js — Google OAuth (GIS)
 */
const Auth = (() => {
  let _tc = null, _token = null, _user = null, _loggedIn = false;

  const _load = (src) => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src = src;
    s.onload = res; s.onerror = () => rej(new Error(`load failed: ${src}`));
    document.head.appendChild(s);
  });

  const init = async () => {
    if (!CONFIG.gisAvailable) { _updateUI(false); return; }
    try {
      await _load('https://accounts.google.com/gsi/client');
      await _load('https://apis.google.com/js/api.js');
      await new Promise(res => gapi.load('picker', res));
      _tc = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        scope: CONFIG.GOOGLE_SCOPES,
        callback: async (r) => {
          if (r.error) { App.ui.toast('ログイン失敗: ' + r.error, 'error'); return; }
          _token = r.access_token;
          sessionStorage.setItem('h_tok', JSON.stringify({ t: _token, exp: Date.now() + r.expires_in * 1000 }));
          await _onToken();
        }
      });
      const saved = sessionStorage.getItem('h_tok');
      if (saved) { const s = JSON.parse(saved); if (s.exp > Date.now()) { _token = s.t; await _onToken(); } }
    } catch(e) { console.warn('auth init', e); _updateUI(false); }
  };

  const _onToken = async () => {
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${_token}` } });
      if (!r.ok) throw new Error('userinfo failed');
      _user = await r.json(); _loggedIn = true;
      _updateUI(true);
      await App.gdrive.init(_token);
      const cfg = await App.gdrive.loadConfigFile();
      Storage.setDriveMode(true, cfg?.fileId);
      await Storage.init(true);
      await App.playlists.render();
      App.ui.toast(`${_user.name} としてログインしました`, 'success');
      document.getElementById('btnGDrive')?.classList.remove('hidden');
    } catch(e) { _token = null; _loggedIn = false; _updateUI(false); }
  };

  const login = () => {
    if (!CONFIG.gisAvailable) { App.ui.toast('config.js に Client ID を設定してください', 'warning'); return; }
    if (!_tc) { init().then(login); return; }
    _tc.requestAccessToken({ prompt: '' });
  };

  const logout = async () => {
    if (!_loggedIn) return;
    try { google.accounts.oauth2.revoke(_token, () => {}); } catch {}
    _token = null; _user = null; _loggedIn = false;
    sessionStorage.removeItem('h_tok');
    Storage.setDriveMode(false, null);
    await Storage.init(false);
    _updateUI(false);
    document.getElementById('btnGDrive')?.classList.add('hidden');
    await App.playlists.render();
    App.ui.toast('ログアウトしました');
  };

  const _updateUI = (on) => {
    [['btnLogin','userInfo','userAvatar','userName'],
     ['mobileBtnLogin','mobileUserInfo','mobileUserAvatar','mobileUserName']
    ].forEach(([loginId, infoId, avId, nmId]) => {
      document.getElementById(loginId)?.classList.toggle('hidden', on);
      document.getElementById(infoId)?.classList.toggle('hidden', !on);
      if (on && _user) {
        const av = document.getElementById(avId); if (av) { av.src = _user.picture || ''; av.alt = _user.name; }
        const nm = document.getElementById(nmId); if (nm) nm.textContent = _user.name || _user.email;
      }
    });
  };

  const toggleMobileAuth = () => document.getElementById('mobileAuthPopup')?.classList.toggle('hidden');
  const getToken = () => _token;
  const isLoggedIn = () => _loggedIn;
  const getUser = () => _user;

  return { init, login, logout, getToken, isLoggedIn, getUser, toggleMobileAuth };
})();
