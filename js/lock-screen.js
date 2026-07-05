(function(){
  const lock=document.getElementById('lock'),book=document.getElementById('bookBtn'),
        hintline=document.getElementById('bookHint'),box=document.getElementById('lockBox'),
        inp=document.getElementById('lockInput'),go=document.getElementById('lockGo'),
        row=document.getElementById('lockRow'),hint=document.getElementById('lockHint');
  function openBox(){ if(box.classList.contains('show'))return;
    book.classList.add('opened'); hintline.classList.add('gone'); box.classList.add('show');
    setTimeout(()=>inp.focus(),380); }
  book.addEventListener('click',openBox);
  function tryUnlock(){
    if(inp.value.trim().toLowerCase()==='password'){
      hint.textContent=''; lock.classList.add('unlocked');
      setTimeout(()=>{ lock.style.display='none'; window.__detResize&&window.__detResize(); },700);
    } else {
      row.classList.remove('bad'); void row.offsetWidth; row.classList.add('bad');
      hint.textContent='Not the word.'; inp.value=''; inp.focus();
    }
  }
  go.addEventListener('click',tryUnlock);
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();tryUnlock();} });
})();