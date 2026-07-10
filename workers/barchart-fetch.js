/* barchart-fetch.js — standalone Cloudflare Worker (Phase 5).
 *
 * Automates the daily Barchart option-chain CSV downloads that the terminal
 * otherwise expects you to pull by hand. Runs headless on Cloudflare's
 * *Browser Rendering* ("Browser Run") platform on a Cron Trigger: it logs into
 * barchart.com, downloads a CSV for every contract you've toggled ON in the
 * terminal, renames each file to the app's `<inst>...exp-MM_DD_YY.csv`
 * convention, and stores it in R2 + a KV index. The terminal's Auto-pull panel
 * (js/auto-pull.js) then ingests new files on load — no manual upload.
 *
 * Why a separate Worker (not a Pages Function):
 *   • Pages can't run scheduled functions or bind Browser Rendering.
 *   • Browser Rendering needs `nodejs_compat` + a `browser` binding + the
 *     @cloudflare/puppeteer package, which wrangler bundles at deploy time.
 *
 * ── Auth model (per the operator's choice: FULL CLOUD LOGIN) ────────────────
 *   Credentials live as Worker secrets (BARCHART_USER / BARCHART_PASS). To keep
 *   Barchart's bot-protection from seeing a fresh login on every run (the thing
 *   datacenter IPs get challenged on), we cache the session cookies in KV after
 *   a successful login and REUSE them. We only re-login when a cheap session
 *   probe says the cookie is dead. Every failure is written loudly to
 *   `autopull:status` so a silent bot-challenge shows up as a bad run in the UI
 *   instead of just producing empty days.
 *
 * ── First-run calibration (READ THIS) ──────────────────────────────────────
 *   Barchart's DOM/URLs drift and I can't see the authed site from the repo, so
 *   the site-specific selectors + URL templates are ISOLATED in the BC config
 *   block below (login form, Download button, tab params) and in
 *   resolveExpiryPage() (which drives Barchart's "Options Type"/"Week" dropdowns
 *   to land on the right expiry). After the first deploy, do ONE watched run:
 *     wrangler browser create --keepAlive 600 -c workers/wrangler-barchart.toml
 *     wrangler browser view          # watch the login + a download live
 *   Adjust BC.* / resolveExpiryPage to match what you see, redeploy.
 *
 * Deploy / secrets / bindings: see CLOUDFLARE_SETUP.md §9.
 * A GET to the Worker runs one pass on demand (handy while calibrating).
 */

import puppeteer from '@cloudflare/puppeteer';

/* ── Site-specific config — the ONLY part that tends to need calibration ──── */
const BC = {
  loginUrl: 'https://www.barchart.com/login',
  // A page that requires auth; if we land here logged-out we know the cookie died.
  sessionProbeUrl: 'https://www.barchart.com/my/quotes',
  // Login form selectors (Barchart's standard email/password form).
  sel: {
    email: 'input[name="email"]',
    password: 'input[name="password"]',
    submit: 'button[type="submit"], form button.login-button',
    // Presence of this on the probe page ⇒ we are logged IN.
    loggedInMarker: '[data-ng-if="user.isLoggedIn"], .bc-user-nav, a[href="/logout"]',
    // The "⤓ download" control on an options page (captureDownload also has a
    // text-based fallback if this selector misses).
    download: 'a.bc-download, button[data-bc-download], a[href*="download"]',
    // The expiry is chosen by two CUSTOM (non-<select>) dropdowns above the chain
    // table: "Options Type" = the day-of-week series ("Monday Weekly Options"),
    // and "Week N: Mon YYYY". resolveExpiryPage() drives them by visible text
    // (openTrigger/clickOption), so there are no fixed ids to keep here.
  },
  // Query params per tab, copied from the real page URLs.
  tabParams: {
    options: '?moneyness=allRows&futuresOptionsView=split&futuresOptionsTime=intraday',
    'volatility-greeks': '?moneyness=allRows&futuresOptionsView=split',
  },
  // The response we capture after clicking Download. Barchart streams the CSV
  // either as text/csv or via a URL containing one of these fragments.
  csvUrlHints: ['download', 'options', '.csv', 'get?', 'proxies/core-api'],
  // A realistic desktop UA reduces trivial bot flags.
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  navTimeoutMs: 45000,
  downloadTimeoutMs: 30000,
};

