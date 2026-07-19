/* ==========================================================================
   Chart × Sim overlay — draws the demo broker's live state (js/sim-broker.js)
   onto the price Chart as lightweight-charts price lines, for the instrument
   currently shown on the chart.

   Drawn:
   - open position: solid line at avg entry (green long / red short), title
     carries side · qty · uPnL.
   - working entry orders: dashed (LMT) / dotted (STP) at their price.
   - bracket exits (reduce-only): green = target, red = stop.

   Owns its own price-line array — it never touches the structural levels or
   day-range lines chart-tab.js manages. Refreshes on quan:sim (account
   mutated), quan:bars (series (re)loaded), and instrument/date switches.
   Purely additive: if the chart isn't booted or the broker is absent, it
   no-ops.
   ========================================================================== */
(function(){
  'use strict';
  const fin=v=>v!=null&&isFinite(v);
  const fmt=(v,d)=>fin(v)?(+v).toFixed(d==null?2:d):'—';
  let lines=[], drawT=null;

  function series(){ try{ const a=window.__chartApi&&window.__chartApi(); return a&&a.series||null; }catch(_){ return null; } }
  function chartInst(){ const el=document.getElementById('instA'); return (el&&el.value)||''; }
  function mult(inst){ if(window.__INSTR_MULT&&fin(window.__INSTR_MULT[inst])) return window.__INSTR_MULT[inst];
    try{ const m=window.QuanInstruments&&window.QuanInstruments.mult(inst); if(fin(m)) return m; }catch(_){} return 1; }
  const money=v=>{ if(!fin(v)) return '—'; const n=v<0?'−':'', a=Math.abs(v);
    return n+'$'+(a>=1e3?(a/1e3).toFixed(1)+'k':a.toFixed(0)); };

  function clear(){ const s=series(); lines.forEach(pl=>{ try{ s&&s.removePriceLine(pl); }catch(_){} }); lines=[]; }

  function draw(){
    const s=series(); if(!s) return;
    clear();
    const B=window.__simBroker; if(!B) return;
    const st=B.state&&B.state(); if(!st) return;
    const inst=chartInst(); if(!inst) return;
    const LS=(window.LightweightCharts&&LightweightCharts.LineStyle)||{Solid:0,Dotted:1,Dashed:2};
    const add=spec=>{ if(!fin(spec.price)) return; try{ lines.push(s.createPriceLine({
      price:spec.price, color:spec.color, lineWidth:spec.width||1, lineStyle:spec.style,
      axisLabelVisible:true, title:spec.title })); }catch(_){} };

    // open position at avg entry
    const p=st.pos&&st.pos[inst];
    if(p&&p.qty!==0&&fin(p.avg)){
      const px=st.marks&&st.marks[inst];
      const u=fin(px)?(px-p.avg)*p.qty*mult(inst):null;
      add({price:p.avg, color:p.qty>0?'#3fae63':'#c14e4e', width:2, style:LS.Solid,
        title:(p.qty>0?'▲ LONG ':'▼ SHORT ')+Math.abs(p.qty)+(u!=null?' · '+money(u):'')});
    }

    // working orders for this instrument
    const orders=(st.orders||[]).filter(o=>o.status==='working'&&o.inst===inst);
    for(const o of orders){
      const isStop=o.type==='STP'||o.type==='STPLMT';
      const price=isStop?o.stop:o.limit;
      let color, title;
      if(o.reduceOnly){                                    // bracket exit leg
        const isTarget=o.type==='LMT';
        color=isTarget?'#3fae63':'#c14e4e';
        title=(isTarget?'target ':'stop ')+(o.side===1?'buy ':'sell ')+o.qty;
      } else {
        color='#c9a24a';                                   // resting entry
        title=(o.side===1?'BUY ':'SELL ')+o.qty+' '+o.type;
      }
      add({price:price, color:color, width:1, style:isStop?LS.Dotted:LS.Dashed, title:title});
    }
    try{ s.applyOptions({}); }catch(_){}                   // nudge autoscale to include our lines
  }

  function queue(){ clearTimeout(drawT); drawT=setTimeout(draw,60); }

  window.__chartSimRedraw=draw;
  window.addEventListener('quan:sim',queue);
  window.addEventListener('quan:bars',queue);   // series (re)loaded — our lines were wiped with setData
  window.addEventListener('quan:instr',queue);
  window.addEventListener('quan:date',queue);
})();
