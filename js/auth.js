/* Supabase-backed login gate.
 *
 * Inert until js/auth-config.js provides a url + anonKey: when unconfigured this
 * file does nothing and the legacy word-lock (js/lock-screen.js) stays in charge.
 * When configured it takes over the #lock overlay as a real account system —
 * sign in, create account (self-serve 14-day-trial funnel), reset password, and
 * the emailed-recovery return — manages the session, and exposes the access
 * token for authenticated API calls.
 */
(function(){
  var CFG = window.__SUPA || {};
  var enabled = !!(CFG.url && CFG.anonKey);
  window.__authEnabled = enabled;
  window.__authSession = null;
  window.__authToken = function(){ return (window.__authSession && window.__authSession.access_token) || null; };
  if(!enabled) return;                      // unconfigured -> leave the legacy lock in place

  var MIN_PW = 8;                           // mirrors the Supabase min-length setting

  function boot(supa){
    var client = supa.createClient(CFG.url, CFG.anonKey, {
      auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
    window.__supa = client;

    var lock   = document.getElementById('lock');
    var box    = document.getElementById('lockBox');
    var wrap   = document.getElementById('lockLoginWrap');
    var emailEl= document.getElementById('lockEmail');
    var pwEl   = document.getElementById('lockInput');
    var pw2Row = document.getElementById('lockPw2Row');
    var pw2El  = document.getElementById('lockPw2');
    var pwRow  = document.getElementById('lockRow');
    var go     = document.getElementById('lockGo');
    var hint   = document.getElementById('lockHint');
    var prompt = box ? box.querySelector('.lockprompt') : null;
    var bookHint = document.getElementById('bookHint');
    var sw     = document.getElementById('lockSwitch');
    var toSignup = document.getElementById('lockToSignup');
    var toReset  = document.getElementById('lockToReset');
    var toSignin = document.getElementById('lockToSignin');

    // switch the overlay from "enter the word" to a real account form
    if(wrap) wrap.style.display = 'flex';
    if(sw) sw.style.display = 'flex';
    if(bookHint) bookHint.textContent = 'sign in to continue';
    if(box) box.classList.add('show');       // auto-open (no "click the book" step when auth is on)

    // If we arrived from a password-reset email, Supabase parses the tokens from
    // the URL hash and we must let the user set a NEW password instead of just
    // signing them in. Detect it before the getSession() auto-reveal below.
    var isRecovery = /(?:[#&?])type=recovery/.test(location.hash || '') ||
                     /(?:[#&?])type=recovery/.test(location.search || '');

    var mode = 'signin';                     // signin | signup | reset | recovery

    function setHidden(el, hidden){ if(el) el.style.display = hidden ? 'none' : ''; }

    function applyMode(m){
      mode = m;
      if(hint) hint.textContent = '';
      var showEmail = (m !== 'recovery');
      var showPw    = (m !== 'reset');
      var showPw2   = (m === 'signup' || m === 'recovery');
      setHidden(wrap, !showEmail);
      setHidden(pwEl, !showPw);              // hide the input only — the submit button shares this row
      setHidden(pw2Row, !showPw2);
      if(pwEl) pwEl.setAttribute('autocomplete', (m === 'signin') ? 'current-password' : 'new-password');
      if(m === 'signin'){
        if(prompt) prompt.textContent = 'Sign in';
        if(go) go.textContent = 'Sign in';
        if(pwEl) pwEl.placeholder = 'password';
        if(sw){ setHidden(toSignup,false); setHidden(toReset,false); setHidden(toSignin,true); showSep(true); }
      } else if(m === 'signup'){
        if(prompt) prompt.textContent = 'Create account';
        if(go) go.textContent = 'Start free trial';
        if(pwEl) pwEl.placeholder = 'password (8+ characters)';
        if(sw){ setHidden(toSignup,true); setHidden(toReset,true); setHidden(toSignin,false); showSep(false); }
      } else if(m === 'reset'){
        if(prompt) prompt.textContent = 'Reset password';
        if(go) go.textContent = 'Send reset link';
        if(sw){ setHidden(toSignup,true); setHidden(toReset,true); setHidden(toSignin,false); showSep(false); }
      } else if(m === 'recovery'){
        if(prompt) prompt.textContent = 'Set a new password';
        if(go) go.textContent = 'Update password';
        if(pwEl) pwEl.placeholder = 'new password (8+ characters)';
        if(sw){ setHidden(toSignup,true); setHidden(toReset,true); setHidden(toSignin,true); showSep(false); }
      }
    }
    function showSep(on){ var s = sw && sw.querySelector('.sep'); if(s) s.style.display = on ? '' : 'none'; }

    function reveal(session){
      window.__authSession = session;
      // Save token to sessionStorage for CSV session store and other cross-domain APIs
      if(session && session.access_token) {
        try { sessionStorage.setItem('auth_token', session.access_token); } catch(e){}
      }
      if(lock){ lock.classList.add('unlocked'); setTimeout(function(){ lock.style.display='none'; window.__detResize&&window.__detResize(); }, 500); }
    }
    function fail(msg){ if(hint){ hint.textContent = msg; hint.style.color = ''; } if(pwEl && mode!=='reset'){ pwEl.focus(); } }
    function note(msg){ if(hint){ hint.textContent = msg; hint.style.color = '#7ec8a0'; } }

    function creds(){ return { email:(emailEl&&emailEl.value||'').trim(), pw:(pwEl&&pwEl.value)||'', pw2:(pw2El&&pw2El.value)||'' }; }

    function signIn(){
      var c = creds();
      if(!c.email||!c.pw){ fail('email and password required'); return; }
      if(hint) hint.textContent = 'signing in…';
      client.auth.signInWithPassword({ email:c.email, password:c.pw }).then(function(res){
        if(res.error){ fail(res.error.message||'sign-in failed'); return; }
        reveal(res.data.session);
      }).catch(function(e){ fail(String(e&&e.message||e)); });
    }

    function signUp(){
      var c = creds();
      if(!c.email){ fail('email required'); return; }
      if(c.pw.length < MIN_PW){ fail('password must be at least ' + MIN_PW + ' characters'); return; }
      if(c.pw !== c.pw2){ fail('passwords do not match'); return; }
      if(hint) hint.textContent = 'creating account…';
      client.auth.signUp({
        email:c.email, password:c.pw,
        options:{ emailRedirectTo: location.origin + '/app' }
      }).then(function(res){
        if(res.error){ fail(res.error.message||'sign-up failed'); return; }
        // If email confirmation is OFF, a session comes back and we're in.
        if(res.data && res.data.session){ reveal(res.data.session); return; }
        // Otherwise Supabase sent a confirmation link.
        note('Check your inbox to confirm your email, then sign in.');
        applyMode('signin');
        if(hint){ hint.textContent = 'Confirmation email sent to ' + c.email + '.'; hint.style.color = '#7ec8a0'; }
      }).catch(function(e){ fail(String(e&&e.message||e)); });
    }

    function sendReset(){
      var c = creds();
      if(!c.email){ fail('enter your email to get a reset link'); return; }
      if(hint) hint.textContent = 'sending…';
      client.auth.resetPasswordForEmail(c.email, { redirectTo: location.origin + '/app' })
        .then(function(res){
          if(res.error){ fail(res.error.message||'could not send reset link'); return; }
          note('Reset link sent — check your inbox.');
        }).catch(function(e){ fail(String(e&&e.message||e)); });
    }

    function updatePassword(){
      var c = creds();
      if(c.pw.length < MIN_PW){ fail('password must be at least ' + MIN_PW + ' characters'); return; }
      if(c.pw !== c.pw2){ fail('passwords do not match'); return; }
      if(hint) hint.textContent = 'updating…';
      client.auth.updateUser({ password:c.pw }).then(function(res){
        if(res.error){ fail(res.error.message||'could not update password'); return; }
        // clean the recovery tokens out of the URL, then continue signed-in
        try { history.replaceState({}, '', location.pathname); } catch(_e){}
        client.auth.getSession().then(function(r){ reveal(r && r.data && r.data.session); });
      }).catch(function(e){ fail(String(e&&e.message||e)); });
    }

    function submit(){
      if(mode === 'signup') return signUp();
      if(mode === 'reset')  return sendReset();
      if(mode === 'recovery') return updatePassword();
      return signIn();
    }

    if(go) go.addEventListener('click', submit);
    if(pwEl) pwEl.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); submit(); } });
    if(pw2El) pw2El.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); submit(); } });
    if(emailEl) emailEl.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); if(pwEl && mode!=='reset') pwEl.focus(); else submit(); } });
    if(toSignup) toSignup.addEventListener('click', function(e){ e.preventDefault(); applyMode('signup'); });
    if(toReset)  toReset.addEventListener('click', function(e){ e.preventDefault(); applyMode('reset'); });
    if(toSignin) toSignin.addEventListener('click', function(e){ e.preventDefault(); applyMode('signin'); });

    // keep the session token fresh for authenticated API calls
    client.auth.onAuthStateChange(function(evt, session){
      window.__authSession = session;
      // Sync token to sessionStorage
      if(session && session.access_token) {
        try { sessionStorage.setItem('auth_token', session.access_token); } catch(e){}
      } else {
        try { sessionStorage.removeItem('auth_token'); } catch(e){}
      }
      if(evt === 'PASSWORD_RECOVERY'){ isRecovery = true; applyMode('recovery'); }
    });

    if(isRecovery){
      applyMode('recovery');                 // let them set a new password, do NOT auto-reveal
    } else {
      applyMode('signin');
      // already signed in? skip the gate
      client.auth.getSession().then(function(res){ if(res && res.data && res.data.session) reveal(res.data.session); });
    }

    window.__authLogout = function(){
      try { sessionStorage.removeItem('auth_token'); } catch(e){}
      client.auth.signOut().then(function(){ location.reload(); });
    };
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
