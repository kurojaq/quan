/* Qu'an reporting-pipeline observability bus (Spec #2, Objective 1).
 *
 * Purpose: eliminate silent failures. Every stage of the CSV -> report -> breach
 * pipeline reports an explicit state (ok / warn / fail) with a human reason and
 * structured metadata (timestamp, instrument, expiration, session, stage, ms,
 * state, stack). Consumers subscribe to the `quan:pipeline` window event; a
 * lightweight diagnostics panel auto-reveals on the first failure so a report
 * that cannot be generated always explains exactly why.
 *
 * Additive and defensive: all call-sites guard with `window.__qPipe && ...`, so
 * this module never becomes a hard dependency of the analytical code.
 */
(function(global){
  'use strict';
  var LOG=[], MAX=600, listeners=[];
  function now(){ try{ return (global.performance&&performance.now)?performance.now():Date.now(); }catch(_){ return Date.now(); } }
  function iso(){ return new Date().toISOString(); }
  function ctxOf(o){ o=o||{}; return {
    instrument:o.instrument||o.inst||null,
    expiration:o.expiration||o.exp||null,
    session:o.session||o.date||null
  }; }

  function emit(entry){
    LOG.push(entry); if(LOG.length>MAX) LOG.shift();
    for(var i=0;i<listeners.length;i++){ try{ listeners[i](entry); }catch(_){} }
    try{ global.dispatchEvent(new CustomEvent('quan:pipeline',{detail:entry})); }catch(_){}
    // structured console line — colour-coded by state
    try{
      var col=entry.state==='fail'?'#e85c5c':(entry.state==='warn'?'#e8b53a':'#5fcf8f');
      var head='[QPIPE '+entry.state.toUpperCase()+'] '+entry.stage
        +(entry.instrument?(' · '+entry.instrument):'')
        +(entry.session?(' · '+entry.session):'')
        +(entry.expiration?(' · exp '+entry.expiration):'')
        +'  ('+entry.ms+'ms)';
      var fn=entry.state==='fail'?console.error:(entry.state==='warn'?console.warn:console.log);
      fn.call(console,'%c'+head,'color:'+col+';font-weight:600', entry.reason||'', entry.meta||'');
      if(entry.stack) console.error(entry.stack);
    }catch(_){}
    if(entry.state==='fail'){ try{ reveal(); }catch(_){} }
  }

  function Run(name, ctx){ this.name=name||'run'; this.ctx=ctxOf(ctx); this.t0=now(); this.stages={}; }
  Run.prototype.stage=function(stageName){ var self=this, s0=now();
    return {
      ok:  function(meta){ return self._log(stageName,'ok',  null,   meta, s0); },
      warn:function(reason,meta){ return self._log(stageName,'warn', reason, meta, s0); },
      fail:function(reason,meta){ return self._log(stageName,'fail', reason, meta, s0); }
    };
  };
  Run.prototype._log=function(stage,state,reason,meta,s0){
    var entry={
      ts:iso(), run:this.name, stage:stage, state:state,
      reason:(reason==null?null:String(reason)),
      instrument:this.ctx.instrument, expiration:this.ctx.expiration, session:this.ctx.session,
      ms:Math.round((now()-(s0!=null?s0:this.t0))*100)/100,
      meta:meta||null,
      stack:(state==='fail'&&meta&&meta.stack)?String(meta.stack):null
    };
    this.stages[stage]=entry; emit(entry); return entry;
  };

  var API={
    /* Begin a run for one (instrument, session) pass. ctx: {instrument, expiration, session}. */
    run:function(name,ctx){ return new Run(name,ctx); },
    /* One-shot log without holding a run handle. */
    log:function(stage,state,reason,ctx,meta){ return new Run('adhoc',ctx)._log(stage,state,reason,meta,null); },
    entries:function(n){ return n?LOG.slice(-n):LOG.slice(); },
    clear:function(){ LOG.length=0; try{ renderPanel(); }catch(_){} },
    on:function(fn){ if(typeof fn==='function') listeners.push(fn); return fn; },
    show:function(){ try{ reveal(); }catch(_){} },
    hide:function(){ try{ if(_panel) _panel.style.display='none'; }catch(_){} },
    /* Validation layer: confirm a parsed dataset carries every required field
     * BEFORE analysis. Returns {ok, present, missing}; reports to the bus. */
    validateChain:function(rows, required, ctx){
      var st=new Run('validation',ctx).stage('Validation Layer');
      required=required||[];
      if(!rows || !rows.length){ st.fail('empty dataset — parser produced 0 rows', {rows:0}); return {ok:false,present:[],missing:required.slice()}; }
      var present=[], missing=[];
      required.forEach(function(f){
        var has=false;
        for(var i=0;i<rows.length;i++){ var v=rows[i]&&rows[i][f]; if(v!=null && !(typeof v==='number' && isNaN(v))){ has=true; break; } }
        (has?present:missing).push(f);
      });
      if(missing.length) st.warn('missing / empty required fields: '+missing.join(', '), {present:present, missing:missing, rows:rows.length});
      else st.ok({present:present, rows:rows.length});
      return {ok:missing.length===0, present:present, missing:missing};
    }
  };
  global.__qPipe=API;

  /* ---------- diagnostics panel (auto-reveals on first failure) ---------- */
  var _panel=null, _body=null, PANEL_KEY='quan_pipe_panel';
  function iconFor(s){ return s==='ok'?'✓':(s==='warn'?'⚠':'✗'); }
  function colFor(s){ return s==='ok'?'#5fcf8f':(s==='warn'?'#e8b53a':'#e85c5c'); }
  function ensurePanel(){
    if(_panel || typeof document==='undefined' || !document.body) return _panel;
    _panel=document.createElement('div');
    _panel.id='qPipePanel';
    _panel.style.cssText='position:fixed;right:14px;bottom:14px;z-index:99999;width:340px;max-height:46vh;'
      +'display:none;flex-direction:column;font:11px ui-monospace,Menlo,monospace;color:#e8e3d6;'
      +'background:rgba(14,16,20,0.96);border:0.5px solid rgba(255,255,255,0.14);border-radius:10px;'
      +'box-shadow:0 8px 30px rgba(0,0,0,0.5);overflow:hidden;';
    var head=document.createElement('div');
    head.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.05);border-bottom:0.5px solid rgba(255,255,255,0.1);';
    head.innerHTML='<b style="letter-spacing:.06em;font-weight:600">PIPELINE DIAGNOSTICS</b>';
    var spacer=document.createElement('span'); spacer.style.flex='1'; head.appendChild(spacer);
    var clr=document.createElement('button'); clr.textContent='clear'; clr.style.cssText=btnCss(); clr.onclick=function(){ API.clear(); };
    var cls=document.createElement('button'); cls.textContent='✕'; cls.style.cssText=btnCss(); cls.onclick=function(){ _panel.style.display='none'; try{ localStorage.setItem(PANEL_KEY,'0'); }catch(_){} };
    head.appendChild(clr); head.appendChild(cls);
    _body=document.createElement('div');
    _body.style.cssText='overflow:auto;padding:6px 4px;';
    _panel.appendChild(head); _panel.appendChild(_body);
    document.body.appendChild(_panel);
    return _panel;
  }
  function btnCss(){ return 'background:rgba(255,255,255,0.08);color:#c9c4b8;border:none;border-radius:6px;padding:3px 7px;font:10px ui-monospace,Menlo,monospace;cursor:pointer;'; }
  function renderPanel(){
    if(!ensurePanel()) return;
    var rows=LOG.slice(-60).reverse(), html='';
    if(!rows.length){ _body.innerHTML='<div style="padding:10px;color:#8a877e">no pipeline events yet</div>'; return; }
    for(var i=0;i<rows.length;i++){ var e=rows[i];
      html+='<div style="display:flex;gap:7px;padding:4px 8px;border-bottom:0.5px solid rgba(255,255,255,0.05)">'
        +'<span style="color:'+colFor(e.state)+';flex:none;width:12px;text-align:center">'+iconFor(e.state)+'</span>'
        +'<div style="min-width:0;flex:1">'
        +'<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b>'+esc(e.stage)+'</b>'
        +'<span style="color:#8a877e"> '+esc([e.instrument,e.session].filter(Boolean).join(' · '))+'</span></div>'
        +(e.reason?('<div style="color:'+colFor(e.state)+';white-space:normal;word-break:break-word">'+esc(e.reason)+'</div>'):'')
        +'</div>'
        +'<span style="color:#65625b;flex:none">'+e.ms+'ms</span>'
        +'</div>';
    }
    _body.innerHTML=html;
  }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function reveal(){ if(!ensurePanel()) return; _panel.style.display='flex'; renderPanel(); }

  // keep the panel live; only paint when it exists/visible
  listeners.push(function(){ try{ if(_panel && _panel.style.display!=='none') renderPanel(); }catch(_){} });
  if(typeof window!=='undefined'){
    window.addEventListener('DOMContentLoaded',function(){
      try{ if(localStorage.getItem(PANEL_KEY)==='1') reveal(); }catch(_){}
    });
    // Alt+Shift+P toggles the panel for manual inspection
    window.addEventListener('keydown',function(e){
      if(e.altKey && e.shiftKey && (e.key==='P'||e.key==='p')){
        ensurePanel(); var vis=_panel.style.display!=='none'; _panel.style.display=vis?'none':'flex';
        try{ localStorage.setItem(PANEL_KEY, vis?'0':'1'); }catch(_){}
        if(!vis) renderPanel();
      }
    });
  }
})(typeof window!=='undefined'?window:globalThis);
