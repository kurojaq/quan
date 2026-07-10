(function(){
  var wrap=document.getElementById('brcWrap'),svg=document.getElementById('brcSvg'),ov=document.getElementById('brcOverlay');
  if(!wrap||!svg||!ov) return;
  var read=document.getElementById('brcRead'),title=document.getElementById('brcTitle');
  var boctx=ov.getContext('2d');
  var NS='http://www.w3.org/2000/svg';
  var ML=52,MR=20,MT=20,MB=34,W=900,H=480;
  var st={ten:'CL',poly:true,slope:false,pts:true,B:true,C:true,panx:0,pany:0,zoom:1};
  function median(a){var b=a.slice().sort(function(x,y){return x-y;});var n=b.length;return n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2;}
  function clipArr(y){var m=median(y);var ad=y.map(function(v){return Math.abs(v-m);});var mad=median(ad);var s=3*1.4826*mad;if(!(s>0)){s=Math.max.apply(null,ad)||1;}var lo=m-s,hi=m+s;return y.map(function(v){return v<lo?lo:(v>hi?hi:v);});}
  function polyfit(x,y,deg){var n=x.length,m=deg+1,i,j,k;var V=[];for(i=0;i<n;i++){var row=[],p=1;for(j=0;j<m;j++){row.push(p);p*=x[i];}V.push(row);}
    var ATA=[],ATy=[];for(i=0;i<m;i++){ATA.push(new Array(m).fill(0));ATy.push(0);}
    for(i=0;i<m;i++){for(j=0;j<m;j++){var s=0;for(k=0;k<n;k++)s+=V[k][i]*V[k][j];ATA[i][j]=s;}var sy=0;for(k=0;k<n;k++)sy+=V[k][i]*y[k];ATy[i]=sy;}
    for(i=0;i<m;i++){var pv=i;for(k=i+1;k<m;k++)if(Math.abs(ATA[k][i])>Math.abs(ATA[pv][i]))pv=k;var tr=ATA[i];ATA[i]=ATA[pv];ATA[pv]=tr;var ty=ATy[i];ATy[i]=ATy[pv];ATy[pv]=ty;var piv=ATA[i][i]||1e-12;for(k=i+1;k<m;k++){var f=ATA[k][i]/piv;for(j=i;j<m;j++)ATA[k][j]-=f*ATA[i][j];ATy[k]-=f*ATy[i];}}
    var c=new Array(m).fill(0);for(i=m-1;i>=0;i--){var s2=ATy[i];for(j=i+1;j<m;j++)s2-=ATA[i][j]*c[j];c[i]=s2/(ATA[i][i]||1e-12);}return c;}
  function polyval(c,x){var s=0;for(var i=c.length-1;i>=0;i--)s=s*x+c[i];return s;}
  function crossings(X,F){var r=[];for(var i=1;i<X.length;i++){var a=F[i-1],b=F[i];if(a===0){r.push(X[i-1]);continue;}if((a<0)!==(b<0)){var t=a/(a-b);r.push(X[i-1]+t*(X[i]-X[i-1]));}}return r;}
  function el(n,at){var e=document.createElementNS(NS,n);for(var k in at)e.setAttribute(k,at[k]);return e;}
  function size(){var r=wrap.getBoundingClientRect();W=Math.max(320,Math.round(r.width));H=Math.max(220,Math.round(r.height));svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('width','100%');svg.setAttribute('height','100%');svg.setAttribute('preserveAspectRatio','none');var dpr=window.devicePixelRatio||1;ov.width=W*dpr;ov.height=H*dpr;boctx.setTransform(dpr,0,0,dpr,0,0);}
  function render(){
    while(svg.firstChild)svg.removeChild(svg.firstChild);
    var d=(window.__breachData?window.__breachData():null);
    var rowsA=(d&&d.rowsA)||[],inst=(d&&d.inst)||'NQ';
    if(title)title.textContent='Breach \u00b7 '+inst+' \u00b7 '+st.ten;
    var col=st.ten==='CL'?1:2;
    function series(rows){if(!rows||!rows.length)return null;var x=[],y=[];for(var i=0;i<rows.length;i++){var cx=rows[i][0],cy=rows[i][col];if(cx==null||cy==null||isNaN(cx)||isNaN(cy))continue;x.push(+cx);y.push(+cy);}if(x.length<3)return null;return {x:x,y:y};}
    var sA=series(rowsA);
    if(!sA){read.innerHTML='<span class="empty">&mdash; load a chain to compute breaches</span>';return;}
    function fit(s){if(!s)return null;var yc=clipArr(s.y);return {x:s.x,y:s.y,yc:yc,c:polyfit(s.x,yc,9)};}
    var fA=fit(sA);
    var N=400,X=[];for(var i=0;i<N;i++)X.push(-1+2*i/(N-1));
    function dense(f){if(!f)return null;var P=X.map(function(xx){return polyval(f.c,xx);});var S=X.map(function(xx,ix){var x0=Math.max(0,ix-1),x1=Math.min(N-1,ix+1);return (polyval(f.c,X[x1])-polyval(f.c,X[x0]))/(X[x1]-X[x0]);});return {P:P,S:S};}
    var dA=dense(fA);
    var ys=[];if(dA)ys=ys.concat(dA.P);if(fA)ys=ys.concat(fA.yc);if(st.slope){if(dA)ys=ys.concat(dA.S);}
    var ymin=Math.min.apply(null,ys),ymax=Math.max.apply(null,ys);if(ymin===ymax){ymin-=1;ymax+=1;}var pad=(ymax-ymin)*0.08;ymin-=pad;ymax+=pad;
    var PW=W-ML-MR,PH=H-MT-MB;
    function sx(x){return ML+(x+1)/2*PW*st.zoom+st.panx;}
    function sy(y){return MT+(ymax-y)/(ymax-ymin)*PH+st.pany;}
    var g=el('g',{});svg.appendChild(g);
    var yz=sy(0);if(yz>MT&&yz<MT+PH)g.appendChild(el('line',{x1:ML,y1:yz,x2:ML+PW,y2:yz,stroke:'var(--line)','stroke-dasharray':'3 4'}));
    g.appendChild(el('line',{x1:ML,y1:MT,x2:ML,y2:MT+PH,stroke:'var(--line)'}));
    for(var t=-1;t<=1.0001;t+=0.5){var xx=sx(t);g.appendChild(el('line',{x1:xx,y1:MT+PH,x2:xx,y2:MT+PH+4,stroke:'var(--line)'}));var tl=el('text',{x:xx,y:MT+PH+16,fill:'var(--label)','font-size':10,'text-anchor':'middle'});tl.textContent=t.toFixed(1);g.appendChild(tl);}
    function path(P,color,dash){var dd='';for(var i=0;i<N;i++){dd+=(i?'L':'M')+sx(X[i]).toFixed(1)+' '+sy(P[i]).toFixed(1);}var pe=el('path',{d:dd,fill:'none',stroke:color,'stroke-width':1.6});if(dash)pe.setAttribute('stroke-dasharray',dash);g.appendChild(pe);}
    function drawpts(s,color){for(var i=0;i<s.x.length;i++)g.appendChild(el('circle',{cx:sx(s.x[i]),cy:sy(s.yc[i]),r:2.2,fill:color,opacity:0.7}));}
    var cA='var(--a2)',cBR='var(--breach)';
    if(fA){if(st.poly)path(dA.P,cA,null);if(st.slope)path(dA.S,cA,'5 4');if(st.pts)drawpts(fA,cA);}
    function triangle(x,y,c){var s=5;return el('path',{d:'M'+x+' '+(y-s)+'L'+(x+s)+' '+(y+s)+'L'+(x-s)+' '+(y+s)+'Z',fill:'none',stroke:c,'stroke-width':1.6});}
    function ring(x,y,c){return el('circle',{cx:x,cy:y,r:5,fill:'none',stroke:c,'stroke-width':1.6});}
    var nB=0,nC=0,xDataB=[],xDataC=[];
    if(st.B&&dA){var df=X.map(function(xx,i){return dA.P[i]-dA.S[i];});crossings(X,df).forEach(function(xr){g.appendChild(triangle(sx(xr),sy(polyval(fA.c,xr)),cBR));nB++;xDataB.push(xr);});}
    if(st.C&&fA){var P=X.map(function(xx){return polyval(fA.c,xx);});crossings(X,P).forEach(function(xr){g.appendChild(ring(sx(xr),sy(0),cBR));nC++;xDataC.push(xr);});}
    read.innerHTML='<b>'+inst+'</b> &middot; '+st.ten+' &middot; B(poly&cap;slope) <b>'+nB+'</b> &middot; C(zero) <b>'+nC+'</b>';
    /* ---- crossing times report panel (Qu'an-annotated) ---- */
    (function(){
      var rp=document.getElementById('brcCrossReport');
      if(!rp)return;
      if(!nB&&!nC){rp.style.display='none';return;}
      rp.style.display='';
      /* τ -> ET: |τ| in [0,1] maps the CME session 18:00 ET open -> 17:00 ET close. */
      function cwET(cw){var s=Math.min(1,Math.abs(cw)),m=(1080+Math.round(s*1380))%1440,h=Math.floor(m/60),mi=m%60,ap=h>=12?'PM':'AM',h12=h%12||12;return h12+':'+(mi<10?'0':'')+mi+'\u202f'+ap;}
      function cwFmt(cw){return (cw>=0?'+':'')+cw.toFixed(3);}
      /* Temporal domain from CW arc: Intent(cw<-0.33) | Transit | Transaction(|cw|<0.33) | Realization(cw>0.33) */
      function domain(cw){
        if(cw<-0.67)return{lbl:'INTENT',cl:'brc-di'};
        if(cw<-0.33)return{lbl:'ACCUM',cl:'brc-da'};
        if(cw<0)return{lbl:'NEG-ARC',cl:'brc-dn'};
        if(cw===0)return{lbl:'REALITY',cl:'brc-dr'};
        if(cw<0.33)return{lbl:'TRANS',cl:'brc-dt'};
        if(cw<0.67)return{lbl:'DISTRIB',cl:'brc-dd'};
        return{lbl:'REAL',cl:'brc-dz'};
      }
      /* SOP Phase at crossing: evaluate poly sign & slope sign → PG/PC dominance */
      function sopPhase(x,f,dn,kind){
        if(!f||!dn)return '';
        /* find nearest index */
        var idx=Math.round((x+1)/2*(X.length-1));
        idx=Math.max(0,Math.min(X.length-1,idx));
        var pv=polyval(f.c,x);
        var sv=dn.S[idx];
        if(kind==='C'){
          /* ZC Flag: pressure field null. PG sign at crossing = SOP phase indicator */
          return sv>0?'\u25b2PG':sv<0?'\u25bcPG':'\u00b7';
        }
        if(kind==='B'){
          /* poly\u2229slope: P=S. PGPC dual-phase. PG/PC signal */
          if(Math.abs(sv)<1e-9)return '\u00b7';
          var ratio=Math.abs(pv/(sv||1e-9));
          return ratio>1?'PG\u2192':'PC\u2192';
        }
        return '';
      }
      /* Arc chirality from DIPLTR proxy: crossing density asymmetry neg vs pos arc */
      var negCount=0,posCount=0;
      var all=[];
      xDataB.forEach(function(x){all.push({k:'B',x:x,f:fA,dn:dA});if(x<0)negCount++;else posCount++;});
      xDataC.forEach(function(x){all.push({k:'C',x:x,f:fA,dn:dA});if(x<0)negCount++;else posCount++;});
      all.sort(function(a,b){return a.x-b.x;});
      /* DIPLTR proxy: positive arc dominance = right-handed; negative = left-handed */
      var chiral='ACHIRAL',chiralCl='brc-ch0';
      var dipl=posCount-negCount;
      if(dipl>1){chiral='RIGHT \u21d2 exec-phase';chiralCl='brc-chr';}
      else if(dipl<-1){chiral='LEFT \u21d0 prep-phase';chiralCl='brc-chl';}
      /* crossing type glossary (Qu'an mapping) */
      var typeDesc={A:'slope\u00d7 ·\u202fPG equalization',B:'poly\u2229slope ·\u202fSOPC inflection',C:'zero ·\u202fZC flag'};
      /* build rows */
      var rows=[];
      all.forEach(function(e){
        var kc=e.k==='A'?'brc-ka':e.k==='B'?'brc-kb':'brc-kc';
        var dm=domain(e.x);
        /* SOP phase */
        var sp='';
        try{
          var idx2=Math.round((e.x+1)/2*(X.length-1));
          idx2=Math.max(0,Math.min(X.length-1,idx2));
          if(e.k==='C'&&dA){var sv2=dA.S[idx2];sp=sv2>0.02?'\u25b2':sv2<-0.02?'\u25bc':'\u00b7';}
          else if(e.k==='A'&&fA){var pv2=polyval(fA.c,e.x);sp=pv2>0?'P\u207a':'P\u207b';}
          else if(e.k==='B'&&fA&&dA){var pv3=polyval(fA.c,e.x),sv3=dA.S[idx2];var r=Math.abs(sv3)>1e-9?Math.abs(pv3/sv3):1;sp=r>1?'PG\u21d2':'PC\u21d2';}
        }catch(_){}
        rows.push('<tr>'
          +'<td class="brc-k '+kc+'" title="'+typeDesc[e.k]+'">'+e.k+'</td>'
          +'<td class="brc-cw">'+cwFmt(e.x)+'</td>'
          +'<td class="brc-et">'+cwET(e.x)+'</td>'
          +'<td class="brc-dm '+dm.cl+'">'+dm.lbl+'</td>'
          +(sp?'<td class="brc-sp">'+sp+'</td>':'<td></td>')
          +'</tr>');
      });
      /* chirality + entropy summary line */
      var totalZC=xDataC.length;
      var entropyClass=totalZC<=2?'brc-e0':totalZC<=5?'brc-e1':'brc-e2';
      var zcLabel=totalZC<=2?'clean':'turbulent';
      rp.innerHTML=
        '<div class="brc-rh">Crossing Field \u00b7 '+inst+' \u00b7 '+st.ten
        +'<span class="brc-chiral '+chiralCl+'">'+chiral+'</span>'
        +'<span class="brc-zc '+entropyClass+'"> ZC\u202f'+totalZC+' \u00b7 '+zcLabel+'</span>'
        +'</div>'
        +'<table class="brc-rt"><thead><tr>'
        +'<th class="brc-k">T</th><th class="brc-cw">\u03c4</th><th class="brc-et">ET</th>'
        +'<th class="brc-dm">Domain</th><th class="brc-sp">SOP</th>'
        +'</tr></thead><tbody>'+rows.join('')+'</tbody></table>';
    })();
  }
  window.__breachRefresh=function(){size();render();};
  /* ---- cursor crosshair + τ/ET tooltip ---- */
  (function(){
    /* τ -> ET: |τ| in [0,1] maps the CME session 18:00 ET open -> 17:00 ET close. */
    function cwET(cw){var s=Math.min(1,Math.abs(cw)),m=(1080+Math.round(s*1380))%1440,h=Math.floor(m/60),mi=m%60,ap=h>=12?'PM':'AM',h12=h%12||12;return h12+':'+(mi<10?'0':'')+mi+'\u202f'+ap+'\u202fET';}
    var tip=document.createElement('div');
    tip.id='brcCursorTip';
    tip.style.cssText='position:absolute;display:none;background:rgba(14,14,14,0.94);border:1px solid rgba(149,149,149,0.35);color:var(--fg,#e8e8e8);font:10px/1.6 "SF Mono",Menlo,monospace;padding:3px 10px;border-radius:3px;pointer-events:none;z-index:30;white-space:nowrap;letter-spacing:0.02em;box-shadow:0 2px 8px rgba(0,0,0,0.5);';
    if(wrap.style.position!=='relative'&&wrap.style.position!=='absolute')wrap.style.position='relative';
    wrap.appendChild(tip);
    var NS2='http://www.w3.org/2000/svg';
    var vLine=document.createElementNS(NS2,'line');
    vLine.setAttribute('stroke','var(--label,#949494)');
    vLine.setAttribute('stroke-width','1');
    vLine.setAttribute('stroke-dasharray','3 4');
    vLine.setAttribute('opacity','0.5');
    vLine.setAttribute('pointer-events','none');
    function getCP(e){return e.touches?{x:e.touches[0].clientX,y:e.touches[0].clientY}:{x:e.clientX,y:e.clientY};}
    function onMove(e){
      var rect=svg.getBoundingClientRect();
      var cp=getCP(e);
      var px=(cp.x-rect.left)/rect.width;
      var svgX=px*W;
      var PW2=W-ML-MR;
      var cw=((svgX-ML-st.panx)/(PW2*(st.zoom||1)))*2-1;
      cw=Math.max(-1,Math.min(1,cw));
      vLine.setAttribute('x1',svgX.toFixed(1));
      vLine.setAttribute('x2',svgX.toFixed(1));
      vLine.setAttribute('y1',MT);
      vLine.setAttribute('y2',H-MB);
      if(!svg.contains(vLine))svg.appendChild(vLine);
      var et=cwET(cw);
      var sign=cw>=0?'+':'';
      tip.innerHTML='<span style="opacity:0.55">\u03c4</span>\u2009<b>'+sign+cw.toFixed(3)+'</b><span style="opacity:0.3;margin:0 5px">\u00b7</span><span style="opacity:0.8">'+et+'</span>';
      var tx=(cp.x-rect.left)+14,ty=(cp.y-rect.top)-36;
      if(tx+190>rect.width)tx=(cp.x-rect.left)-196;
      if(ty<4)ty=4;
      tip.style.left=tx+'px';
      tip.style.top=ty+'px';
      tip.style.display='block';
    }
    function onLeave(){
      tip.style.display='none';
      if(svg.contains(vLine))svg.removeChild(vLine);
    }
    svg.addEventListener('mousemove',onMove);
    svg.addEventListener('touchmove',onMove,{passive:true});
    svg.addEventListener('mouseleave',onLeave);
    svg.addEventListener('touchend',onLeave);
  })();
  /* selectors: modeToggle radio groups (data-bt tension, data-bm instrument) */
  var mode=document.getElementById('brcMode');
  if(mode)mode.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-bt')){[].forEach.call(mode.querySelectorAll('[data-bt]'),function(c){c.classList.remove('on');});b.classList.add('on');st.ten=b.getAttribute('data-bt');}
    render();});
  /* legend ltog visibility toggles (data-bk) */
  var leg=document.getElementById('brcLegend');
  if(leg)leg.addEventListener('click',function(e){var sp=e.target.closest('.ltog');if(!sp)return;var k=sp.getAttribute('data-bk');sp.classList.toggle('off');st[k]=!sp.classList.contains('off');render();});
  /* ---- drawing tools on overlay (screen-space, identical to detector) ---- */
  var tool=null,drawing=false,lastPt=null,startPt=null,snap=null,tbN=0;
  function pen(){boctx.strokeStyle='#d9d9d9';boctx.lineWidth=2.4;boctx.lineCap='round';boctx.lineJoin='round';}
  function arrowHead(x1,y1,x2,y2){var a=Math.atan2(y2-y1,x2-x1),len=12,sp=Math.PI/7;boctx.beginPath();boctx.moveTo(x2,y2);boctx.lineTo(x2-len*Math.cos(a-sp),y2-len*Math.sin(a-sp));boctx.moveTo(x2,y2);boctx.lineTo(x2-len*Math.cos(a+sp),y2-len*Math.sin(a+sp));boctx.stroke();}
  function setTool(t){tool=(tool===t)?null:t;var dt=document.getElementById('brcDraw'),lt=document.getElementById('brcLine'),at=document.getElementById('brcArrow');if(dt)dt.classList.toggle('on',tool==='free');if(lt)lt.classList.toggle('on',tool==='line');if(at)at.classList.toggle('on',tool==='arrow');ov.classList.toggle('drawmode',tool!=null);drawing=false;}
  var bD=document.getElementById('brcDraw'),bL=document.getElementById('brcLine'),bAr=document.getElementById('brcArrow'),bC=document.getElementById('brcClearD'),bR=document.getElementById('brcResetV'),bT=document.getElementById('brcText');
  if(bD)bD.addEventListener('click',function(){setTool('free');});
  if(bL)bL.addEventListener('click',function(){setTool('line');});
  if(bAr)bAr.addEventListener('click',function(){setTool('arrow');});
  function clearDraw(){boctx.save();boctx.setTransform(1,0,0,1,0,0);boctx.clearRect(0,0,ov.width,ov.height);boctx.restore();[].forEach.call(wrap.querySelectorAll('.textbox'),function(n){n.remove();});}
  if(bC)bC.addEventListener('click',clearDraw);
  if(bR)bR.addEventListener('click',function(){st.panx=0;st.pany=0;st.zoom=1;render();});
  ov.addEventListener('pointerdown',function(e){if(!tool)return;drawing=true;var r=ov.getBoundingClientRect();var p={x:e.clientX-r.left,y:e.clientY-r.top};lastPt=p;startPt=p;if(tool!=='free'){try{snap=boctx.getImageData(0,0,ov.width,ov.height);}catch(_){snap=null;}}try{ov.setPointerCapture(e.pointerId);}catch(_){}});
  ov.addEventListener('pointermove',function(e){if(!tool||!drawing)return;var r=ov.getBoundingClientRect();var p={x:e.clientX-r.left,y:e.clientY-r.top};pen();if(tool==='free'){boctx.beginPath();boctx.moveTo(lastPt.x,lastPt.y);boctx.lineTo(p.x,p.y);boctx.stroke();lastPt=p;}else{if(snap){boctx.save();boctx.setTransform(1,0,0,1,0,0);boctx.putImageData(snap,0,0);boctx.restore();}boctx.beginPath();boctx.moveTo(startPt.x,startPt.y);boctx.lineTo(p.x,p.y);boctx.stroke();if(tool==='arrow')arrowHead(startPt.x,startPt.y,p.x,p.y);}});
  ov.addEventListener('pointerup',function(){drawing=false;snap=null;});
  ov.addEventListener('pointerleave',function(){drawing=false;snap=null;});
  function addTextBox(){var b=document.createElement('div');b.className='textbox';var off=20+(tbN++%6)*22;b.style.left=off+'px';b.style.top=off+'px';var head=document.createElement('div');head.className='tb-head';var x=document.createElement('span');x.className='tb-x';x.innerHTML='&#10006;';x.title='Delete note';x.addEventListener('click',function(){b.remove();});head.appendChild(x);var ta=document.createElement('textarea');ta.placeholder='note\u2026';b.appendChild(head);b.appendChild(ta);wrap.appendChild(b);
    head.addEventListener('pointerdown',function(e){if(e.target===x)return;e.preventDefault();var wr=wrap.getBoundingClientRect(),bx=b.getBoundingClientRect();var oxx=e.clientX-bx.left,oyy=e.clientY-bx.top;try{head.setPointerCapture(e.pointerId);}catch(_){}var mv=function(ev){var nx=ev.clientX-wr.left-oxx,ny=ev.clientY-wr.top-oyy;nx=Math.max(0,Math.min(wr.width-b.offsetWidth,nx));ny=Math.max(0,Math.min(wr.height-b.offsetHeight,ny));b.style.left=nx+'px';b.style.top=ny+'px';};var up=function(){head.removeEventListener('pointermove',mv);head.removeEventListener('pointerup',up);};head.addEventListener('pointermove',mv);head.addEventListener('pointerup',up);});
    setTimeout(function(){ta.focus();},0);}
  if(bT)bT.addEventListener('click',addTextBox);
  /* svg pan/zoom (only when no draw tool active; overlay is pointer-none then) */
  var pdrag=false,px=0,py=0;
  svg.addEventListener('pointerdown',function(e){pdrag=true;px=e.clientX;py=e.clientY;svg.classList.add('drag');try{svg.setPointerCapture(e.pointerId);}catch(_){}});
  svg.addEventListener('pointermove',function(e){if(!pdrag)return;st.panx+=(e.clientX-px);st.pany+=(e.clientY-py);px=e.clientX;py=e.clientY;render();});
  svg.addEventListener('pointerup',function(){pdrag=false;svg.classList.remove('drag');});
  svg.addEventListener('wheel',function(e){e.preventDefault();if(e.shiftKey)return;var f=e.deltaY<0?1.1:0.9;st.zoom=Math.max(0.3,Math.min(8,st.zoom*f));render();},{passive:false});
  wrap.addEventListener('dblclick',function(){if(tool)return;st.panx=0;st.pany=0;st.zoom=1;render();});
  new ResizeObserver(function(){if(document.getElementById('subBrc').classList.contains('on')){size();render();}}).observe(wrap);
  /* subtab switching */
  var bar=document.querySelectorAll('.subtabbar .subtab');
  [].forEach.call(bar,function(b){b.addEventListener('click',function(){var t=b.getAttribute('data-sub');[].forEach.call(bar,function(x){x.classList.toggle('on',x===b);});var sd=document.getElementById('subDet'),sb=document.getElementById('subBrc');if(sd)sd.classList.toggle('on',t==='det');if(sb)sb.classList.toggle('on',t==='brc');if(t==='brc'){size();render();}else if(window.__detResize)window.__detResize();});});
})();
