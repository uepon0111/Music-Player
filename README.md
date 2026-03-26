# MusicPortal — 音楽再生サイト

GitHub Pagesでホストする高機能な音楽プレイヤーアプリです。

## 機能

- **音声ファイル再生**: MP3, WAV, OGG, FLAC, M4A 対応
- **ドラッグ&ドロップ**: ファイルをドロップして追加
- **Google Drive 連携**: Driveフォルダから音楽を読み込み・アップロード
- **クロスデバイス同期**: Googleアカウントでどの端末からでも同じプレイリスト
- **音声編集**: メタデータ・アートワーク編集、トリミング、音量・キー調整
- **再生ログ**: 再生時間のグラフ表示（アーティスト、タグ、年代別）
- **レスポンシブ**: PC/タブレット横画面・スマホ縦画面対応

## セットアップ

### 1. リポジトリ作成

```bash
# GitHubで新規リポジトリを作成後
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
# このフォルダの内容をコピー
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. GitHub Pages 有効化

1. リポジトリの **Settings** → **Pages**
2. Source: **GitHub Actions** を選択
3. 自動でデプロイされます

### 3. Google OAuth2 設定（Drive連携を使う場合）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. **APIとサービス** → **ライブラリ** から **Google Drive API** を有効化
3. **認証情報** → **OAuthクライアントID** を作成
   - アプリケーションの種類: **ウェブアプリケーション**
   - 承認済みのJavaScriptの送信元: `https://YOUR_USERNAME.github.io`
   - クライアントIDをコピー
4. `index.html` の以下の行を編集:

```html
<script>
  window.GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
</script>
```

または `js/drive.js` の最初の行を直接編集:
```js
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
```

### 4. OAuth同意画面の設定

- ユーザータイプ: **外部**（自分だけで使う場合でもOK）
- スコープに `https://www.googleapis.com/auth/drive.file` を追加
- テストユーザーに自分のGmailを追加

## 使い方

### ファイルの追加
- アップロードゾーンにドラッグ&ドロップ
- クリックしてファイル選択
- 「+」ボタンからモーダルで追加

### プレイリスト
- 名前順、追加順、長さ順、年代順で並べ替え
- 各曲の右クリックでコンテキストメニュー
- ドラッグで順序変更

### キーボードショートカット
| キー | 操作 |
|------|------|
| Space | 再生/一時停止 |
| → | 10秒スキップ |
| ← | 10秒戻る |
| ↑ | 音量+5% |
| ↓ | 音量-5% |

## ファイル構成

```
music-player/
├── index.html          # メインHTML（全ページ含む）
├── css/
│   └── style.css       # スタイルシート
├── js/
│   ├── icons.js        # SVGアイコン
│   ├── state.js        # アプリ状態・DB・ユーティリティ
│   ├── drive.js        # Google Drive連携
│   ├── player.js       # 音楽プレイヤーエンジン
│   └── edit-logs.js    # 編集・ログページ
└── .github/
    └── workflows/
        └── deploy.yml  # GitHub Actions設定
```

## 技術スタック

- バニラJavaScript (ES2020+)
- IndexedDB（ローカルデータ保存）
- Web Audio API（音声処理）
- Google Identity Services（OAuth2）
- Google Drive API v3
- Chart.js（グラフ）
- jsmediatags（ID3タグ読み取り）
