/* ============================================================================
   Scalar & Spectral Field Renderer  —  interchangeable rendering strategies
   ----------------------------------------------------------------------------
   A reusable, data-model-independent visualization framework. It takes a 2-D
   scalar field (a grid of values) and paints it into a canvas region using one
   of several interchangeable strategies. Switching strategy changes ONLY the
   rendering, never the underlying data — the requirement shared by the Price-tab
   (Obj 3-5), Bookmap (item 6) and Chronometric (Obj 6) implementation sheets.

   Strategies:
     heatmap   — discrete colored cells (classic)
     scalar    — bilinear-interpolated continuous scalar field
     spectral  — continuous field through a multi-hue spectral colormap
     contour   — isocontour bands/lines at evenly spaced levels
     gradient  — colored by local gradient magnitude |grad f|
     density   — gaussian-smoothed field (regions of influence)

   Field object:  { rows, cols, data:Float64Array(rows*cols), at(i,j) }
   Public API:    window.ScalarField
   ============================================================================ */
(function(root){
  'use strict';

  // ---- field construction ------------------------------------------------------
  function makeField(rows, cols, fill){
    var data=new Float64Array(rows*cols);
    if(typeof fill==='function'){ for(var i=0;i<rows;i++) for(var j=0;j<cols;j++) data[i*cols+j]=fill(i,j)||0; }
    else if(fill!=null){ data.fill(fill); }
    return {
      rows:rows, cols:cols, data:data,
      at:function(i,j){ return (i<0||j<0||i>=rows||j>=cols)?0:data[i*cols+j]; },
      set:function(i,j,v){ if(i>=0&&j>=0&&i<rows&&j<cols) data[i*cols+j]=v; }
    };
  }

  // ---- normalization -----------------------------------------------------------
  function extent(field){
    var mn=Infinity,mx=-Infinity,d=field.data;
    for(var i=0;i<d.length;i++){ var v=d[i]; if(v<mn)mn=v; if(v>mx)mx=v; }
    if(!isFinite(mn)){ mn=0; mx=1; }
    if(mn===mx) mx=mn+1e-9;
    return { min:mn, max:mx, span:mx-mn };
  }
  function norm(field, v, ext){ ext=ext||extent(field); return (v-ext.min)/ext.span; }

  // ---- bilinear sampling at continuous grid coordinates (gi in [0,rows-1]) -----
  function bilinear(field, gi, gj){
    var r=field.rows-1, c=field.cols-1;
    if(r<0||c<0) return 0;
    gi=Math.max(0,Math.min(r,gi)); gj=Math.max(0,Math.min(c,gj));
    var i0=Math.floor(gi), j0=Math.floor(gj), i1=Math.min(r,i0+1), j1=Math.min(c,j0+1);
    var fi=gi-i0, fj=gj-j0;
    var a=field.at(i0,j0), b=field.at(i0,j1), cc=field.at(i1,j0), d=field.at(i1,j1);
    return a*(1-fi)*(1-fj)+b*(1-fi)*fj+cc*fi*(1-fj)+d*fi*fj;
  }

  // ---- gradient magnitude (central differences in grid space) ------------------
  function gradientMag(field, gi, gj, h){
    h=h||0.5;
    var dx=(bilinear(field,gi,gj+h)-bilinear(field,gi,gj-h))/(2*h);
    var dy=(bilinear(field,gi+h,gj)-bilinear(field,gi-h,gj))/(2*h);
    return Math.sqrt(dx*dx+dy*dy);
  }

  // ---- separable gaussian blur of the field (for the density strategy) ---------
  function gaussianBlur(field, sigma){
    sigma=sigma||1;
    var rad=Math.max(1,Math.round(sigma*2)), ker=[], sum=0, x;
    for(x=-rad;x<=rad;x++){ var w=Math.exp(-(x*x)/(2*sigma*sigma)); ker.push(w); sum+=w; }
    for(x=0;x<ker.length;x++) ker[x]/=sum;
    var R=field.rows, C=field.cols;
    var tmp=makeField(R,C,0), out=makeField(R,C,0), i,j,k,acc;
    for(i=0;i<R;i++) for(j=0;j<C;j++){ acc=0; for(k=-rad;k<=rad;k++) acc+=field.at(i,j+k)*ker[k+rad]; tmp.set(i,j,acc); }
    for(i=0;i<R;i++) for(j=0;j<C;j++){ acc=0; for(k=-rad;k<=rad;k++) acc+=tmp.at(i+k,j)*ker[k+rad]; out.set(i,j,acc); }
    return out;
  }

  // ---- colormaps: t in [0,1] -> [r,g,b] ---------------------------------------
  function lerp(a,b,t){ return a+(b-a)*t; }
  function ramp(stops, t){
    t=Math.max(0,Math.min(1,t));
    for(var i=1;i<stops.length;i++){ if(t<=stops[i][0]){
      var s0=stops[i-1], s1=stops[i], u=(t-s0[0])/((s1[0]-s0[0])||1);
      return [Math.round(lerp(s0[1][0],s1[1][0],u)), Math.round(lerp(s0[1][1],s1[1][1],u)), Math.round(lerp(s0[1][2],s1[1][2],u))];
    }}
    return stops[stops.length-1][1].slice();
  }
  var COLORMAPS={
    thermal:[[0,[6,6,10]],[0.35,[122,20,10]],[0.6,[224,86,12]],[0.82,[246,190,54]],[1,[255,250,220]]],
    spectral:[[0,[10,10,40]],[0.22,[24,72,180]],[0.42,[16,170,168]],[0.6,[120,200,60]],[0.8,[240,190,40]],[1,[220,40,32]]],
    viridis:[[0,[68,1,84]],[0.25,[59,82,139]],[0.5,[33,145,140]],[0.75,[94,201,98]],[1,[253,231,37]]],
    ice:[[0,[4,6,16]],[0.4,[16,52,120]],[0.7,[40,150,210]],[1,[224,244,255]]],
    mono:[[0,[10,10,12]],[1,[236,236,240]]]
  };
  function colormap(name){ var s=COLORMAPS[name]||COLORMAPS.thermal; return function(t){ return ramp(s,t); }; }

  // ---- evenly spaced contour levels -------------------------------------------
  function contourLevels(field, n){
    n=n||6; var e=extent(field), out=[];
    for(var k=1;k<=n;k++) out.push(e.min+e.span*(k/(n+1)));
    return out;
  }

  // ---- main render -------------------------------------------------------------
  // render(ctx, field, opts)
  //   opts.rect     : {x,y,w,h} target pixel region (default whole canvas)
  //   opts.mode     : strategy name (default 'heatmap')
  //   opts.colormap : palette name (default per-mode)
  //   opts.gamma    : intensity gamma (default 1)
  //   opts.levels   : contour count (default 6)
  //   opts.sigma    : density blur sigma (default 1.2)
  //   opts.empty    : draw nothing if true
  function render(ctx, field, opts){
    opts=opts||{}; if(!field||!field.rows||!field.cols) return;
    var rect=opts.rect||{x:0,y:0,w:ctx.canvas.width,h:ctx.canvas.height};
    var mode=opts.mode||'heatmap';
    var cmName=opts.colormap||(mode==='spectral'?'spectral':mode==='gradient'?'viridis':mode==='density'?'ice':'thermal');
    var cm=colormap(cmName), gamma=opts.gamma||1;
    var src=field, ext, sampleField;

    if(mode==='density'){ src=gaussianBlur(field, opts.sigma||1.2); }
    ext=extent(src);
    var gcurve=function(t){ return gamma===1?t:Math.pow(Math.max(0,Math.min(1,t)),gamma); };

    if(mode==='heatmap'){
      var cw=rect.w/field.cols, ch=rect.h/field.rows;
      for(var i=0;i<field.rows;i++) for(var j=0;j<field.cols;j++){
        var t=gcurve(norm(field,field.at(i,j),ext)), rgb=cm(t);
        ctx.fillStyle='rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+')';
        ctx.fillRect(rect.x+j*cw, rect.y+i*ch, Math.ceil(cw)+1, Math.ceil(ch)+1);
      }
      return;
    }

    // continuous strategies: rasterize the region, sampling the field per pixel.
    var W=Math.max(1,Math.floor(rect.w)), H=Math.max(1,Math.floor(rect.h));
    var img=ctx.createImageData(W,H), px=img.data;
    var gmaxCache=null;
    if(mode==='gradient'){ // pre-scan max gradient for normalization
      gmaxCache=1e-9; var step=Math.max(1,Math.floor(W/60));
      for(var yy=0;yy<H;yy+=step) for(var xx=0;xx<W;xx+=step){
        var gi=(yy/(H-1||1))*(src.rows-1), gj=(xx/(W-1||1))*(src.cols-1);
        var g=gradientMag(src,gi,gj); if(g>gmaxCache) gmaxCache=g;
      }
    }
    var levels=(mode==='contour')?contourLevels(src, opts.levels||6):null;
    var lstep=(ext.span)/((opts.levels||6)+1);
    for(var y=0;y<H;y++){
      var fi=(y/(H-1||1))*(src.rows-1);
      for(var x=0;x<W;x++){
        var fj=(x/(W-1||1))*(src.cols-1), val=bilinear(src,fi,fj), t, rgb, aMul=1;
        if(mode==='gradient'){ t=gcurve(Math.min(1,gradientMag(src,fi,fj)/gmaxCache)); rgb=cm(t); }
        else if(mode==='contour'){
          t=gcurve(norm(src,val,ext)); rgb=cm(t);
          var d=Math.abs(((val-ext.min)%lstep)/lstep - 0.5)*2;   // 1 near a level line
          if(d>0.86){ rgb=[245,245,250]; } else { aMul=0.45; }     // faint fill + bright isolines
        } else { // scalar & spectral
          t=gcurve(norm(src,val,ext)); rgb=cm(t);
        }
        var o=(y*W+x)*4;
        px[o]=rgb[0]; px[o+1]=rgb[1]; px[o+2]=rgb[2]; px[o+3]=Math.round(255*aMul);
      }
    }
    ctx.putImageData(img, rect.x|0, rect.y|0);
  }

  root.ScalarField={
    makeField:makeField, extent:extent, norm:norm, bilinear:bilinear,
    gradientMag:gradientMag, gaussianBlur:gaussianBlur, colormap:colormap,
    contourLevels:contourLevels, render:render,
    MODES:['heatmap','scalar','spectral','contour','gradient','density'],
    COLORMAP_NAMES:Object.keys(COLORMAPS)
  };
  if(typeof module!=='undefined'&&module.exports) module.exports=root.ScalarField;

})(typeof window!=='undefined'?window:globalThis);
