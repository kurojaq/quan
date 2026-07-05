// ---- shared XY zoom + drag-pan for custom-canvas charts (generalizes the viewLo/viewHi wheel-zoom pattern already used by
// Detector/Strike Field, filling in the drag-pan piece Detector was scaffolded for but never wired). api uses getter/setter
// callbacks rather than a plain state object so existing closures (plain `let` vars) don't need to be refactored.
// api (required): {getViewLo,setViewLo,getViewHi,setViewHi,invX}
// api (optional, Y axis — pick whichever matches the view's own state shape):
//   zoomY(factor), panY(dyPixels,plotHeightPixels), resetY()
// opts: {wireWheel=true, wireDrag=true, wireReset=true, minSpan, maxSpan, domainLo=-1, domainHi=1, resetLo, resetHi, plotWidth(), plotHeight()}
// domainLo/domainHi bound how far the view can zoom/pan (pass -Infinity/Infinity for an unbounded axis like a strike-price scale)
(function(){
  window.__wireZoomPan=function(canvas,api,redraw,opts){
    if(!canvas||!api) return;
    opts=opts||{};
    var dLo=opts.domainLo!=null?opts.domainLo:-1, dHi=opts.domainHi!=null?opts.domainHi:1;
    var fullSpan=(isFinite(dHi-dLo))?(dHi-dLo):Infinity;
    var minSpan=opts.minSpan!=null?opts.minSpan:(isFinite(fullSpan)?fullSpan*0.02:0.01);
    var maxSpan=opts.maxSpan!=null?opts.maxSpan:fullSpan;
    var rLo=opts.resetLo!=null?opts.resetLo:dLo, rHi=opts.resetHi!=null?opts.resetHi:dHi;
    function clamp(nlo,nhi){
      var w=nhi-nlo;
      if(isFinite(maxSpan)&&w>=maxSpan-1e-9){ nlo=dLo; nhi=dHi; }
      if(isFinite(dLo)&&nlo<dLo){ nhi+=(dLo-nlo); nlo=dLo; }
      if(isFinite(dHi)&&nhi>dHi){ nlo+=(dHi-nhi); nhi=dHi; }
      return [nlo,nhi];
    }
    if(opts.wireWheel!==false){
      canvas.addEventListener('wheel',function(e){
        e.preventDefault();
        var r=canvas.getBoundingClientRect(), mx=e.clientX-r.left;
        if(e.shiftKey){ if(api.zoomY) api.zoomY(e.deltaY<0?1.12:1/1.12); }
        else{
          var cw=api.invX?api.invX(mx):0; var lo=api.getViewLo(), hi=api.getViewHi(); var cur=hi-lo;
          var w=cur*(e.deltaY<0?0.85:1/0.85); w=Math.max(minSpan,isFinite(maxSpan)?Math.min(maxSpan,w):w);
          var nlo=cw-(cw-lo)*(w/cur), nhi=nlo+w;
          var c=clamp(nlo,nhi);
          api.setViewLo(c[0]); api.setViewHi(c[1]);
        }
        redraw();
      },{passive:false});
    }
    if(opts.wireDrag!==false){
      var dragging=false,lastX=0,lastY=0;
      canvas.addEventListener('pointerdown',function(e){ dragging=true; lastX=e.clientX; lastY=e.clientY; canvas.style.cursor='grabbing'; try{canvas.setPointerCapture(e.pointerId);}catch(_){} });
      canvas.addEventListener('pointermove',function(e){
        if(!dragging) return;
        var r=canvas.getBoundingClientRect(); var pw=(opts.plotWidth?opts.plotWidth():r.width)||r.width;
        var lo=api.getViewLo(), hi=api.getViewHi(); var dCw=-((e.clientX-lastX)/pw)*(hi-lo);
        var c=clamp(lo+dCw,hi+dCw);
        api.setViewLo(c[0]); api.setViewHi(c[1]);
        if(api.panY){ var ph=(opts.plotHeight?opts.plotHeight():r.height)||r.height; api.panY(e.clientY-lastY,ph); }
        lastX=e.clientX; lastY=e.clientY;
        redraw();
      });
      function endDrag(){ dragging=false; canvas.style.cursor=''; }
      canvas.addEventListener('pointerup',endDrag);
      canvas.addEventListener('pointerleave',endDrag);
    }
    if(opts.wireReset!==false){
      canvas.addEventListener('dblclick',function(){
        api.setViewLo(rLo); api.setViewHi(rHi); if(api.resetY) api.resetY();
        redraw();
      });
    }
  };
})();
