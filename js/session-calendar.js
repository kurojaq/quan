(function(){
  // ---- manual per-date session-time override (Full/Early/Closed), layered on top of detector.js's auto-calendar (window.__sessionKind) ----
  var LS_KEY='quan:sessionOverrides';
  function load(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'{}'); }catch(_){ return {}; } }
  var overrides=load();
  window.__sessionOverrides=overrides;
  function persist(){ try{ localStorage.setItem(LS_KEY,JSON.stringify(overrides)); }catch(_){} }
  window.__setSessionOverride=function(dateStr,kind){
    if(!dateStr) return;
    if(!kind){ delete overrides[dateStr]; } else { overrides[dateStr]=kind; }
    persist();
    try{ window.dispatchEvent(new CustomEvent('quan:sessionOverride',{detail:{date:dateStr}})); }catch(_){}
  };
  window.__effectiveSessionKind=function(dateStr){
    if(!dateStr) return 'full';
    if(overrides[dateStr]) return overrides[dateStr];
    return window.__sessionKind ? window.__sessionKind(dateStr) : 'full';
  };
  var EARLY_CLOSE_FRAC=19/23; // CME early closes land ~13:00 ET vs. the normal 17:00 ET close (19h into the 23h session)

  // raw: elapsed fraction of a FULL 23h session (0..1, the value every tab's own sessFrac/sessionT already compute); dateStr: the calendar date raw belongs to
  window.__sessFrac=function(raw,dateStr){
    var kind=window.__effectiveSessionKind(dateStr);
    if(kind==='closed') return 0;
    if(kind==='early') return Math.min(1,raw/EARLY_CLOSE_FRAC);
    return raw;
  };
  // cw: chronometer-watch position in [-1,1]; dateStr optional (omit for plain full-session math). Distinct name so it layers on top of
  // detector.js's existing window.__cwToSec export rather than racing it — detector.js/sop-polar.js/strike-compass.js call this when present.
  window.__sessCwSec=function(cw,dateStr){
    var kind=window.__effectiveSessionKind(dateStr);
    var frac=Math.min(1,Math.abs(cw));
    if(kind==='early') frac=frac*EARLY_CLOSE_FRAC;   // compress: cw=±1 now lands at the early-close instant, not 17:00
    var t=Math.round(64800+frac*82800);
    return ((t%86400)+86400)%86400;
  };

  // ---- header toggle: reflects/edits the override for whatever date is currently selected in the shared date picker ----
  function $(id){ return document.getElementById(id); }
  function syncUI(){ var sel=$('gSessKind'), d=$('dayDate'); if(!sel||!d) return; sel.value=(d.value&&overrides[d.value])||''; }
  var gsk=$('gSessKind'), gd=$('dayDate');
  if(gsk) gsk.addEventListener('change',function(){ var d=gd&&gd.value; if(!d) return; window.__setSessionOverride(d,gsk.value||null); });
  if(gd) gd.addEventListener('change',syncUI);
  window.addEventListener('quan:sessionOverride',syncUI);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',syncUI); else syncUI();
})();
