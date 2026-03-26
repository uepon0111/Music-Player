document.addEventListener('DOMContentLoaded', () => {
    // --- SPA ナビゲーション処理 ---
    const navLinks = document.querySelectorAll('.nav-links a');
    const views = document.querySelectorAll('.view');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');
            
            // アクティブなリンクを更新
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // ビューの切り替え
            views.forEach(view => {
                view.classList.remove('active');
                if (view.id === targetId) {
                    view.classList.add('active');
                    if(targetId === 'logs-view') renderChart(); // ログ画面表示時にチャート描画
                }
            });
        });
    });

    // --- ドラッグ＆ドロップ処理 ---
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        if (e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFiles(e.target.files);
        }
    });

    function handleFiles(files) {
        // ここでファイルを読み込み、IndexedDB(キャッシュ)またはGoogle Driveへ保存する処理を呼び出す
        // 現在はUIに追加するモックアップ
        const playlist = document.getElementById('playlist');
        Array.from(files).forEach(file => {
            if (file.type.startsWith('audio/')) {
                const li = document.createElement('li');
                li.innerHTML = `
                    <div class="track-info">
                        <strong>${file.name}</strong>
                    </div>
                    <div class="track-actions">
                        <button class="btn-icon play-btn"><i class="fa-solid fa-play"></i></button>
                        <button class="btn-icon delete-btn"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `;
                playlist.appendChild(li);
                
                // 初回追加時に編集ページへ遷移する機能などのトリガーをここに記述
            }
        });
    }

    // --- Chart.js ログ表示処理 (モック) ---
    let statsChart = null;
    function renderChart() {
        const ctx = document.getElementById('statsChart').getContext('2d');
        if (statsChart) statsChart.destroy();

        // ダミーデータ
        const data = {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Playtime (Hours)',
                data: [1.2, 2.5, 0.8, 3.1, 4.0, 5.5, 2.0],
                backgroundColor: 'rgba(29, 185, 84, 0.5)',
                borderColor: 'rgba(29, 185, 84, 1)',
                borderWidth: 1
            }]
        };

        statsChart = new Chart(ctx, {
            type: 'bar',
            data: data,
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }

    // --- ソート機能 (モック枠組み) ---
    document.getElementById('sort-select').addEventListener('change', (e) => {
        const sortType = e.target.value;
        console.log(`Sorting playlist by: ${sortType}`);
        // ここに配列のソートとDOMの再レンダリング処理を記述
    });
});
