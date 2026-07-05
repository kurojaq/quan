window.__pgNativeMode=true;
(async function(){
  var host=document.getElementById('pgHost'); if(!host||host.__pg) return; host.__pg=1;
  host.setAttribute('data-theme', window.__quanCurrentTheme?window.__quanCurrentTheme():'dark');
  var sh=host.attachShadow({mode:'open'});
  var css=await (await fetch('payload/style.css')).text();
  var ui=await (await fetch('payload/ui.html')).text();
  sh.innerHTML='<style>'+css+'<\/style>'+ui;
  window.__pgRoot=sh;
  var scriptText=await (await fetch('payload/script.js')).text();
  var s=document.createElement('script');
  s.textContent=scriptText;
  document.body.appendChild(s);
})();