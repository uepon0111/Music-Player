document.addEventListener('DOMContentLoaded', () => {
    // 1. タブ切り替えロジック
    const navLinks = document.querySelectorAll('.nav-links li');
    const pageSections = document.querySelectorAll('.page-section');

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            // アクティブクラスのリセット
            navLinks.forEach(l => l.classList.remove('active'));
            pageSections.forEach(p => p.classList.remove('active'));

            // クリックされたタブをアクティブに
            link.classList.add('active');
            const targetId = link.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');

            // ログページが開かれたらグラフを描画
            if(targetId === 'page-logs') {
                initChart();
            }
        });
    });

    // 2. ドラッグ＆ドロップロジック
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

    // ファイル処理のスタブ関数
    function handleFiles(files) {
        console.log("ファイルが追加されました:", files);
        alert(`${files.length}件のファイルが追加されました。（IndexedDBへの保存とメタデータ読み込み処理を今後実装します）`);
        // TODO: IndexedDBへの保存、メタデータの解析、プレイリストへの追加処理
    }

    // 3. グラフ描画ロジック (Chart.jsの初期化ダミー)
    let logsChart = null;
    function initChart() {
        const ctx = document.getElementById('logsChart').getContext('2d');
        
        if (logsChart) {
            logsChart.destroy();
        }

        // ダミーデータ
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
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }
});
