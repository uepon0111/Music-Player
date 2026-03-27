/**
 * tags.js — カラー付きタグシステム
 * タグは { name: string, color: string } オブジェクト
 */
const Tags = (() => {
  // プリセットパレット (16色)
  const PALETTE = [
    '#ef4444','#f97316','#f59e0b','#eab308',
    '#84cc16','#22c55e','#10b981','#14b8a6',
    '#06b6d4','#3b82f6','#6366f1','#8b5cf6',
    '#a855f7','#ec4899','#f43f5e','#64748b'
  ];

  /** タグ名からデフォルト色を決定論的に返す */
  const defaultColor = (name) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return PALETTE[Math.abs(h) % PALETTE.length];
  };

  /** 背景色に対して可読なテキスト色 (黒 or 白) */
  const textColor = (hex) => {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return (0.299*r + 0.587*g + 0.114*b)/255 > 0.55 ? '#1a1a2e' : '#ffffff';
  };

  /** タグ chip 要素生成 */
  const chip = (tagObj, { removable=false, onRemove=null, onColorClick=null } = {}) => {
    const bg = tagObj.color || defaultColor(tagObj.name);
    const fg = textColor(bg);
    const el = document.createElement('span');
    el.className = 'tag-chip';
    el.style.cssText = `background:${bg};color:${fg};`;
    el.dataset.tagName = tagObj.name;

    // ラベル — クリックで色変更
    const lbl = document.createElement('span');
    lbl.textContent = tagObj.name;
    if (onColorClick) { lbl.style.cursor = 'pointer'; lbl.title = '色を変更'; lbl.addEventListener('click', e => { e.stopPropagation(); onColorClick(tagObj); }); }
    el.appendChild(lbl);

    if (removable && onRemove) {
      const btn = document.createElement('button');
      btn.className = 'tag-chip-remove';
      btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      btn.addEventListener('click', e => { e.stopPropagation(); onRemove(tagObj.name); });
      el.appendChild(btn);
    }
    return el;
  };

  /** プレイリスト上の小さい chip */
  const miniChip = (tagObj) => {
    const bg = tagObj.color || defaultColor(tagObj.name);
    const fg = textColor(bg);
    const el = document.createElement('span');
    el.className = 'track-tag-chip';
    el.style.cssText = `background:${bg};color:${fg};`;
    el.textContent = tagObj.name;
    return el;
  };

  /** タグフィルター chip (トグル可能) */
  const filterChip = (tagObj, active, onClick) => {
    const bg = tagObj.color || defaultColor(tagObj.name);
    const fg = textColor(bg);
    const el = document.createElement('button');
    el.className = 'tag-filter-chip' + (active ? ' active' : '');
    el.style.cssText = active
      ? `background:${bg};color:${fg};border-color:${bg};`
      : `background:${bg}22;color:${bg};border-color:${bg};`;
    el.textContent = tagObj.name;
    el.addEventListener('click', onClick);
    return el;
  };

  /** 全トラックのタグを収集 (重複排除・名前順) */
  const allTags = () => {
    const map = {};
    Object.values(Storage.get('tracks') || {}).forEach(t =>
      (t.tags || []).forEach(tag => { if (!map[tag.name]) map[tag.name] = tag; })
    );
    return Object.values(map).sort((a,b) => a.name.localeCompare(b.name,'ja'));
  };

  const getPalette = () => PALETTE;

  return { defaultColor, textColor, chip, miniChip, filterChip, allTags, getPalette };
})();
