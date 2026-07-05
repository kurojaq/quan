(function(){
  // ---- shared "graphs globally" helpers: fullscreen toggle + tools-dropdown collapse, reused by Detector/Strike/Breach/SOP Field ----
  function wireFullscreen(btnId, containerEl, onResize){
    var btn=document.getElementById(btnId); if(!btn||!containerEl) return;
    btn.addEventListener('click',function(){
      if(document.fullscreenElement===containerEl){ if(document.exitFullscreen) document.exitFullscreen(); }
      else if(containerEl.requestFullscreen){ containerEl.requestFullscreen(); }
    });
    document.addEventListener('fullscreenchange',function(){
      var isFull=document.fullscreenElement===containerEl;
      btn.classList.toggle('on',isFull);
      setTimeout(function(){ try{ onResize&&onResize(); }catch(_r){} },60);
    });
  }
  function wireToolsDropdown(triggerId, wrapId){
    var trigger=document.getElementById(triggerId), wrap=document.getElementById(wrapId);
    if(!trigger||!wrap) return;
    trigger.addEventListener('click',function(e){ e.stopPropagation(); wrap.classList.toggle('open'); });
    wrap.addEventListener('click',function(e){ if(e.target!==trigger) e.stopPropagation(); });
    document.addEventListener('click',function(e){ if(!wrap.contains(e.target)) wrap.classList.remove('open'); });
  }
  wireToolsDropdown('detToolsBtn','detToolsWrap');
  wireFullscreen('detFullBtn', document.getElementById('detChartwrap'), function(){ window.__detResize&&window.__detResize(); });
  wireToolsDropdown('skToolsBtn','skToolsWrap');
  wireFullscreen('skFullBtn', document.getElementById('skChartwrap'), function(){ window.__skResize&&window.__skResize(); });
  wireToolsDropdown('brcToolsBtn','brcToolsWrap');
  wireFullscreen('brcFullBtn', document.getElementById('brcWrap'), function(){ window.dispatchEvent(new Event('resize')); });
  wireFullscreen('chartFullBtn', document.getElementById('chartWrap'), function(){ window.__chartResize&&window.__chartResize(); });
  wireFullscreen('polarFullBtn', document.getElementById('polarPanel'), function(){ window.__polarResize&&window.__polarResize(); window.__sopResize&&window.__sopResize(); });
})();