(function(){
  const CFG = {
    endpoint: (window.AlNewsConfig && window.AlNewsConfig.endpoint) ||
      'https://<YOUR_GH_USERNAME>.github.io/asianloopnews/public/news.sample.json',
    autoDelayMs: 5000,
    freshHours: 72,
    snoozeDays: 7,
    localKey: 'al_news_snooze_until'
  };

  let state = { items: [], fresh: false, openedManually: false };
  let els = {};

  // Utilities
  const qs = (s, r=document)=>r.querySelector(s);
  const ce = (t, p={})=>Object.assign(document.createElement(t), p);
  const now = ()=>Date.now();
  const addDays = (d)=> new Date(now() + d*24*60*60*1000);
  const isFresh = (iso)=> (now() - new Date(iso).getTime()) <= CFG.freshHours*3600*1000;
  const fmtRel = (iso)=>{
    // Show the real site (not news.google.com) and unwrap Google News redirect links
function normalizeLink(href){
  try{
    const u = new URL(href);
    if (u.hostname.includes('news.google.com') && u.searchParams.has('url')) {
      return u.searchParams.get('url');
    }
  }catch(_){}
  return href;
}
function hostFrom(href){
  try{ return new URL(href).hostname.replace(/^www\./,''); }catch(_){ return ''; }
}

    const ms = now()-new Date(iso).getTime();
    const h = Math.floor(ms/3600000), d = Math.floor(h/24);
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  };

  // Show the real site (not news.google.com) and unwrap Google News redirect links
function normalizeLink(href){
  try{
    const u = new URL(href);
    if (u.hostname.includes('news.google.com') && u.searchParams.has('url')) {
      return u.searchParams.get('url');
    }
  }catch(_){}
  return href;
}
function hostFrom(href){
  try{ return new URL(href).hostname.replace(/^www\./,''); }catch(_){ return ''; }
}


  

  // Build DOM
  function buildModal(){
    if (els.backdrop) return; // already built
    els.backdrop = ce('div', { className: 'al-news-backdrop al-news-hidden', 'aria-hidden': 'true' });
    els.modal = ce('div', { className: 'al-news-modal al-news-hidden', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'al-news-title' });

    // header
    const hdr = ce('div', { className: 'al-news-header' });
    const logo = ce('img', { className: 'al-news-logo', alt: 'Asianloop', src: (window.AlNewsConfig && window.AlNewsConfig.logo) || 'public/images/asianloop.jpg' });
    
    logo.addEventListener('error', ()=>{
  // Fallback to a simple inline badge if the image 404s
  logo.src = 'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">' +
      '<rect width="32" height="32" rx="8" fill="#0f62fe"/>' +
      '<text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="700" font-size="14" fill="#fff">AL</text>' +
    '</svg>');
});

    const title = ce('div', { className: 'al-news-title', id:'al-news-title', textContent: 'Latest Custody-Metering News' });
    const spacer = ce('div', { className: 'al-news-spacer' });
    const btnClose = ce('button', { className: 'al-news-close', 'aria-label':'Close news', innerHTML: '✕' });
    btnClose.addEventListener('click', close);
    hdr.append(logo, title, spacer, btnClose);

    // body
    els.body = ce('div', { className: 'al-news-body' });
    // footer
    const ftr = ce('div', { className: 'al-news-footer' });
    const label = ce('label');
    const cb = ce('input', { type:'checkbox', id:'al-news-snooze' });
    const cbText = ce('span', { textContent: "Don’t show again this week" });
    label.append(cb, cbText);
    cb.addEventListener('change', (e)=>{
      if (e.target.checked) localStorage.setItem(CFG.localKey, addDays(CFG.snoozeDays).toISOString());
      else localStorage.removeItem(CFG.localKey);
    });
    const trailing = ce('div', { className:'trailing' });
    const btnAll = ce('button', { className:'al-btn', textContent:'View all news' });
    btnAll.addEventListener('click', ()=> window.open((window.AlNewsConfig && window.AlNewsConfig.viewAllUrl) || '#', '_blank'));
    const btnClose2 = ce('button', { className:'al-btn', textContent:'Close' });
    btnClose2.addEventListener('click', close);
    trailing.append(btnAll, btnClose2);
    ftr.append(label, trailing);

    els.modal.append(hdr, els.body, ftr);
    document.body.append(els.backdrop, els.modal);

    // Backdrop / keyboard
    els.backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });
  }

 function render(items){
  els.body.innerHTML = '';
  if (!items || !items.length){
    els.body.append(ce('div', { className:'al-news-meta', textContent:'No new items in the last 3 days.' }));
    return;
  }

  // Top story — unwrap google redirect, show true host
  const top = items[0];
  const topHref = normalizeLink(top.url);
  const topHost = hostFrom(topHref) || (top.sourceName||'');

  const topEl = ce('div', { className:'al-news-top' });
  const meta = ce('div', { className:'al-news-meta', textContent:`${top.category||'Update'} · ${fmtRel(top.publishedAt)} · ${topHost}` });
  const h3 = ce('h3');
  const aTop = ce('a', { href: topHref, target:'_blank', rel:'noopener', textContent: top.title });
  h3.append(aTop);
  const sum = ce('div', { className:'al-news-meta', textContent: top.summary || '' });
  const actions = ce('div', { className:'al-news-actions' });
  const read = ce('button', { className:'al-btn primary', textContent:'Read full' });
  read.addEventListener('click', ()=> window.open(topHref, '_blank'));
  const share = ce('button', { className:'al-btn', textContent:'Share' });
  share.addEventListener('click', ()=>{
    const msg = encodeURIComponent(`${top.title} — ${topHost}\n${topHref}`);
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  });
  actions.append(read, share);
  topEl.append(meta, h3, sum, actions);
  els.body.append(topEl);

  // Other headlines
  const list = ce('div', { className:'al-news-list' });
  items.slice(1, 5).forEach(it=>{
    const href = normalizeLink(it.url);
    const host = hostFrom(href) || (it.sourceName||'');
    const row = ce('div', { className:'al-news-item' });
    const a = ce('a', { href, target:'_blank', rel:'noopener' });
    a.textContent = `• ${it.title} · ${fmtRel(it.publishedAt)} · ${host}`;
    row.append(a);
    list.append(row);
  });
  els.body.append(list);
}



  function open(manual=false){
    state.openedManually = manual;
    els.backdrop.classList.remove('al-news-hidden');
    els.modal.classList.remove('al-news-hidden');
    requestAnimationFrame(()=>{
      els.backdrop.classList.add('is-open');
      els.modal.classList.add('is-open');
    });
  }
  function close(){
    els.backdrop.classList.remove('is-open');
    els.modal.classList.remove('is-open');
    setTimeout(()=>{
      els.backdrop.classList.add('al-news-hidden');
      els.modal.classList.add('al-news-hidden');
    }, 180);
  }

  async function fetchItems(){
    try{
      const res = await fetch(CFG.endpoint, { cache:'no-store' });
      const json = await res.json();
      const items = (json.items||[]).slice(0,5);
      state.items = items;
      state.fresh = items.some(it=> isFresh(it.publishedAt));
      render(items);
    }catch(e){
      state.items = [];
      state.fresh = false;
      render([]);
    }
  }

  function shouldAutoShow(){
    // Your requirement: show unless the user ticked "Don’t show again this week"
    const snoozeUntil = localStorage.getItem(CFG.localKey);
    if (snoozeUntil && new Date(snoozeUntil).getTime() > now()) return false;
    // Only auto-show if there is at least one fresh item (<= 72h)
    return state.fresh;
  }

  // Public API
  window.AlNewsModal = {
    open: ()=> open(true),
    close
  };

  // Boot
  document.addEventListener('DOMContentLoaded', async ()=>{
    buildModal();
    // Allow header link with id="al-latest-news" to open modal any time
    const hook = qs('#al-latest-news');
    if (hook) hook.addEventListener('click', (e)=>{ e.preventDefault(); window.AlNewsModal.open(); });

    await fetchItems();

    // Force-open for testing via ?news=1 or #news
    const url = new URL(window.location.href);
    if (url.searchParams.get('news') === '1' || window.location.hash === '#news'){
      return open(true);
    }

    // Auto-show after delay if allowed
    setTimeout(()=>{ if (shouldAutoShow()) open(false); }, CFG.autoDelayMs);
  });
})();
