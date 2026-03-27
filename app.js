// app.js: メインのアプリケーションロジック
document.addEventListener('DOMContentLoaded', async () => {
    // === 1. アプリケーションの初期化 ===
    try {
        await initDB();
        console.log("Database initialized.");
        await loadPlaylist();
    } catch (error) {
        console.error("Failed to initialize app:", error);
    }

    // === 2. タブ切り替えロジック ===
    const navLinks = document.querySelectorAll('.nav-links li');
    const pageSections = document.querySelectorAll('.page-section');

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navLinks.forEach(l => l.classList.remove('active'));
            pageSections.forEach(p => p.classList.remove('active'));

            link.classList.add('active');
            const targetId = link.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');

            if(targetId === 'page-logs') initChart();
        });
    });

    // === 3. ファイル追加（ドラッグ＆ドロップ） ===
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFiles(e.target.files);
    });

    // === 4. ファイル解析と保存 ===
    async function handleFiles(files) {
        // 処理中の見た目変更
        dropZone.innerHTML = `<span class="material-icons">hourglass_empty</span><p>処理中...</p>`;
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const meta = await parseMetadata(file);
            
            const trackData = {
                file: file,
                title: meta.title || file.name,
                artist: meta.artist || "Unknown Artist",
                picture: meta.picture || null,
                addedAt: new Date().getTime()
            };

            await addTrackToDB(trackData);
        }

        dropZone.innerHTML = `<span class="material-icons">upload_file</span><p>ファイルをここにドラッグ＆ドロップ、またはクリックして追加</p>`;
        await loadPlaylist(); // プレイリストを再描画
    }

    // jsmediatagsを使ったメタデータの抽出
    function parseMetadata(file) {
        return new Promise((resolve) => {
            window.jsmediatags.read(file, {
                onSuccess: function(tag) {
                    const tags = tag.tags;
                    let pictureData = null;
                    if (tags.picture) {
                        const data = tags.picture.data;
                        const format = tags.picture.format;
                        let base64String = "";
                        for (let i = 0; i < data.length; i++) {
                            base64String += String.fromCharCode(data[i]);
                        }
                        pictureData = `data:${format};base64,${window.btoa(base64String)}`;
                    }
                    resolve({
                        title: tags.title,
                        artist: tags.artist,
                        picture: pictureData
                    });
                },
                onError: function(error) {
                    console.log("Metadata parsing error:", error);
                    resolve({}); // エラー時は空データを返す
                }
            });
        });
    }

    // === 5. プレイリスト機能 ===
    const playlistEl = document.getElementById('playlist');
    const sortSelect = document.getElementById('sort-select');
    let currentTracks = []; // 現在のプレイリスト配列

    async function loadPlaylist() {
        currentTracks = await getAllTracksFromDB();
        renderPlaylist();
    }

    function renderPlaylist() {
        playlistEl.innerHTML = '';
        
        // 並び替え処理
        const sortType = sortSelect.value;
        currentTracks.sort((a, b) => {
            if (sortType === 'name_asc') return a.title.localeCompare(b.title);
            if (sortType === 'name_desc') return b.title.localeCompare(a.title);
            if (sortType === 'date_asc') return a.addedAt - b.addedAt;
            if (sortType === 'date_desc') return b.addedAt - a.addedAt;
            return 0;
        });

        currentTracks.forEach((track, index) => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '0.5rem 1rem';
            li.style.borderBottom = '1px solid var(--border-color)';
            li.style.cursor = 'pointer';

            const infoDiv = document.createElement('div');
            infoDiv.innerHTML = `<strong>${track.title}</strong><br><small style="color:var(--text-muted);">${track.artist}</small>`;
            
            const actionsDiv = document.createElement('div');
            const delBtn = document.createElement('button');
            delBtn.className = 'icon-btn';
            delBtn.innerHTML = '<span class="material-icons">delete</span>';
            delBtn.onclick = async (e) => {
                e.stopPropagation(); // 行全体のクリック判定を防ぐ
                if(confirm('このファイルを削除しますか？')) {
                    await deleteTrackFromDB(track.id);
                    await loadPlaylist();
                }
            };

            li.onclick = () => playTrack(index);

            actionsDiv.appendChild(delBtn);
            li.appendChild(infoDiv);
            li.appendChild(actionsDiv);
            playlistEl.appendChild(li);
        });
    }

    sortSelect.addEventListener('change', renderPlaylist);

    // === 6. オーディオ再生制御 ===
    const audio = document.getElementById('audio-element');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const seekBar = document.getElementById('seek-bar');
    const timeCurrent = document.getElementById('time-current');
    const timeTotal = document.getElementById('time-total');
    
    const uiTitle = document.getElementById('current-title');
    const uiArtist = document.getElementById('current-artist');
    const uiArtwork = document.getElementById('artwork-display');
    const repeatBtn = document.getElementById('repeat-btn');

    let currentTrackIndex = -1;
    let isRepeat = false;

    function playTrack(index) {
        if (index < 0 || index >= currentTracks.length) return;
        currentTrackIndex = index;
        const track = currentTracks[index];

        // UIの更新
        uiTitle.textContent = track.title;
        uiArtist.textContent = track.artist;
        if (track.picture) {
            uiArtwork.innerHTML = `<img src="${track.picture}" style="width:100%; height:100%; object-fit:cover; border-radius:8px;">`;
        } else {
            uiArtwork.innerHTML = `<span class="material-icons">album</span>`;
        }

        // 音声ファイルのセットと再生
        const objectUrl = URL.createObjectURL(track.file);
        audio.src = objectUrl;
        audio.play();
        updatePlayPauseIcon();
    }

    function updatePlayPauseIcon() {
        playPauseBtn.innerHTML = audio.paused 
            ? `<span class="material-icons">play_arrow</span>` 
            : `<span class="material-icons">pause</span>`;
    }

    playPauseBtn.addEventListener('click', () => {
        if (!audio.src) return;
        if (audio.paused) audio.play();
        else audio.pause();
        updatePlayPauseIcon();
    });

    prevBtn.addEventListener('click', () => playTrack(currentTrackIndex - 1));
    nextBtn.addEventListener('click', () => playTrack(currentTrackIndex + 1));

    // 曲の終了時
    audio.addEventListener('ended', () => {
        if (isRepeat) {
            audio.play();
        } else {
            playTrack(currentTrackIndex + 1);
        }
    });

    repeatBtn.addEventListener('click', () => {
        isRepeat = !isRepeat;
        repeatBtn.style.color = isRepeat ? 'var(--primary-color)' : 'var(--text-muted)';
    });

    // 時間とシークバーの更新
    audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        seekBar.value = (audio.currentTime / audio.duration) * 100;
        timeCurrent.textContent = formatTime(audio.currentTime);
        timeTotal.textContent = formatTime(audio.duration);
    });

    seekBar.addEventListener('input', () => {
        if (!audio.duration) return;
        audio.currentTime = (seekBar.value / 100) * audio.duration;
    });

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // === 7. グラフ (ダミーのまま) ===
    let logsChart = null;
    function initChart() {
        const ctx = document.getElementById('logsChart').getContext('2d');
        if (logsChart) logsChart.destroy();
        logsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['月', '火', '水', '木', '金', '土', '日'],
                datasets: [{
                    label: '再生時間 (時間)',
                    data: [2, 3.5, 1, 4, 5, 2.5, 6],
                    backgroundColor: '#1a73e8',
                    borderRadius: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
});
