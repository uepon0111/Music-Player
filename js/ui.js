/**
 * ui.js — UI ユーティリティ
 */
const UI = (() => {
  const switchPage = (name) => {
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.getElementById(`page-${name}`)?.classList.add('active');
    document.querySelectorAll('.nav-item,.bottom-nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===name));
    document.getElementById('mobileAuthPopup')?.classList.add('hidden');
    if (name==='logs')   Logs.render();
    if (name==='editor') App.editor.refreshSelect();
  };

  const toast = (msg, type='info', ms=3200) => {
    const icons={info:'fa-circle-info',success:'fa-circle-check',error:'fa-circle-xmark',warning:'fa-triangle-exclamation'};
    const el=document.createElement('div');
    el.className=`toast ${type}`;
    el.innerHTML=`<i class="fa-solid ${icons[type]||icons.info}"></i> ${msg}`;
    document.getElementById('toastContainer')?.appendChild(el);
    setTimeout(()=>{el.style.cssText='opacity:0;transform:translateX(16px);transition:all .28s ease;';setTimeout(()=>el.remove(),280);},ms);
  };

  const showProcessing=(msg='処理中...')=>{document.getElementById('processingMessage').textContent=msg;document.getElementById('processingBar').style.width='0%';document.getElementById('processingOverlay')?.classList.remove('hidden');};
  const hideProcessing=()=>document.getElementById('processingOverlay')?.classList.add('hidden');
  const updateProgress=(p)=>{document.getElementById('processingBar').style.width=p+'%';document.getElementById('processingMessage').textContent=`アップロード中... ${p}%`;};

  const confirm=(m,t)=>App.modal.confirm(m,t);
  const prompt =(m,d,t)=>App.modal.prompt(m,d,t);

  const initNav = () => {
    document.querySelectorAll('.nav-item,.bottom-nav-item').forEach(el=>{
      if (!el.id && el.dataset.page) el.addEventListener('click',()=>switchPage(el.dataset.page));
    });
  };

  return{switchPage,toast,showProcessing,hideProcessing,updateProgress,confirm,prompt,initNav};
})();
