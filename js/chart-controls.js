(function(){
  // ---- shared "graphs globally" helpers: fullscreen toggle + tools-dropdown collapse, reused by Detector/Strike/Breach/Chart/Compass/SOP Field ----
  // Uses a CSS-class "maximize" (position:fixed over the viewport) rather than the real
  // Fullscreen API: iOS Safari doesn't support requestFullscreen() on arbitrary elements
  // (only <video>/<iframe>), so a single CSS-based path keeps mobile and desktop identical.
  function wireFullscreen(btnId, containerEl, onResize){
    var btn=document.getElementById(btnId); if(!btn||!containerEl) return;
    function setMaxed(on){
      containerEl.classList.toggle('maxed', on);
      document.body.classList.toggle('has-maxed', on);
      btn.classList.toggle('on', on);
      setTimeout(function(){ try{ onResize&&onResize(); }catch(_r){} },60);
    }
    btn.addEventListener('click',function(){ setMaxed(!containerEl.classList.contains('maxed')); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&containerEl.classList.contains('maxed')) setMaxed(false); });
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
  wireFullscreen('compassFullBtn', document.getElementById('compassChartwrap'), function(){ window.__compassResize&&window.__compassResize(); });
  wireFullscreen('polarFullBtn', document.getElementById('polarPanel'), function(){ window.__polarResize&&window.__polarResize(); window.__sopResize&&window.__sopResize(); });
})();