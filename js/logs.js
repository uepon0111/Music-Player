/**
 * logs.js — 再生ログ・グラフ
 */
const Logs = (() => {
  let _chart  = null;
  let _period = 'day';
  let _cat    = 'total';

  const init = () => {
    document.querySelectorAll('.period-tab').forEach(b=>b.addEventListener('click',()=>{
      document.querySelectorAll('.period-tab').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); _period=b.dataset.period; render();
    }));
    document.querySelectorAll('.log-cat-tab').forEach(b=>b.addEventListener('click',()=>{
      document.querySelectorAll('.log-cat-tab').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); _cat=b.dataset.cat; render();
    }));
  };

  const render = () => {
    const logs = Storage.get('logs') || [];
    _summary(logs); _chart_(logs); _table(logs);
  };

  const _summary = (logs) => {
    const tot = logs.reduce((s,l)=>s+(l.duration||0),0);
    document.getElementById('totalPlayTime').textContent  = _fmtDur(tot);
    document.getElementById('totalPlayCount').textContent = logs.length.toLocaleString();
    const cnt={};logs.forEach(l=>{cnt[l.trackId]=(cnt[l.trackId]||0)+1;});
    const top=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0];
    document.getElementById('mostPlayed').textContent = top ? ((Storage.get('tracks')||{})[top]?.title||'不明') : '-';
  };

  const _chart_ = (logs) => {
    const {labels,datasets}=_buildData(logs);
    const canvas=document.getElementById('logChart'); if(!canvas) return;
    if(_chart){_chart.destroy();_chart=null;}
    _chart=new Chart(canvas,{
      type:'bar',data:{labels,datasets},
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{
          legend:{display:datasets.length>1,position:'top',labels:{font:{family:"'Noto Sans JP',sans-serif",size:11},color:'#6b6b80'}},
          tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ${_fmtDur(ctx.raw||0)}`}}
        },
        scales:{
          x:{ticks:{color:'#a0a0b0',font:{family:"'Noto Sans JP',sans-serif",size:10}},grid:{color:'#f0f0f5'}},
          y:{ticks:{color:'#a0a0b0',font:{family:"'Noto Sans JP',sans-serif",size:10},callback:v=>_fmtDur(v)},grid:{color:'#f0f0f5'}}
        }
      }
    });
  };

  const _buildData = (logs) => {
    const now=Date.now();
    const cnt={hour:24,day:30,week:12,month:12,year:5}[_period]||30;
    const ms ={hour:3600000,day:86400000,week:604800000,month:2592000000,year:31536000000}[_period]||86400000;
    const labels=[],slots=[];
    for(let i=cnt-1;i>=0;i--){const t=now-i*ms;labels.push(_label(t));slots.push({s:t-ms,e:t});}

    if(_cat==='total'){
      return{labels,datasets:[{label:'再生時間',data:slots.map(sl=>logs.filter(l=>l.timestamp>=sl.s&&l.timestamp<sl.e).reduce((s,l)=>s+(l.duration||0),0)),backgroundColor:'rgba(91,94,246,.75)',borderRadius:4}]};
    }

    const groups={};
    logs.forEach(l=>{
      const keys=_cat==='tag'   ? (l.tags||[]).map(g=>typeof g==='string'?g:g.name)
                :_cat==='artist'? [l.artist||'不明']
                :_cat==='era'   ? [_era(l.date||'')] : ['不明'];
      keys.forEach(k=>{ if(!groups[k])groups[k]=[]; groups[k].push(l); });
    });
    const top6=Object.entries(groups).sort((a,b)=>b[1].reduce((s,l)=>s+l.duration,0)-a[1].reduce((s,l)=>s+l.duration,0)).slice(0,6);
    const clrs=['rgba(91,94,246,.75)','rgba(236,72,153,.75)','rgba(34,197,94,.75)','rgba(249,115,22,.75)','rgba(14,165,233,.75)','rgba(168,85,247,.75)'];
    return{labels,datasets:top6.map(([name,gl],i)=>({
      label:String(name),
      data:slots.map(sl=>gl.filter(l=>l.timestamp>=sl.s&&l.timestamp<sl.e).reduce((s,l)=>s+(l.duration||0),0)),
      backgroundColor:clrs[i%clrs.length],borderRadius:4
    }))};
  };

  const _era = (date) => { const y=date?parseInt(date.slice(0,4)):NaN; return isNaN(y)?'不明':`${Math.floor(y/10)*10}年代`; };
  const _label = (ts) => {const d=new Date(ts);return{hour:`${d.getHours()}時`,day:`${d.getMonth()+1}/${d.getDate()}`,week:`W${d.getMonth()+1}/${d.getDate()}`,month:`${d.getFullYear()}/${d.getMonth()+1}`,year:`${d.getFullYear()}年`}[_period]||'';};

  const _table = (logs) => {
    const tbody=document.getElementById('logTableBody'); if(!tbody) return;
    const sm={};logs.forEach(l=>{if(!sm[l.trackId])sm[l.trackId]={title:l.title,artist:l.artist,duration:0,count:0};sm[l.trackId].duration+=l.duration||0;sm[l.trackId].count++;});
    const sorted=Object.entries(sm).sort((a,b)=>b[1].duration-a[1].duration).slice(0,50);
    if(!sorted.length){tbody.innerHTML='<tr><td colspan="4" class="log-empty">再生ログがありません</td></tr>';return;}
    tbody.innerHTML=sorted.map(([,s])=>`<tr><td>${_esc(s.title||'不明')}</td><td>${_esc(s.artist||'-')}</td><td>${_fmtDur(s.duration)}</td><td>${s.count.toLocaleString()}</td></tr>`).join('');
  };

  const _fmtDur=(s)=>{if(!s||s<0)return'0:00:00';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);return`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;};
  const _esc=(s)=>(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  return{init,render};
})();