/* ── KV keys (all under the autopull: prefix in the shared QUAN_PUBLISH KV) ── */
const K = {
  selection: 'autopull:selection', // [{ symbol, expiry:"MM_DD_YY", kind:"chain"|"greeks", url, on }]
  cookies: 'autopull:cookies', // cached session cookies (JSON array from page.cookies())
  index: 'autopull:index', // { "<r2key>": { inst, expiry, kind, bytes, fetched } }
  status: 'autopull:status', // { started, finished, ok, fail, jobs:[{id, ok, error, bytes}] }
};

const nowISO = () => new Date().toISOString();

/* Build the app-convention filename/R2 key for a job, e.g. esm25-exp-01_16_26.csv.
   parseChain() in js/compass.js keys the instrument off `^([a-z]{2})[a-z]?\d`
   (so the name must START with the contract SYMBOL, e.g. "esm25", not "es-"),
   reads the expiry off `exp-MM_DD_YY`, and treats a name containing "greek" as a
   Greeks file — so we encode all three into the name. */
function r2KeyFor(job) {
  const sym = String(job.symbol || 'xx0').toLowerCase().replace(/[^a-z0-9]/g, '');
  const exp = String(job.expiry || '').replace(/[^0-9_]/g, '');
  const tag = job.kind === 'greeks' ? '-greeks' : '';
  return `autopull/${sym}${tag}-exp-${exp}.csv`;
}

async function readJSON(env, key, fallback) {
  if (!env.QUAN_PUBLISH) return fallback;
  try {
    const raw = await env.QUAN_PUBLISH.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}
async function writeJSON(env, key, val, ttlSec) {
  if (!env.QUAN_PUBLISH) return;
  const opts = ttlSec ? { expirationTtl: ttlSec } : undefined;
  try {
    await env.QUAN_PUBLISH.put(key, JSON.stringify(val), opts);
  } catch (_) {}
}

/* ── Auth: reuse cached cookies, log in only when the session is dead ──────── */

async function applyCachedCookies(page, env) {
  const cookies = await readJSON(env, K.cookies, null);
  if (Array.isArray(cookies) && cookies.length) {
    try {
      await page.setCookie(...cookies);
      return true;
    } catch (_) {}
  }
  return false;
}

async function isLoggedIn(page) {
  try {
    await page.goto(BC.sessionProbeUrl, { waitUntil: 'domcontentloaded', timeout: BC.navTimeoutMs });
    return (await page.$(BC.sel.loggedInMarker)) !== null;
  } catch (_) {
    return false;
  }
}

async function login(page, env) {
  if (!env.BARCHART_USER || !env.BARCHART_PASS) {
    throw new Error('BARCHART_USER / BARCHART_PASS secrets not set');
  }
  await page.goto(BC.loginUrl, { waitUntil: 'domcontentloaded', timeout: BC.navTimeoutMs });
  await page.waitForSelector(BC.sel.email, { timeout: BC.navTimeoutMs });
  await page.type(BC.sel.email, env.BARCHART_USER, { delay: 25 });
  await page.type(BC.sel.password, env.BARCHART_PASS, { delay: 25 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: BC.navTimeoutMs }).catch(() => {}),
    page.click(BC.sel.submit),
  ]);
  // Confirm and persist the fresh cookies for next run.
  if (!(await isLoggedIn(page))) {
    throw new Error('login submitted but session not established (bot-challenge or 2FA?)');
  }
  const cookies = await page.cookies();
  await writeJSON(env, K.cookies, cookies);
  return true;
}

async function ensureSession(page, env) {
  await applyCachedCookies(page, env);
  if (await isLoggedIn(page)) return 'reused';
  await login(page, env);
  return 'login';
}

/* ── Resolve the right expiry by DATE, then download its CSV ────────────────── */

const tabUrl = (future, tab) =>
  `https://www.barchart.com/futures/quotes/${future}/${tab}${BC.tabParams[tab] || ''}`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayName = (iso) => WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];
