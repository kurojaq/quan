(function(){
  // ---- dark/light theme toggle, applied globally; propagated to the Heat Map iframe(s) via postMessage since srcdoc iframes don't reliably share localStorage ----
  var KEY='quanTheme';
  var btn=document.getElementById('themeToggleBtn');
  function broadcast(theme){
    ['heatFrame','heatFrameB'].forEach(function(id){
      var f=document.getElementById(id);
      if(f&&f.contentWindow){ try{ f.contentWindow.postMessage({type:'quanTheme',theme:theme},'*'); }catch(_){} }
    });
    var pg=document.getElementById('pgHost'); if(pg) pg.setAttribute('data-theme',theme);
  }
  function apply(theme){
    document.documentElement.setAttribute('data-theme',theme);
    try{ localStorage.setItem(KEY,theme); }catch(_){}
    if(btn) btn.textContent=(theme==='light'?'◑ Light':'◐ Dark');
    broadcast(theme);
  }
  window.__quanCurrentTheme=function(){ return document.documentElement.getAttribute('data-theme')||'dark'; };
  var saved='dark'; try{ saved=localStorage.getItem(KEY)||'dark'; }catch(_){}
  apply(saved);
  // #pgHost doesn't exist yet at this point in document parsing -- retry once the whole document (including the Payload Generator's host element) is ready
  document.addEventListener('DOMContentLoaded',function(){ broadcast(document.documentElement.getAttribute('data-theme')||'dark'); });
  if(btn) btn.addEventListener('click',function(){
    var cur=document.documentElement.getAttribute('data-theme')||'dark';
    apply(cur==='dark'?'light':'dark');
  });
  // a Heat Map iframe is a fresh document each time it boots, so it asks us for the current theme rather than relying on a one-time broadcast
  window.addEventListener('message',function(ev){
    if(ev.data&&ev.data.type==='quanThemeRequest'){
      var cur=document.documentElement.getAttribute('data-theme')||'dark';
      try{ ev.source.postMessage({type:'quanTheme',theme:cur},'*'); }catch(_){}
    }
  });
})();