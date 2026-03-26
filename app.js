// --- 状態管理 ---
let playlist = []; // 楽曲リストを保持する配列
let currentAudioIndex = -1; // 現在再生中のインデックス

// --- DOM要素 ---
const audioPlayer = document.getElementById('main-audio');
const playlistElement = document.getElementById('playlist');
const fileInput = document.getElementById('local-upload');

// --- SPA (画面切り替え) ---
function switchView(viewId) {
    // 全てのビューを非表示
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    // 全てのナビゲーションボタンのactiveを解除
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // 指定されたビューを表示
    document.getElementById(viewId).classList.add('active');
    document.getElementById(`btn-${viewId}`).classList.add('active');
}

// --- ローカルファイルのアップロード処理 ---
fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    
    files.forEach(file => {
        // オブジェクトURLを作成して再生可能にする
        const fileUrl = URL.createObjectURL(file);
        const songData = {
            id: Date.now() + Math.random().toString(36).substr(2, 9), // 一意のID
            name: file.name,
            url: fileUrl,
            fileObj: file, // 編集機能などのために元のファイルオブジェクトを保持
            addedAt: new Date().getTime(),
            duration: 0, // 後でメタデータから取得
            source: 'local'
        };
        playlist.push(songData);
    });

    renderPlaylist();
    // 入力欄をリセット（同じファイルを再度選択できるように）
    fileInput.value = '';
});

// --- プレイリストの描画 ---
function renderPlaylist() {
    playlistElement.innerHTML = ''; // クリア

    if (playlist.length === 0) {
        playlistElement.innerHTML = '<li style="justify-content:center; color:#888;">ファイルがありません</li>';
        return;
    }

    playlist.forEach((song, index) => {
        const li = document.createElement('li');
        
        // アイコンとファイル名
        const infoDiv = document.createElement('div');
        infoDiv.innerHTML = `<i class="fa-solid fa-music"></i> ${song.name}`;
        
        // 再生ボタン
        const playBtn = document.createElement('button');
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        playBtn.onclick = (e) => {
            e.stopPropagation(); // liのクリックイベント発火を防ぐ
            playSong(index);
        };

        li.appendChild(infoDiv);
        li.appendChild(playBtn);
        
        // 行全体をクリックしても再生
        li.onclick = () => playSong(index);

        playlistElement.appendChild(li);
    });
}

// --- 楽曲の再生 ---
function playSong(index) {
    if (index < 0 || index >= playlist.length) return;
    
    currentAudioIndex = index;
    const song = playlist[index];
    
    audioPlayer.src = song.url;
    audioPlayer.play();
}

// 初期化表示
renderPlaylist();
