(function(){
  // ---- operator-only: publish the current Report + Heat Map to Cloudflare KV, and manage client shareable links ----
  var btn=document.getElementById('publishBtn'), panel=document.getElementById('publishPanel');
  if(!btn||!panel) return;
  var curEl=document.getElementById('publishCur'), statusEl=document.getElementById('publishStatus'), nowBtn=document.getElementById('publishNowBtn');
  var labelEl=document.getElementById('pubLabel'), instEl=document.getElementById('pubInstruments'), createBtn=document.getElementById('pubCreateBtn'), listEl=document.getElementById('pubLinkList');

  function $(id){ return document.getElementById(id); }
  function authHeaders(){ var t=window.__authToken&&window.__authToken(); var h={'Content-Type':'application/json'}; if(t)h.Authorization='Bearer '+t; return h; }

  function curInst(){ var e=$('instA'); return (e&&e.value)||''; }
  function curDate(){ var e=$('dayDate'); return (e&&e.value)||''; }

  function setOpen(o){
    panel.style.display=o?'block':'none';
    if(o){ curEl.textContent=(curInst()||'—')+' · '+(curDate()||'—'); populateInstruments(); refreshLinks(); }
  }
  btn.addEventListener('click',function(e){ e.stopPropagation(); setOpen(panel.style.display!=='block'); });
  document.addEventListener('click',function(e){ if(panel.style.display==='block' && !panel.contains(e.target) && e.target!==btn) setOpen(false); });

  function populateInstruments(){
    if(instEl.dataset.filled) return;
    var src=$('instA'); if(!src) return;
    var opts=[].slice.call(src.querySelectorAll('option'));
    instEl.innerHTML=opts.map(function(o){ return '<option value="'+o.value+'">'+(o.textContent||o.value)+'</option>'; }).join('');
    instEl.dataset.filled='1';
  }

  // ---- request the currently-computed heatmap grid from the (possibly not-yet-open) Heat Map iframe ----
  // Force-feeds the frame with the current inst/date chain first (a freshly-booted or
  // stale frame otherwise still holds the baked default), then rejects a mismatched
  // instrument instead of silently publishing the wrong grid to the client.
  function requestHeatmapData(){
    return new Promise(function(resolve){
      if(!window.__heatBoot){ resolve(null); return; }
      window.__heatBoot();
      var frame=document.getElementById('heatFrame');
      if(!frame){ resolve(null); return; }
      var wantInst=curInst();
      try{ if(window.__feedHeatmap) window.__feedHeatmap(true); }catch(_){}
      var reqId=Math.random().toString(36).slice(2);
      var done=false;
      function onMsg(ev){
        if(ev.data && ev.data.type==='quanHeatmapData' && ev.data.reqId===reqId){
          done=true; window.removeEventListener('message',onMsg);
          var data=ev.data.data||null;
          var gotInst=data&&data.meta&&data.meta.inst;
          if(data && wantInst && gotInst && gotInst!==wantInst){
            if(window.__qPipe) window.__qPipe.log('Publish Capture','fail','heat map iframe held '+gotInst+' but publishing '+wantInst+' — grid discarded, not sent to client',{instrument:wantInst});
            resolve(null); return;
          }
          if(data && (!data.rows || !data.rows.length)){
            if(window.__qPipe) window.__qPipe.log('Publish Capture','warn','heat map iframe returned 0 rows for '+wantInst,{instrument:wantInst});
          }
          resolve(data);
        }
      }
      window.addEventListener('message',onMsg);
      function tryReq(){ if(done) return; try{ frame.contentWindow.postMessage({type:'quanGetHeatmap',reqId:reqId},'*'); }catch(_){} }
      var attempts=0;
      var iv=setInterval(function(){
        attempts++; tryReq();
        if(done || attempts>=14){ clearInterval(iv); if(!done){ window.removeEventListener('message',onMsg);
          if(window.__qPipe) window.__qPipe.log('Publish Capture','fail','heat map iframe never responded to quanGetHeatmap',{instrument:wantInst});
          resolve(null); } }
      },400);
      tryReq();
    });
  }

  async function publishNow(){
    var inst=curInst(), date=curDate();
    if(!inst||!date){ statusEl.textContent='pick an instrument + date first'; return; }
    nowBtn.disabled=true; statusEl.textContent='gathering report…';
    var report=null; try{ report=window.__reportData?window.__reportData(inst,date):null; }catch(_){}
    statusEl.textContent='gathering heat map…';
    var heatmap=await requestHeatmapData();
    statusEl.textContent='publishing…';
    try{
      var r=await fetch('/api/publish',{method:'POST',headers:authHeaders(),body:JSON.stringify({inst:inst,date:date,report:report,heatmap:heatmap})});
      var d=await r.json().catch(function(){return {};});
      if(r.ok) statusEl.textContent='published ✓'+(heatmap?'':' (no heat map data)');
      else statusEl.textContent='failed: '+(d.error||r.status);
    }catch(_e){ statusEl.textContent='failed: network error'; }
    nowBtn.disabled=false;
  }
  nowBtn.addEventListener('click',publishNow);

  // ---- public blog: same report snapshot, permanent KV (no TTL), rendered by blog.html ----
  var blogBtn=$('publishBlogBtn');
  async function publishBlog(){
    var inst=curInst(), date=curDate();
    if(!inst||!date){ statusEl.textContent='pick an instrument + date first'; return; }
    var report=null; try{ report=window.__reportData?window.__reportData(inst,date):null; }catch(_){}
    if(!report){ statusEl.textContent='no computed brief for '+inst+' · '+date; return; }
    var clsEl=$('rptClass'), subEl=$('rptSub');
    var classification=(clsEl&&!clsEl.classList.contains('rwait')&&clsEl.textContent.trim())||null;
    var summary=(subEl&&subEl.textContent.trim())||null;
    if(summary==='—') summary=null; // rptSub's em-dash placeholder means "no summary yet"
    blogBtn.disabled=true; statusEl.textContent='publishing to blog…';
    try{
      var r=await fetch('/api/blog',{method:'POST',headers:authHeaders(),body:JSON.stringify({inst:inst,date:date,classification:classification,summary:summary,report:report})});
      var d=await r.json().catch(function(){return {};});
      if(r.ok) statusEl.textContent='on the blog ✓ /blog#/'+(d.slug||'');
      else statusEl.textContent='blog failed: '+(d.error||r.status);
    }catch(_e){ statusEl.textContent='blog failed: network error'; }
    blogBtn.disabled=false;
  }
  if(blogBtn) blogBtn.addEventListener('click',publishBlog);

  // ---- client link management ----
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }
  async function refreshLinks(){
    listEl.textContent='loading…';
    try{
      var r=await fetch('/api/client-tokens',{headers:authHeaders()});
      var d=await r.json().catch(function(){return {};});
      if(!r.ok){ listEl.textContent=d.error||('error '+r.status); return; }
      var rows=d.tokens||[];
      if(!rows.length){ listEl.textContent='no client links yet'; return; }
      listEl.innerHTML=rows.map(function(t){
        // client links live on the branded subdomain when the operator is on the production domain
        // (client.husrihtlaefan.org's root is rewritten to /view.html via _redirects, query preserved)
        var base=/husrihtlaefan\.org$/.test(location.hostname)?'https://client.husrihtlaefan.org/?token=':(location.origin+'/view.html?token=');
        var url=base+t.token;
        return '<div style="border:0.5px solid #2a2a2a;border-radius:8px;padding:7px 8px;">'
          +'<div style="font-weight:600;">'+esc(t.label)+'</div>'
          +'<div style="color:#8a8a8a;margin:2px 0 6px;">'+esc((t.instruments||[]).join(', '))+'</div>'
          +'<div style="display:flex;gap:6px;">'
          +'<button class="ctool pub-copy" data-url="'+esc(url)+'" type="button">Copy link</button>'
          +'<button class="ctool pub-revoke" data-token="'+esc(t.token)+'" type="button">Revoke</button>'
          +'</div></div>';
      }).join('');
      [].slice.call(listEl.querySelectorAll('.pub-copy')).forEach(function(b){
        b.addEventListener('click',function(){ try{ navigator.clipboard.writeText(b.dataset.url); b.textContent='Copied'; setTimeout(function(){b.textContent='Copy link';},1200); }catch(_){} });
      });
      [].slice.call(listEl.querySelectorAll('.pub-revoke')).forEach(function(b){
        b.addEventListener('click',async function(){
          b.disabled=true;
          try{ await fetch('/api/client-tokens?token='+encodeURIComponent(b.dataset.token),{method:'DELETE',headers:authHeaders()}); }catch(_){}
          refreshLinks();
        });
      });
    }catch(_e){ listEl.textContent='network error'; }
  }
  createBtn.addEventListener('click',async function(){
    var label=(labelEl.value||'').trim();
    var instruments=[].slice.call(instEl.selectedOptions).map(function(o){return o.value;});
    if(!label||!instruments.length){ return; }
    createBtn.disabled=true;
    try{
      await fetch('/api/client-tokens',{method:'POST',headers:authHeaders(),body:JSON.stringify({label:label,instruments:instruments})});
      labelEl.value=''; refreshLinks();
    }catch(_e){}
    createBtn.disabled=false;
  });
})();
