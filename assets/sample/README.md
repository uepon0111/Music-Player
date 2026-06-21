# イコライザー試聴用BGMサンプル

## 配置方法

以下のいずれかのファイルをこのフォルダに配置してください：
- `equalizer-bgm.mp3`  ← 優先して読み込まれます
- `equalizer-bgm.ogg`
- `equalizer-bgm.wav`

## おすすめの無料BGMサイト

### 1. DOVA-SYNDROME（おすすめ）
- URL: https://dova-s.jp/
- 特徴: 日本語サイト、商用利用無料、ジャンル豊富
- 使い方: 好きな曲をダウンロード → `equalizer-bgm.mp3` にリネーム

### 2. Pixabay Music
- URL: https://pixabay.com/music/
- 特徴: 著作権表示不要、英語サイト、クオリティ高め
- 使い方: "FREE Download" ボタンでMP3取得 → `equalizer-bgm.mp3` にリネーム

### 3. Free Music Archive
- URL: https://freemusicarchive.org/
- 特徴: CC（クリエイティブコモンズ）ライセンス楽曲
- 注意: ライセンス種別を確認してください（CC BY等）

## GitHubへのファイル配置手順

```bash
# 1. ファイルを assets/sample/ フォルダに配置
cp ~/Downloads/your-bgm.mp3 assets/sample/equalizer-bgm.mp3

# 2. Gitにコミット
git add assets/sample/equalizer-bgm.mp3
git commit -m "Add equalizer BGM sample"
git push

# または GitHub Desktop / ブラウザのアップロード機能を使用
```

## イコライザーでの使い方

設定画面 → イコライザー → 「イコライザ試聴」セクション →
「BGMサンプル（外部音源）」を選択 → ▶ ボタンで再生