const mmddyy = (iso) => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y.slice(2)}`; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Read the "... expiration on MM/DD/YY" the page prints for the shown expiry.
function readExpiryDate(page) {
  return page.evaluate(() => {
    const m = (document.body.innerText || '').match(/expiration on (\d{1,2}\/\d{1,2}\/\d{2})/i);
    return m ? m[1] : null;
  });
}

/* ── Driving Barchart's custom (non-<select>) dropdowns ─────────────────────
   "Options Type" and "Week N" are fancy widgets, not native <select>s: a
   trigger element shows the current value, and clicking it reveals a menu of
   option rows. We find the trigger by its visible text pattern, tag+click it,
   then click the option row by its label — no fixed class names, so it survives
   restyles. A native-<select> fast path is kept in case a build ever ships one.
   These two functions are the calibration surface if Barchart changes the UI. */

const DROP_SEL = 'button,a,li,span,div,[role="button"],[role="option"]';

// Open the smallest visible element whose trimmed text matches `reSource`,
// tagging it so the option click can exclude the trigger itself.
function openTrigger(page, reSource) {
  return page.evaluate((reSource, sel) => {
    const re = new RegExp(reSource, 'i');
    let best = null, bestLen = Infinity;
    for (const el of document.querySelectorAll(sel)) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || !re.test(t) || t.length >= bestLen) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { best = el; bestLen = t.length; }
    }
    document.querySelectorAll('[data-ap-trigger]').forEach((e) => e.removeAttribute('data-ap-trigger'));
    if (!best) return false;
    best.setAttribute('data-ap-trigger', '1');
    best.click();
    return true;
  }, reSource, DROP_SEL);
}

// Click the smallest visible option row (not the trigger) whose text matches.
function clickOption(page, reSource) {
  return page.evaluate((reSource, sel) => {
    const re = new RegExp(reSource, 'i');
    let best = null, bestLen = Infinity;
    for (const el of document.querySelectorAll(sel)) {
      if (el.hasAttribute('data-ap-trigger')) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || !re.test(t) || t.length >= bestLen) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { best = el; bestLen = t.length; }
    }
    if (!best) return false;
    best.click();
    return true;
  }, reSource, DROP_SEL);
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Native-<select> fast path, else open the custom trigger + click the option.
async function setDropdown(page, triggerRe, optionLabel) {
  const native = await page.evaluate((label) => {
    const want = label.toLowerCase();
    for (const s of document.querySelectorAll('select')) {
      const opt = Array.from(s.options).find((o) => (o.textContent || '').trim().toLowerCase().includes(want));
      if (opt) { s.value = opt.value; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    }
    return false;
  }, optionLabel);
  if (native) return true;
  if (!(await openTrigger(page, triggerRe))) return false;
  await wait(600);
  return clickOption(page, escRe(optionLabel));
}

// Open the "Week N" dropdown and click its i-th option row (0-based, top→bottom).
async function setWeekByIndex(page, i) {
  if (!(await openTrigger(page, 'Week\\s*\\d'))) return false;
  await wait(600);
  return page.evaluate((i, sel) => {
    const rows = Array.from(document.querySelectorAll(sel)).filter((el) => {
      if (el.hasAttribute('data-ap-trigger')) return false;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^week\s*\d/i.test(t) || t.length > 30) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const uniq = [], seen = new Set();
    for (const el of rows) { const k = Math.round(el.getBoundingClientRect().top); if (seen.has(k)) continue; seen.add(k); uniq.push(el); }
    if (i >= uniq.length) return false;
    uniq[i].click();
    return true;
  }, i, DROP_SEL);
}

// Land on the expiry page for job.date by driving Barchart's own controls: the
// "Options Type" dropdown IS the day-of-week ("Monday Weekly Options"), and the
// page prints "expiration on MM/DD/YY" which we confirm against the target
// (stepping the Week dropdown if the date rolls into a later week). Barchart owns
// the date→symbol mapping, so this stays correct across weekly/monthly rolls.
async function resolveExpiryPage(page, job) {
  const tab = job.tab === 'volatility-greeks' ? 'volatility-greeks' : 'options';
  const weekday = weekdayName(job.date);
  const target = mmddyy(job.date);

  await page.goto(tabUrl(job.future, tab), { waitUntil: 'domcontentloaded', timeout: BC.navTimeoutMs });
  await wait(2500); // let the SPA render the toolbar dropdowns

  if (!(await setDropdown(page, 'Weekly Options|Monthly Options|Serial|Quarterly', `${weekday} Weekly Options`))) {
    throw new Error(`could not set Options Type to "${weekday} Weekly Options" on ${job.future} ${tab}`);
  }
  await wait(2000);
  if ((await readExpiryDate(page)) === target) return;

  // Date rolled into a later week (e.g. Fri→Mon greeks): step the Week dropdown.
  for (let i = 1; i < 6; i++) {
    if (!(await setWeekByIndex(page, i))) break;
    await wait(2000);
    if ((await readExpiryDate(page)) === target) return;
  }
  const shown = await readExpiryDate(page);
  if (shown !== target) {
    throw new Error(`expiry ${target} not found (showing ${shown || '?'}) for ${job.future} ${weekday} ${tab}`);
  }
}

// Arm the response interceptor, then click Download; resolves with the CSV text.
async function captureDownload(page) {
  const csvBody = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('download timed out')), BC.downloadTimeoutMs);
    const onResponse = async (resp) => {
      try {
        const url = resp.url();
        const ct = (resp.headers()['content-type'] || '').toLowerCase();
        const looksCsv =
          ct.includes('csv') || ct.includes('text/plain') || BC.csvUrlHints.some((h) => url.includes(h));
        if (!looksCsv) return;
        const text = await resp.text();
        // Guard against catching an HTML error page that merely matched a hint.
        if (!/[,\t].*[,\t]/.test(text.split('\n')[0] || '')) return;
        clearTimeout(timer);
        page.off('response', onResponse);
        resolve(text);
      } catch (_) {
        /* keep listening */
      }
    };
    page.on('response', onResponse);
  });
  await page.waitForSelector(BC.sel.download, { timeout: BC.navTimeoutMs }).catch(() => {});
  const btn = await page.$(BC.sel.download);
  if (btn) {
    await btn.click().catch(() => {});
  } else {
    // Fallback: click the element whose visible text is "download" (the ⤓ link).
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('a,button')).find(
        (e) => (e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === 'download'
      );
      if (el) el.click();
    });
  }
  return csvBody;
}

// Debug aid: dump the toolbar markup around the expiry dropdowns so a failed run
// reveals the exact widget structure (for calibrating openTrigger/clickOption)
// without needing an interactive `wrangler browser view` session.
async function captureToolbarHtml(page) {
  try {
    return await page.evaluate(() => {
      const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + '…[truncated]' : s || '');
      const out = [];
      const seen = new Set();
      // Leaf-ish elements that read like a dropdown trigger; climb to a container.
      const trigs = Array.from(document.querySelectorAll('*')).filter((el) => {
        if (el.children.length > 6) return false;
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return /Weekly Options|Monthly Options|Week\s*\d|Side-by-Side|Show All/i.test(t) && t.length < 60;
      });
      for (const el of trigs) {
        let c = el;
        for (let i = 0; i < 3 && c.parentElement; i++) c = c.parentElement;
        const html = c.outerHTML || '';
        const key = html.slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trunc(html, 1500));
        if (out.length >= 5) break;
      }
      // Any currently-open menu/listbox (in case a trigger was mid-open on failure).
      const menus = Array.from(
        document.querySelectorAll('[role="listbox"],[role="menu"],[class*="dropdown"],[class*="menu"]')
      ).filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 40; });
      for (const el of menus.slice(0, 3)) out.push('OPEN-MENU: ' + trunc(el.outerHTML || '', 1200));
      return out.join('\n\n---\n\n') || '(no toolbar elements matched)';
    });
  } catch (e) {
    return `capture failed: ${e.message}`;
  }
}

// Debug aid for a login failure: tells us whether our form selectors matched,
// whether the page looks like a bot-challenge/2FA, and where we ended up — so we
// can distinguish "selectors wrong" (fixable) from "datacenter IP challenged".
async function captureLoginDebug(page) {
  try {
    return await page.evaluate((sel) => {
      const has = (s) => { try { return !!document.querySelector(s); } catch (_) { return false; } };
      const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
      const hints = [
        'captcha', 'recaptcha', 'hcaptcha', 'press & hold', 'are you a robot', 'are you human',
        'unusual activity', 'verify', 'verification code', 'two-factor', '2fa', 'one-time',
        'cloudflare', 'access denied', 'blocked', 'suspicious',
      ].filter((h) => text.toLowerCase().includes(h));
      return {
        url: location.href,
        title: document.title,
        hasEmailField: has(sel.email),
        hasPasswordField: has(sel.password),
        hasSubmitButton: has(sel.submit),
        hasLoggedInMarker: has(sel.loggedInMarker),
        challengeHints: hints,
        bodySnippet: text.slice(0, 1500),
      };
    }, BC.sel);
  } catch (e) {
    return { error: e.message };
  }
}

async function downloadCsv(page, job) {
  // Two ways to land on the target expiry page:
  //   • job.url            → a fixed page URL (saved-selection rows)
  //   • job.future + .date → pick the expiry by date (on-demand "Pull today")
  if (job.url) {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: BC.navTimeoutMs });
  } else if (job.future && job.date) {
    await resolveExpiryPage(page, job);
  } else {
    throw new Error('job needs url, or future+date');
  }
  return captureDownload(page);
}

/* ── One pass over a job list (the saved selection, or an explicit override) ── */

async function run(env, jobsOverride, opts = {}) {
  if (!env.BROWSER) return { error: 'BROWSER (Browser Rendering) binding missing' };
  if (!env.QUAN_STATE) return { error: 'QUAN_STATE R2 bucket not bound' };

  // Debug dumps the toolbar HTML into a failed job's status. Enable per-call
  // (GET ?debug=1 / POST {debug:true}) or globally via the AUTOPULL_DEBUG var.
  const debug = !!(opts.debug || env.AUTOPULL_DEBUG);

  // jobsOverride (from the terminal's on-demand "Pull today" button) wins over
  // the cron's saved selection so a click pulls exactly the two computed contracts.
  const selection = Array.isArray(jobsOverride) ? jobsOverride : await readJSON(env, K.selection, []);
  const jobs = (Array.isArray(selection) ? selection : []).filter((j) => j && j.on !== false);
  const status = { started: nowISO(), finished: null, auth: null, ok: 0, fail: 0, jobs: [] };
  if (!jobs.length) {
    status.finished = nowISO();
    status.note = 'no contracts toggled on';
    await writeJSON(env, K.status, status);
    return status;
  }

  const index = await readJSON(env, K.index, {});
  const browser = await puppeteer.launch(env.BROWSER);
  let page = null;
  try {
    page = await browser.newPage();
    await page.setUserAgent(BC.userAgent);
    await page.setViewport({ width: 1440, height: 900 });

    status.auth = await ensureSession(page, env);

    for (const job of jobs) {
      const id = `${job.symbol}/${job.expiry}/${job.kind || 'chain'}`;
      try {
        const csv = await downloadCsv(page, job);
        if (!csv || csv.length < 32) throw new Error('empty CSV');
        const key = r2KeyFor(job);
        await env.QUAN_STATE.put(key, csv, {
          httpMetadata: { contentType: 'text/csv' },
        });
        index[key] = {
          symbol: job.symbol,
          inst: String(job.symbol || '').slice(0, 2).toUpperCase(),
          expiry: job.expiry,
          kind: job.kind || 'chain',
          bytes: csv.length,
          fetched: nowISO(),
        };
        status.ok++;
        status.jobs.push({ id, ok: true, key, bytes: csv.length });
      } catch (err) {
        status.fail++;
        const entry = { id, ok: false, error: err.message };
        if (debug) entry.toolbarHtml = await captureToolbarHtml(page);
        status.jobs.push(entry);
      }
    }
  } catch (err) {
    status.error = err.message; // session-level failure (e.g. login/bot-challenge)
    if (debug && page) status.loginDebug = await captureLoginDebug(page);
  } finally {
    try {
      await browser.close();
    } catch (_) {}
  }

  status.finished = nowISO();
  await writeJSON(env, K.index, index);
  await writeJSON(env, K.status, status);
  return status;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // GET  → run the saved selection on demand (handy while calibrating).
  // POST → run an EXPLICIT job list, but only with a valid shared key. This is
  //        how /api/autopull's operator-gated "Pull today" action reaches us
  //        without ever exposing this Worker's URL/secret to the browser.
  async fetch(request, env) {
    if (request.method === 'POST') {
      // Auth: if AUTOPULL_KEY is set, require it. If it's unset, allow — this is
      // the Service-binding setup, where the Worker has NO public route and is
      // only reachable through the bound Pages project (deploy it route-less).
      if (env.AUTOPULL_KEY) {
        const key = request.headers.get('X-Autopull-Key') || '';
        if (key !== env.AUTOPULL_KEY) {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      const body = await request.json().catch(() => ({}));
      const jobs = Array.isArray(body.jobs) ? body.jobs : null;
      if (!jobs || !jobs.length) {
        return new Response(JSON.stringify({ error: 'jobs[] required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const res = await run(env, jobs, { debug: !!body.debug });
      return new Response(JSON.stringify(res, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }
    const debug = new URL(request.url).searchParams.get('debug') === '1';
    const res = await run(env, undefined, { debug });
    return new Response(JSON.stringify(res, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
