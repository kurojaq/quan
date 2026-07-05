(function(){
  // ---- client-facing limited terminal: Heat Map + Chart + Report, fed entirely by /api/view (no chain upload, no Pyodide for Report/Heat Map) ----
  var token=new URLSearchParams(location.search).get('token');
  var labelEl=document.getElementById('vLabel'), errEl=document.getElementById('vError'),
      instSel=document.getElementById('vInst'), dateWrap=document.getElementById('vDates'),
      instA=document.getElementById('instA'), dayDate=document.getElementById('dayDate'),
      reportBody=document.getElementById('vReportBody'), heatFrame=document.getElementById('heatFrame'),
      tabs=document.querySelectorAll('.vtab'), panes={heat:document.getElementById('vPaneHeat'),chart:document.getElementById('vPaneChart'),report:document.getElementById('vPaneReport')};

  var VIEW=null, curInst=null, curDate=null;

  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }

  function snapshotFor(inst,date){
    var arr=(VIEW&&VIEW.snapshots&&VIEW.snapshots[inst])||[];
    for(var i=0;i<arr.length;i++) if(arr[i].date===date) return arr[i];
    return null;
  }
  // chart-tab.js and view-report.js both call this exactly like the main terminal's report.js does —
  // here it's just a lookup into the already-published snapshot instead of a live engine call.
  window.__reportData=function(inst,date){ var s=snapshotFor(inst,date); return s?s.report:null; };

  function feedHeatmap(){
    if(!heatFrame||!heatFrame.contentWindow) return;
    var s=snapshotFor(curInst,curDate);
    var data=s&&s.heatmap;
    if(!data) return;
    var attempts=0;
    var iv=setInterval(function(){
      attempts++;
      try{ heatFrame.contentWindow.postMessage({type:'quanLoadSnapshot',data:data},'*'); }catch(_){}
      if(attempts>=6) clearInterval(iv);
    },350);
  }

  function renderDatePicker(){
    var arr=(VIEW&&VIEW.snapshots&&VIEW.snapshots[curInst])||[];
    dateWrap.innerHTML=arr.map(function(s){
      return '<button class="ctool vdate'+(s.date===curDate?' on':'')+'" data-date="'+esc(s.date)+'" type="button">'+esc(s.date)+'</button>';
    }).join('') || '<span style="color:#8a8a8a;">no published dates for '+esc(curInst)+'</span>';
    [].slice.call(dateWrap.querySelectorAll('.vdate')).forEach(function(b){
      b.addEventListener('click',function(){ setDate(b.dataset.date); });
    });
  }

  function setInst(inst){
    curInst=inst; var arr=(VIEW.snapshots[inst]||[]);
    curDate=arr.length?arr[0].date:null;
    if(instA) instA.value=inst;
    renderDatePicker();
    applyDate();
  }
  function setDate(date){
    curDate=date; if(dayDate) dayDate.value=date;
    renderDatePicker();
    applyDate();
  }
  function applyDate(){
    if(dayDate) dayDate.value=curDate||'';
    try{ window.dispatchEvent(new CustomEvent('quan:instr')); window.dispatchEvent(new CustomEvent('quan:date')); }catch(_){}
    var s=snapshotFor(curInst,curDate);
    window.__viewRenderReport(reportBody, s&&s.report);
    feedHeatmap();
  }

  function setTab(name){
    tabs.forEach(function(t){ t.classList.toggle('on',t.dataset.vtab===name); });
    Object.keys(panes).forEach(function(k){ panes[k].classList.toggle('on',k===name); });
    if(name==='chart' && window.__chartBoot){ window.__chartBoot(); setTimeout(function(){ window.__chartResize&&window.__chartResize(); },40); }
    if(name==='heat') feedHeatmap();
  }
  tabs.forEach(function(t){ t.addEventListener('click',function(){ setTab(t.dataset.vtab); }); });
  instSel.addEventListener('change',function(){ setInst(instSel.value); });

  if(heatFrame) heatFrame.addEventListener('load',function(){ feedHeatmap(); });

  if(!token){ errEl.textContent='This link is missing its access token.'; return; }

  fetch('/api/view?token='+encodeURIComponent(token)).then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); }).then(function(res){
    if(!res.ok){ errEl.textContent=(res.d&&res.d.error)||'This link is invalid or has expired.'; return; }
    errEl.textContent='';
    VIEW=res.d;
    labelEl.textContent=VIEW.label||'Client view';
    instSel.innerHTML=(VIEW.instruments||[]).map(function(i){ return '<option value="'+esc(i)+'">'+esc(i)+'</option>'; }).join('');
    setTab('report');
    if(VIEW.instruments&&VIEW.instruments.length) setInst(VIEW.instruments[0]);
  }).catch(function(){ errEl.textContent='Could not reach the server — try again in a moment.'; });
})();
