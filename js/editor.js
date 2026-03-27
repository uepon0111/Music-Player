/**
 * editor.js — 音声編集 (Web Audio API + FFmpeg.wasm)
 */
const Editor = (() => {
  let _tid      = null;
  let _buf      = null;
  let _actx     = null;
  let _prevSrc  = null;
  let _prevTimer= null;
  let _prevOff  = 0;
  let _prevSt   = 0;
  let _tags     = [];   // [{name,color}]
  let _thumb    = null;
  let _ffmpeg   = null;
  let _ffReady  = false;

  const _getActx = () => { if (!_actx || _actx.state==='closed') _actx=new(window.AudioContext||window.webkitAudioContext)(); return _actx; };

  /* ══ 初期化 ══ */
  const init = () => {
    // タブ切り替え
    document.querySelectorAll('.editor-tab').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.editor-tab,.editor-tab-content').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab)?.classList.add('active');
      if (btn.dataset.tab==='convert') _loadFFmpeg();
    }));
    _initTagInput();
    refreshSelect();
  };

  /* ══ FFmpeg.wasm ══ */
  const _loadFFmpeg = async () => {
    if (_ffReady) return;
    const st = document.getElementById('ffmpegStatus');
    const _s = (msg, cls='') => { if(st){st.innerHTML=msg;st.className='ffmpeg-status '+cls;} };
    _s('<i class="fa-solid fa-spinner fa-spin"></i> FFmpeg を読み込み中...');
    try {
      if (!window.FFmpeg) await _loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js');
      const { FFmpeg: FF } = window.FFmpeg;
      _ffmpeg = new FF();
      _ffmpeg.on('progress', ({progress}) => {
        const p = Math.round(progress*100);
        const bar=document.getElementById('ffmpegBar'), txt=document.getElementById('ffmpegProgressText');
        if(bar) bar.style.width=p+'%'; if(txt) txt.textContent=p+'%';
      });
      await _ffmpeg.load({ coreURL:'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js' });
      _ffReady = true;
      _s('<i class="fa-solid fa-circle-check"></i> FFmpeg 準備完了','ready');
    } catch(e) {
      console.warn('ffmpeg load failed',e);
      _s('<i class="fa-solid fa-triangle-exclamation"></i> FFmpeg の読み込みに失敗しました（Web Audio API で処理）','error');
    }
  };
  const _loadScript = (src) => new Promise((res,rej)=>{ const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s); });

  /* ══ トラック選択 ══ */
  const refreshSelect = () => {
    const sel = document.getElementById('editorTrackSelect'); if (!sel) return;
    const tracks = Object.values(Storage.get('tracks')||{});
    sel.innerHTML = '<option value="">-- ファイルを選択 --</option>';
    tracks.forEach(t=>{ const o=document.createElement('option');o.value=t.id;o.textContent=t.title||t.fileName||t.id;if(t.id===_tid)o.selected=true;sel.appendChild(o); });
  };

  const syncSelect = (tid) => { const s=document.getElementById('editorTrackSelect');if(s)s.value=tid; };

  const openFor = (tid) => { App.ui.switchPage('editor'); setTimeout(()=>loadTrack(tid),100); };

  const loadTrack = async (tid) => {
    if (!tid) { document.getElementById('editorMain')?.classList.add('hidden'); return; }
    _tid=tid;
    const d=Storage.get(); const t=d.tracks[tid]; if(!t) return;
    document.getElementById('editorMain')?.classList.remove('hidden');

    document.getElementById('metaTitle').value  = t.title  || '';
    document.getElementById('metaArtist').value = t.artist || '';
    document.getElementById('metaAlbum').value  = t.album  || '';
    document.getElementById('metaDate').value   = t.date   || '';
    document.getElementById('metaGenre').value  = t.genre  || '';

    // タグ
    _tags = (t.tags||[]).map(g => typeof g==='string'?{name:g,color:Tags.defaultColor(g)}:g);
    _renderEditorTags();

    // サムネイル
    _thumb = t.thumbnailBase64 || null;
    _updateThumbUI();

    // スライダーリセット
    ['audioVolume','audioKey','audioTempo'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=id==='audioVolume'?100:id==='audioTempo'?100:0; });
    ['volumeVal','keyVal','tempoVal'].forEach(id=>{ const el=document.getElementById(id);if(el) el.textContent=id==='volumeVal'?'100':id==='tempoVal'?'100':'0'; });
    document.getElementById('trimStartVal').value='0';

    await _loadBuf(t);
  };

  const _loadBuf = async (t) => {
    try {
      let blob;
      if (t.source==='gdrive' && Auth.isLoggedIn()) blob=await GDrive.downloadFile(t.driveFileId);
      else blob=Storage.getBlob(t.id);
      if (!blob) return;
      const ab = await blob.arrayBuffer();
      _buf = await _getActx().decodeAudioData(ab);
      document.getElementById('trimEndVal').value  = _buf.duration.toFixed(1);
      document.getElementById('editorPreviewTime').textContent = `0:00 / ${_fmt(_buf.duration)}`;
      _drawWaveform();
      updateTrimRegion();
    } catch(e) { console.warn('buf load',e); }
  };

  /* ══ 波形描画 ══ */
  const _drawWaveform = () => {
    if (!_buf) return;
    const canvas = document.getElementById('waveformCanvas'); if (!canvas) return;
    const wrap = document.getElementById('waveformContainer');
    canvas.width=wrap.offsetWidth||600; canvas.height=wrap.offsetHeight||76;
    const ctx=canvas.getContext('2d'); const data=_buf.getChannelData(0);
    const W=canvas.width,H=canvas.height,amp=H/2,step=Math.ceil(data.length/W);
    ctx.clearRect(0,0,W,H); ctx.fillStyle='#f7f7f9'; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='#5b5ef6'; ctx.lineWidth=1;
    for(let i=0;i<W;i++){let mn=1,mx=-1;for(let j=0;j<step;j++){const v=data[i*step+j]||0;if(v<mn)mn=v;if(v>mx)mx=v;}ctx.beginPath();ctx.moveTo(i,(1+mn)*amp);ctx.lineTo(i,(1+mx)*amp);ctx.stroke();}
  };

  /* ══ トリム領域 ══ */
  const updateTrimRegion = () => {
    if (!_buf) return;
    const dur=_buf.duration;
    const s=parseFloat(document.getElementById('trimStartVal')?.value)||0;
    const e=parseFloat(document.getElementById('trimEndVal')?.value)||dur;
    const region=document.getElementById('trimRegion');
    if(region){region.style.left=((s/dur)*100)+'%';region.style.width=((Math.max(0,e-s)/dur)*100)+'%';}
  };

  /* ══ プレビュー ══ */
  const previewPlay = () => {
    if (!_buf){App.ui.toast('音声が読み込まれていません','warning');return;}
    previewStop();
    const ctx=_getActx();
    _prevSrc=ctx.createBufferSource();
    _prevSrc.buffer=_buf;
    _prevSrc.detune.value=(parseInt(document.getElementById('audioKey')?.value)||0)*100;
    _prevSrc.playbackRate.value=(parseFloat(document.getElementById('audioTempo')?.value)||100)/100;
    const gain=ctx.createGain();
    gain.gain.value=(parseFloat(document.getElementById('audioVolume')?.value)||100)/100;
    _prevSrc.connect(gain); gain.connect(ctx.destination);
    const ts=parseFloat(document.getElementById('trimStartVal')?.value)||0;
    const te=parseFloat(document.getElementById('trimEndVal')?.value)||_buf.duration;
    _prevOff=ts; _prevSt=ctx.currentTime;
    _prevSrc.start(0,ts,te-ts);
    _prevSrc.onended=previewStop;
    const cur=document.getElementById('waveformCursor');
    if(cur) cur.classList.remove('hidden');
    _prevTimer=setInterval(()=>{
      const el=Date.now()/1000;const now=_prevOff+(ctx.currentTime-_prevSt);
      if(cur&&_buf) cur.style.left=((now/_buf.duration)*100)+'%';
      document.getElementById('editorPreviewTime').textContent=`${_fmt(now)} / ${_fmt(_buf.duration)}`;
    },120);
  };
  const previewStop=()=>{try{_prevSrc?.stop();}catch{}; _prevSrc=null; clearInterval(_prevTimer); _prevTimer=null; document.getElementById('waveformCursor')?.classList.add('hidden');};

  /* ══ タグ ══ */
  const _initTagInput = () => {
    const inp=document.getElementById('editorTagsInput'); if(!inp) return;
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===','){
        e.preventDefault(); const v=inp.value.trim().replace(/,/g,'');
        if(v&&!_tags.find(t=>t.name===v)){_tags.push({name:v,color:Tags.defaultColor(v)});_renderEditorTags();}
        inp.value='';
      }
      if(e.key==='Backspace'&&!inp.value&&_tags.length){_tags.pop();_renderEditorTags();}
    });
  };

  const _renderEditorTags = () => {
    const c=document.getElementById('editorTagsDisplay'); if(!c) return;
    c.innerHTML='';
    _tags.forEach(tag=>{
      const ch=Tags.chip(tag,{
        removable:true,
        onRemove:(name)=>{_tags=_tags.filter(t=>t.name!==name);_renderEditorTags();},
        onColorClick:(tagObj)=>App.modal.openTagColor(tagObj,(newTag)=>{ const i=_tags.findIndex(t=>t.name===tagObj.name);if(i>=0){_tags[i]=newTag;_renderEditorTags();} })
      });
      c.appendChild(ch);
    });
  };

  /* ══ サムネイル ══ */
  const setThumbnail=(inp)=>{const f=inp.files[0];if(!f)return;const r=new FileReader();r.onload=e=>{_thumb=e.target.result;_updateThumbUI();};r.readAsDataURL(f);inp.value='';};
  const clearThumbnail=()=>{_thumb=null;_updateThumbUI();};
  const _updateThumbUI=()=>{
    const prev=document.getElementById('thumbPreview'),img=document.getElementById('thumbPreviewImg'),icon=document.getElementById('thumbIcon');
    if(_thumb){img.src=_thumb;img.classList.remove('hidden');icon?.classList.add('hidden');}
    else{img.src='';img.classList.add('hidden');icon?.classList.remove('hidden');}
  };

  /* ══ 適用 ══ */
  const apply = async () => {
    if(!_tid){App.ui.toast('ファイルを選択してください','warning');return;}
    const mode=document.querySelector('input[name="saveMode"]:checked')?.value||'new';
    App.ui.showProcessing('処理中...');
    try {
      const upd=_collectMeta();
      const {vol,key,tempo,ts,te,needsProc}=_collectAudio();

      if(mode==='overwrite'){
        Storage.updateTrack(_tid,upd);
        if(needsProc&&_buf){const b=await _webAudioProcess({vol,key,tempo,ts,te});if(b)await Storage.saveBlob(_tid,b);}
        App.ui.toast('上書き保存しました','success');
      } else {
        const id=Storage.genId(); const d=Storage.get(); const orig=d.tracks[_tid];
        Storage.addTrack({...orig,...upd,id,addedAt:Date.now()});
        if(needsProc&&_buf){const b=await _webAudioProcess({vol,key,tempo,ts,te});if(b)await Storage.saveBlob(id,b);}
        else{const b=Storage.getBlob(_tid);if(b)await Storage.saveBlob(id,b);}
        App.playlists.addToLibrary(id);
        App.ui.toast('新規トラックとして追加しました','success');
      }
      refreshSelect(); App.playlists.renderList();
    }catch(e){App.ui.toast('処理失敗: '+e.message,'error');}
    finally{App.ui.hideProcessing();}
  };

  /* ══ ダウンロード ══ */
  const download = async () => {
    if(!_buf){App.ui.toast('音声が読み込まれていません','warning');return;}
    App.ui.showProcessing('ダウンロード準備中...');
    try{
      const {vol,key,tempo,ts,te,needsProc}=_collectAudio();
      const fmt=document.getElementById('convertFormat')?.value||'wav';
      let blob;
      if(needsProc){
        if(_ffReady) blob=await _ffmpegProcess({vol,key,tempo,ts,te,fmt});
        else blob=await _webAudioProcess({vol,key,tempo,ts,te});
      } else {
        const d=Storage.get();const t=d.tracks[_tid];
        blob=t?.source==='gdrive'?await GDrive.downloadFile(t.driveFileId):Storage.getBlob(_tid);
      }
      if(!blob){App.ui.toast('ダウンロード失敗','error');return;}
      const title=document.getElementById('metaTitle')?.value||'audio';
      const ext=fmt||_mimeExt(blob.type);
      const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=`${title}.${ext}`;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      App.ui.toast('ダウンロード開始','success');
    }catch(e){App.ui.toast('ダウンロード失敗: '+e.message,'error');}
    finally{App.ui.hideProcessing();}
  };

  /* ── 収集 ── */
  const _collectMeta=()=>({title:document.getElementById('metaTitle')?.value.trim(),artist:document.getElementById('metaArtist')?.value.trim(),album:document.getElementById('metaAlbum')?.value.trim(),date:document.getElementById('metaDate')?.value,genre:document.getElementById('metaGenre')?.value.trim(),tags:[..._tags],thumbnailBase64:_thumb});
  const _collectAudio=()=>{
    const vol=parseFloat(document.getElementById('audioVolume')?.value)||100;
    const key=parseInt(document.getElementById('audioKey')?.value)||0;
    const tempo=parseFloat(document.getElementById('audioTempo')?.value)||100;
    const ts=parseFloat(document.getElementById('trimStartVal')?.value)||0;
    const te=parseFloat(document.getElementById('trimEndVal')?.value)||(_buf?.duration||0);
    const needsProc=vol!==100||key!==0||tempo!==100||ts>0.01||(te<(_buf?.duration||0)-0.1);
    return{vol,key,tempo,ts,te,needsProc};
  };

  /* ── Web Audio API 処理 ── */
  const _webAudioProcess=async({vol,key,tempo,ts,te})=>{
    const dur=te-ts; if(dur<=0) throw new Error('無効なトリム範囲');
    const sr=_buf.sampleRate; const offCtx=new OfflineAudioContext(_buf.numberOfChannels,Math.ceil(dur*sr),sr);
    const src=offCtx.createBufferSource(); src.buffer=_buf; src.detune.value=key*100; src.playbackRate.value=tempo/100;
    const gain=offCtx.createGain(); gain.gain.value=vol/100;
    src.connect(gain); gain.connect(offCtx.destination); src.start(0,ts,dur);
    return new Blob([_encWAV(await offCtx.startRendering())],{type:'audio/wav'});
  };

  /* ── FFmpeg 処理 ── */
  const _ffmpegProcess=async({vol,key,tempo,ts,te,fmt})=>{
    const d=Storage.get();const t=d.tracks[_tid];
    let blob=t?.source==='gdrive'?await GDrive.downloadFile(t.driveFileId):Storage.getBlob(_tid);
    if(!blob) return null;
    const ext=_mimeExt(blob.type)||'mp3';
    await _ffmpeg.writeFile(`input.${ext}`,new Uint8Array(await blob.arrayBuffer()));
    const args=['-i',`input.${ext}`];
    if(ts>0||te<_buf.duration) args.push('-ss',String(ts),'-to',String(te));
    const filters=[]; if(vol!==100) filters.push(`volume=${vol/100}`); if(key!==0) filters.push(`asetrate=44100*${Math.pow(2,key/12)},aresample=44100`); if(tempo!==100) filters.push(`atempo=${Math.min(2,Math.max(0.5,tempo/100))}`);
    if(filters.length) args.push('-af',filters.join(','));
    const out=`output.${fmt||'wav'}`;
    args.push(out);
    document.getElementById('ffmpegProgress')?.classList.remove('hidden');
    await _ffmpeg.exec(args);
    const data=await _ffmpeg.readFile(out);
    document.getElementById('ffmpegProgress')?.classList.add('hidden');
    return new Blob([data.buffer],{type:{mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',aac:'audio/mp4'}[fmt]||'audio/wav'});
  };

  const _encWAV=(buf)=>{const nc=buf.numberOfChannels,sr=buf.sampleRate,chs=[];for(let i=0;i<nc;i++)chs.push(buf.getChannelData(i));const il=new Float32Array(chs[0].length*nc);let off=0;for(let i=0;i<chs[0].length;i++)for(let c=0;c<nc;c++)il[off++]=chs[c][i];const dl=il.length*2,ab=new ArrayBuffer(44+dl),dv=new DataView(ab);const ws=(p,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(p+i,s.charCodeAt(i));};ws(0,'RIFF');dv.setUint32(4,36+dl,true);ws(8,'WAVE');ws(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,nc,true);dv.setUint32(24,sr,true);dv.setUint32(28,sr*nc*2,true);dv.setUint16(32,nc*2,true);dv.setUint16(34,16,true);ws(36,'data');dv.setUint32(40,dl,true);let p=44;for(let i=0;i<il.length;i++,p+=2){const v=Math.max(-1,Math.min(1,il[i]));dv.setInt16(p,v<0?v*0x8000:v*0x7FFF,true);}return ab;};
  const _mimeExt=(m)=>({'audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/mp4':'m4a','audio/flac':'flac','audio/x-flac':'flac'}[m]||'wav');
  const _fmt=(s)=>{if(!s||isNaN(s))return'0:00';return`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;};

  return{init,refreshSelect,syncSelect,openFor,loadTrack,updateTrimRegion,previewPlay,previewStop,setThumbnail,clearThumbnail,apply,download};
})();
