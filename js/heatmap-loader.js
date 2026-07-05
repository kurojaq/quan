(function(){ var booted=false;
  window.__heatBoot=function(){ if(booted) return; booted=true;
    var mount=document.getElementById("heatMount"); if(!mount) return;
    var f=document.createElement("iframe"); f.id="heatFrame"; f.title="Deep Strike Heat Map";
    f.style.cssText="border:0;display:block;width:100%;height:100%;flex:1 1 auto;min-height:0;background:#1a1a1a;";
    f.src="heatmap.html"; mount.appendChild(f);
  }
})();

(function(){ var bootedB=false;
  window.__heatBootB=function(){ if(bootedB) return; bootedB=true;
    var mount=document.getElementById("heatMountB"); if(!mount) return;
    var f=document.createElement("iframe"); f.id="heatFrameB"; f.title="Deep Strike Heat Map B";
    f.style.cssText="border:0;display:block;width:100%;height:100%;flex:1 1 auto;min-height:0;background:#1a1a1a;";
    f.src="heatmap.html"; mount.appendChild(f);
  }
})();