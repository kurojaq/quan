(function(){
  window.__runMatrix=function(){
    var cv=document.getElementById('matrixCanvas'); if(!cv||cv.__run) return; cv.__run=1;
    var ctx=cv.getContext('2d'); var DPR=Math.min(2,window.devicePixelRatio||1);
    cv.width=Math.floor(innerWidth*DPR); cv.height=Math.floor(innerHeight*DPR);
    var glyphs='ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｦｲｸｺﾁﾄﾉﾌﾔﾟ0123456789:.=*+-<>';
    var fs=Math.max(14,Math.round(16*DPR));
    var cols=Math.floor(cv.width/fs);
    var SPEED=0.9;                 // rows advanced per frame (lower = slower fall)
    var drops=new Array(cols), lastRow=new Array(cols), lastCh=new Array(cols);
    for(var i=0;i<cols;i++){drops[i]=Math.random()*-60;lastRow[i]=-9999;lastCh[i]='';}
    var raf=null;
    function draw(){
      ctx.fillStyle='rgba(0,0,0,0.06)'; ctx.fillRect(0,0,cv.width,cv.height);  // trail fade
      ctx.font=fs+'px monospace'; ctx.textBaseline='top';
      for(var i=0;i<cols;i++){
        var row=Math.floor(drops[i]);
        if(row!==lastRow[i] && row>=0){                 // entered a new cell -> draw one char
          var x=i*fs;
          if(lastCh[i]){ ctx.fillStyle='rgba(0,255,70,0.92)'; ctx.fillText(lastCh[i], x, lastRow[i]*fs); } // demote old tip to green
          var ch=glyphs.charAt(Math.floor(Math.random()*glyphs.length));
          ctx.fillStyle='#d8ffd8'; ctx.fillText(ch, x, row*fs);   // bright head
          lastCh[i]=ch; lastRow[i]=row;
        }
        drops[i]+=SPEED;
        if(drops[i]*fs>cv.height && Math.random()>0.985){ drops[i]=0; lastRow[i]=-9999; lastCh[i]=''; }
      }
      raf=requestAnimationFrame(draw);
    }
    cv.style.display='block';
    cv.style.transition='opacity .4s ease'; cv.style.opacity='1';   // cover the gate
    draw();
    setTimeout(function(){ cv.style.transition='opacity 1.2s ease'; cv.style.opacity='0'; },1800); // begin dissolve
    setTimeout(function(){ if(raf)cancelAnimationFrame(raf); cv.style.display='none'; window.__detResize&&window.__detResize(); },3000); // home at 2.5s
  };
})();