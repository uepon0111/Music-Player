/**
 * logs.js - 再生ログ・統計モジュール
 */

const Logs = (() => {
  let _chart = null;
  let _currentPeriod = 'day';
  let _currentCat = 'total';

  const init = () => {
    // 期間タブ
    document.querySelectorAll('.period-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _currentPeriod = btn.dataset.period;
        render();
      });
    });

    // カテゴリータブ
    document.querySelectorAll('.log-cat-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.log-cat-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _currentCat = btn.dataset.cat;
        render();
      });
    });
  };

  const render = () => {
    const logs = Storage.get('logs') || [];
    _renderSummary(logs);
    _renderChart(logs);
    _renderTable(logs);
  };

  // ============================================================
  // サマリー
  // ============================================================
  const _renderSummary = (logs) => {
    const totalSec = logs.reduce((s, l) => s + (l.duration || 0), 0);
    document.getElementById('totalPlayTime').textContent = _formatDuration(totalSec);
    document.getElementById('totalPlayCount').textContent = logs.length.toLocaleString();

    // 最多再生
    const counts = {};
    logs.forEach(l => { counts[l.trackId] = (counts[l.trackId] || 0) + 1; });
    const topId = Object.keys(counts).sort((a,b) => counts[b]-counts[a])[0];
    if (topId) {
      const track = (Storage.get('tracks') || {})[topId];
      document.getElementById('mostPlayed').textContent = track?.title || '不明';
    } else {
      document.getElementById('mostPlayed').textContent = '-';
    }
  };

  // ============================================================
  // チャート
  // ============================================================
  const _renderChart = (logs) => {
    const { labels, datasets } = _buildChartData(logs, _currentPeriod, _currentCat);

    const canvas = document.getElementById('logChart');
    if (!canvas) return;

    if (_chart) { _chart.destroy(); _chart = null; }

    _chart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: datasets.length > 1,
            position: 'top',
            labels: { font: { family: "'Noto Sans JP', sans-serif", size: 12 }, color: '#6b6b80' }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const sec = ctx.raw || 0;
                return ` ${ctx.dataset.label || ''}: ${_formatDuration(sec)}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#a0a0b0', font: { family: "'Noto Sans JP', sans-serif", size: 11 } },
            grid: { color: '#f0f0f5' }
          },
          y: {
            ticks: {
              color: '#a0a0b0',
              font: { family: "'Noto Sans JP', sans-serif", size: 11 },
              callback: (v) => _formatDuration(v)
            },
            grid: { color: '#f0f0f5' }
          }
        }
      }
    });
  };

  const _buildChartData = (logs, period, cat) => {
    const now = Date.now();
    const slotCount = _getSlotCount(period);
    const slotMs = _getSlotMs(period);
    const labels = [];
    const slots = [];

    for (let i = slotCount - 1; i >= 0; i--) {
      const t = now - i * slotMs;
      labels.push(_formatSlotLabel(t, period));
      slots.push({ start: t - slotMs, end: t });
    }

    if (cat === 'total') {
      const data = slots.map(slot =>
        logs.filter(l => l.timestamp >= slot.start && l.timestamp < slot.end)
            .reduce((s, l) => s + (l.duration || 0), 0)
      );
      return {
        labels,
        datasets: [{ label: '再生時間', data, backgroundColor: 'rgba(91,94,246,0.7)', borderRadius: 4 }]
      };
    }

    // グループ化
    const groupKey = cat === 'artist' ? 'artist' : cat === 'tag' ? null : 'year';
    const groups = {};
    logs.forEach(l => {
      if (cat === 'tag') {
        (l.tags || []).forEach(tag => {
          if (!groups[tag]) groups[tag] = [];
          groups[tag].push(l);
        });
      } else {
        const key = l[groupKey] || '不明';
        if (!groups[key]) groups[key] = [];
        groups[key].push(l);
      }
    });

    // 上位6グループ
    const sorted = Object.entries(groups)
      .sort((a,b) => b[1].reduce((s,l)=>s+l.duration,0) - a[1].reduce((s,l)=>s+l.duration,0))
      .slice(0, 6);

    const colors = ['rgba(91,94,246,0.7)','rgba(236,72,153,0.7)','rgba(34,197,94,0.7)',
                    'rgba(249,115,22,0.7)','rgba(14,165,233,0.7)','rgba(168,85,247,0.7)'];
    const datasets = sorted.map(([name, glogs], i) => ({
      label: String(name),
      data: slots.map(slot => glogs.filter(l => l.timestamp >= slot.start && l.timestamp < slot.end)
                                   .reduce((s,l) => s + (l.duration||0), 0)),
      backgroundColor: colors[i % colors.length],
      borderRadius: 4
    }));

    return { labels, datasets };
  };

  const _getSlotCount = (period) => {
    const map = { hour: 24, day: 30, week: 12, month: 12, year: 5 };
    return map[period] || 30;
  };

  const _getSlotMs = (period) => {
    const map = { hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
    return map[period] || 86400000;
  };

  const _formatSlotLabel = (ts, period) => {
    const d = new Date(ts);
    switch(period) {
      case 'hour': return `${d.getHours()}時`;
      case 'day':  return `${d.getMonth()+1}/${d.getDate()}`;
      case 'week': return `${d.getMonth()+1}/${d.getDate()}週`;
      case 'month': return `${d.getFullYear()}/${d.getMonth()+1}`;
      case 'year': return `${d.getFullYear()}年`;
      default: return '';
    }
  };

  // ============================================================
  // テーブル
  // ============================================================
  const _renderTable = (logs) => {
    const tbody = document.getElementById('logTableBody');
    if (!tbody) return;

    const tracks = Storage.get('tracks') || {};
    const summary = {};
    logs.forEach(l => {
      if (!summary[l.trackId]) summary[l.trackId] = { title: l.title, artist: l.artist, duration: 0, count: 0 };
      summary[l.trackId].duration += l.duration || 0;
      summary[l.trackId].count++;
    });

    const sorted = Object.entries(summary).sort((a,b) => b[1].duration - a[1].duration).slice(0, 50);

    if (!sorted.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="log-empty">再生ログがありません</td></tr>`;
      return;
    }

    tbody.innerHTML = sorted.map(([id, s]) =>
      `<tr>
        <td>${_esc(s.title || '不明')}</td>
        <td>${_esc(s.artist || '-')}</td>
        <td>${_formatDuration(s.duration)}</td>
        <td>${s.count.toLocaleString()}</td>
      </tr>`
    ).join('');
  };

  // ============================================================
  // Helpers
  // ============================================================
  const _formatDuration = (sec) => {
    if (!sec || sec < 0) return '0:00:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  };
  const _esc = (str) => (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  return { init, render };
})();
