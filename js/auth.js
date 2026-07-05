/* Supabase-backed login gate.
 *
 * Inert until js/auth-config.js provides a url + anonKey: when unconfigured this
 * file does nothing and the legacy word-lock (js/lock-screen.js) stays in charge.
 * When configured it takes over the #lock overlay as a real email+password login,
 * manages the session, and exposes the access token for authenticated API calls.
 */
(function(){
  var CFG = window.__SUPA || {};
  var enabled = !!(CFG.url && CFG.anonKey);
  window.__authEnabled = enabled;
  window.__authSession = null;
  window.__authToken = function(){ return (window.__authSession && window.__authSession.access_token) || null; };
  if(!enabled) return;                      // unconfigured -> leave the legacy lock in place

  function boot(supa){
    var client = supa.createClient(CFG.url, CFG.anonKey, { auth:{ persistSession:true, autoRefreshToken:true } });
    window.__supa = client;

    var lock   = document.getElementById('lock');
    var box    = document.getElementById('lockBox');
    var wrap   = document.getElementById('lockLoginWrap');
    var emailEl= document.getElementById('lockEmail');
    var pwEl   = document.getElementById('lockInput');
    var go     = document.getElementById('lockGo');
    var hint   = document.getElementById('lockHint');
    var prompt = box ? box.querySelector('.lockprompt') : null;
    var bookHint = document.getElementById('bookHint');

    // switch the overlay from "enter the word" to a real sign-in form
    if(wrap) wrap.style.display = 'flex';
    if(prompt) prompt.textContent = 'Sign in';
    if(go) go.textContent = 'Sign in';
    if(pwEl) pwEl.placeholder = 'password';
    if(bookHint) bookHint.textContent = 'sign in to continue';
    if(box) box.classList.add('show');       // auto-open (no "click the book" step when auth is on)

    function reveal(session){
      window.__authSession = session;
      if(lock){ lock.classList.add('unlocked'); setTimeout(function(){ lock.style.display='none'; window.__detResize&&window.__detResize(); }, 500); }
    }
    function fail(msg){ if(hint) hint.textContent = msg; if(pwEl){ pwEl.value=''; pwEl.focus(); } }

    function signIn(){
      var email=(emailEl&&emailEl.value||'').trim(), pw=(pwEl&&pwEl.value)||'';
      if(!email||!pw){ fail('email and password required'); return; }
      if(hint) hint.textContent = 'signing in…';
      client.auth.signInWithPassword({ email:email, password:pw }).then(function(res){
        if(res.error){ fail(res.error.message||'sign-in failed'); return; }
        reveal(res.data.session);
      }).catch(function(e){ fail(String(e&&e.message||e)); });
    }

    if(go) go.addEventListener('click', signIn);
    if(pwEl) pwEl.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); signIn(); } });
    if(emailEl) emailEl.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); if(pwEl) pwEl.focus(); } });

    // keep the session token fresh for authenticated API calls
    client.auth.onAuthStateChange(function(_evt, session){ window.__authSession = session; });
    // already signed in? skip the gate
    client.auth.getSession().then(function(res){ if(res && res.data && res.data.session) reveal(res.data.session); });

    window.__authLogout = function(){ client.auth.signOut().then(function(){ location.reload(); }); };
  }

  if(window.supabase && window.supabase.createClient){ boot(window.supabase); }
  else {
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload=function(){ if(window.supabase) boot(window.supabase); };
    s.onerror=function(){ var h=document.getElementById('lockHint'); if(h) h.textContent='could not load auth library (offline?)'; };
    document.head.appendChild(s);
  }
})();
