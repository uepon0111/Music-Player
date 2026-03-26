# Harmonia - 音楽プレイヤー

ブラウザで動作する高機能音楽プレイヤー。GitHub Pages でホスティング可能。

## 機能

- **ローカルファイル再生** - MP3, WAV, OGG, FLAC, AAC などに対応
- **ドラッグ&ドロップ** でファイル追加
- **Google Drive 連携** - ログインしてDriveの音楽を再生・管理（端末をまたいで共有）
- **複数プレイリスト** - 名前順・追加順・長さ順・投稿日順などでソート、手動並び替え
- **音声編集** - トリミング・音量調整・キー変更・テンポ変更・フォーマット変換
- **再生ログ** - アーティスト別・タグ別・年代別にグラフで可視化
- **レスポンシブ対応** - PC・タブレット・スマホに対応

---

## セットアップ

### 1. リポジトリ作成

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. GitHub Pages 有効化

1. GitHubリポジトリ → **Settings** → **Pages**
2. Source: **GitHub Actions** を選択
3. `.github/workflows/deploy.yml` が自動的に使用されます

### 3. Google Drive 連携（オプション）

Google Drive連携を使用する場合:

#### Google Cloud Console での設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **APIs & Services** → **Enable APIs** から以下を有効化:
   - Google Drive API
   - Google Picker API
3. **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
   - アプリケーションの種類: **ウェブアプリケーション**
   - 承認済みの JavaScript 生成元に追加:
     ```
     https://YOUR_USERNAME.github.io
     https://YOUR_USERNAME.github.io/YOUR_REPO
     ```
4. クライアントIDをコピー

#### `js/config.js` の編集

```javascript
const CONFIG = {
  GOOGLE_CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',  // ← ここを変更
  ...
};
```

---

## ファイル構成

```
├── index.html              # メインHTML
├── css/
│   └── style.css           # スタイルシート
├── js/
│   ├── config.js           # 設定（Client IDをここに記入）
│   ├── storage.js          # データ永続化（LocalStorage / Drive）
│   ├── auth.js             # Google OAuth
│   ├── gdrive.js           # Google Drive API
│   ├── player.js           # 音声再生エンジン
│   ├── playlists.js        # プレイリスト管理
│   ├── files.js            # ファイル処理
│   ├── editor.js           # 音声編集
│   ├── logs.js             # 再生ログ・統計
│   ├── modal.js            # モーダル
│   ├── ui.js               # UIユーティリティ
│   └── app.js              # エントリーポイント
└── .github/
    └── workflows/
        └── deploy.yml      # GitHub Actions
```

---

## 使い方

### 音楽を追加する
- **ファイル選択ボタン** または **ドラッグ&ドロップ** でローカルファイルを追加
- Googleアカウントでログイン後、**Google Drive** ボタンからDriveのファイルを追加

### プレイリスト
- 「**+**」ボタンで新規プレイリスト作成
- タブをクリックして切り替え
- ソートセレクトで並べ替え（手動並べ替えはドラッグ&ドロップ）

### 音声編集
- トラックリストの **鉛筆アイコン** または「編集」ページからアクセス
- **メタデータ**: 曲名・アーティスト・アルバム・タグなど
- **サムネイル**: カバーアート設定
- **音声加工**: トリミング・音量・キー・テンポ
- **変換**: MP3/WAV/OGG/FLAC/AACに変換してダウンロード

### ログ
- 「ログ」ページで累計再生時間をグラフで確認
- 時間/日/週/月/年 単位で表示
- 総合・アーティスト別・タグ別・年代別で集計

---

## 技術スタック

- **HTML / CSS / JavaScript** (バニラ、フレームワーク不使用)
- **Web Audio API** - 音声処理・波形描画
- **Chart.js** - ロググラフ
- **Google Identity Services (GIS)** - OAuth認証
- **Google Drive API v3** - ファイル管理
- **jsmediatags** - MP3メタデータ読み込み
- **Font Awesome** - アイコン
- **Noto Sans JP / DM Serif Display** - フォント

---

## ライセンス

MIT
