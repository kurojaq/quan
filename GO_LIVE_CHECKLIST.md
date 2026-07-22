# GO_LIVE Checklist — Production Launch (Trial Seats)

**Status:** Ready for execution  
**Effort:** ~4-6 hours (external account configuration only)  
**Cost:** Free (Supabase/Stripe test mode, Cloudflare free tier for testing)  
**Target:** Launch trial seats for Scout/Operator/Prime/Desk tiers

---

## Overview

The Qu'an terminal SaaS is **production-ready in code**. What remains is external configuration:
- Supabase auth setup (email confirmation trade-off)
- Stripe test-mode products/prices/webhook
- Cloudflare Pages environment variables
- Smoke-test procedures
- Flip to live (swap test keys for live)

**Everything in code is already wired.** You're just turning on the external services.

---

## Phase 1: Configuration (Test Mode)

### Step 1: Supabase Auth Config 🔑

**Dashboard:** https://app.supabase.com → Project `guyscjcqvgffitsxuzxx` → Authentication

| Task | Setting | Value | Notes |
|------|---------|-------|-------|
| Enable email | Providers → Email | ✅ Confirm email | Trade-off: seamless signup vs security |
| Minimum password length | Policies → Password | 8 characters | Matches `MIN_PW` in `js/auth.js` |
| Leaked password protection | Policies → Password | ✅ Enable | Recommended for trial |
| Site URL | URL Configuration | `https://app.husrihtlaefan.org` | Redirect link base |
| Redirect URLs | URL Configuration | `https://app.husrihtlaefan.org/app`, `https://app.husrihtlaefan.org/**` | Email confirm + password reset |
| SMTP | Auth → Emails → SMTP | Configure real sender | Default Supabase mailer lands in spam |

**Decision point — Email Confirmation:**

| Confirm Email: ON | Confirm Email: OFF |
|---|---|
| ✅ More secure | ✅ Seamless signup funnel |
| ❌ Loses pricing hand-off | ❌ Requires card at Stripe checkout |
| User flow: signup → confirm → signin → click plan again | User flow: signup → immediate session → auto-checkout |

**Recommendation:** OFF for rapid trials (card validation gates abuse).

**Test:** Create account, verify sign-in works.

---

### Step 2: Stripe Test Mode Setup 🔑

**Dashboard:** https://dashboard.stripe.com → Test Mode (toggle in top-left)

**Step 2a: Create Products**

Products → New Product

| Product | Price/Month | Price/Annual | Notes |
|---------|-------------|--------------|-------|
| **Operator** | $99 | $990 (17% off) | Full access + ingest/auto-pull |
| **Prime** | $249 | $2,490 (17% off) | Full access + execution (demo-only) |
| **Desk** | $699 | $6,990 (17% off) | Full access + execution (live-capable) |

**For each product:**
1. Click "Add pricing"
2. Enter monthly price + annual price
3. Note the `price_XXXXX` IDs

**Step 2b: Collect Price IDs**

Save these in a safe place (you'll need them in 10 minutes):

```
STRIPE_PRICE_OPERATOR_MONTHLY = price_XXXXX
STRIPE_PRICE_OPERATOR_ANNUAL = price_XXXXX
STRIPE_PRICE_PRIME_MONTHLY = price_XXXXX
STRIPE_PRICE_PRIME_ANNUAL = price_XXXXX
STRIPE_PRICE_DESK_MONTHLY = price_XXXXX
STRIPE_PRICE_DESK_ANNUAL = price_XXXXX
```

**Step 2c: Get API Keys**

Developers → API Keys → Copy:
- **Publishable key** (pk_test_XXXXX) — for browser checkout
- **Secret key** (sk_test_XXXXX) — for webhook signing (keep secret!)

**Step 2d: Webhook Setup**

Developers → Webhooks → Add endpoint:

| Field | Value |
|-------|-------|
| Endpoint URL | `https://app.husrihtlaefan.org/api/webhook` |
| Events | ✅ checkout.session.completed |
| Events | ✅ customer.subscription.created |
| Events | ✅ customer.subscription.updated |
| Events | ✅ customer.subscription.deleted |

Copy the **signing secret** (whsec_test_XXXXX).

**Step 2e: Customer Portal**

Billing → Customer portal → Activate:
- ✅ Allow customers to update payment method
- ✅ Allow customers to cancel subscription

This powers the in-app "Manage Subscription" button.

**Test:** Create test checkout session (see Step 4).

---

### Step 3: Cloudflare Pages Environment Variables 🔑

**Project:** quan → Settings → Environment variables

Set **all three environments** (Production, Preview, Development):

| Name | Type | Value | Notes |
|------|------|-------|-------|
| `SUPABASE_URL` | Var | `https://guyscjcqvgffitsxuzxx.supabase.co` | From Supabase dashboard |
| `SUPABASE_ANON_KEY` | Var | (anon key) | Supabase → Settings → API Keys |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | (service role key) | Only for webhook (D1 writes) |
| `OPERATOR_EMAIL` | Var | `jqnboggan@gmail.com` | Your email (grants owner override) |
| `APP_BASE_URL` | Var | `https://app.husrihtlaefan.org` | App domain |
| `STRIPE_SECRET_KEY` | **Secret** | `sk_test_XXXXX` | From Stripe (secret!) |
| `STRIPE_WEBHOOK_SECRET` | **Secret** | `whsec_test_XXXXX` | From Stripe webhook |
| `STRIPE_PRICE_OPERATOR_MONTHLY` | Var | `price_XXXXX` | From Step 2b |
| `STRIPE_PRICE_OPERATOR_ANNUAL` | Var | `price_XXXXX` | From Step 2b |
| `STRIPE_PRICE_PRIME_MONTHLY` | Var | `price_XXXXX` | From Step 2b |
| `STRIPE_PRICE_PRIME_ANNUAL` | Var | `price_XXXXX` | From Step 2b |
| `STRIPE_PRICE_DESK_MONTHLY` | Var | `price_XXXXX` | From Step 2b |
| `STRIPE_PRICE_DESK_ANNUAL` | Var | `price_XXXXX` | From Step 2b |

**Bindings** (Settings → Functions → Bindings):
- ✅ `QUAN_PUBLISH` (KV namespace) — for rate limits + plan cache

**Deploy:** Push to Pages (or manually redeploy).

---

### Step 4: Smoke Test 🧪

Open terminal to `https://app.husrihtlaefan.org/app`

**Test 4a: Sign Up (Scout Tier)**
```
✅ Click "Create account"
✅ Enter email + password (8+ chars)
✅ If confirm email ON: check email, click confirm link
✅ Redirected to app.html
✅ See: Detector + Chart unlocked, other tabs locked + "🔒 Upgrade" button
✅ Tier shown as "Scout"
```

**Test 4b: Stripe Test Purchase (Prime Trial)**
```
✅ Click "Upgrade" on locked tab
✅ Choose "Prime" tier
✅ Stripe Checkout modal opens
✅ Enter test card: 4242 4242 4242 4242, any expiry, any CVC
✅ Complete checkout
✅ Redirected back to /app?checkout=success
✅ Prime tabs now unlocked (Execution included)
✅ Trial banner: "Prime free trial — 13 days remaining"
```

**Test 4c: Verify Subscription in Supabase**
```bash
# Open Supabase Dashboard → Table Editor → subscriptions
# Find your test row: status='trialing', tier='prime'
✅ Row exists with correct values
```

**Test 4d: Security Headers**
```bash
curl -sI https://app.husrihtlaefan.org/app | grep -i -E 'content-security|strict-transport|x-frame'
# Expected:
# content-security-policy: ...
# strict-transport-security: max-age=31536000
# x-frame-options: DENY
✅ All three present
```

**Test 4e: CSP Violations (Console)**
```
✅ Open DevTools → Console
✅ Load /app
✅ No CSP violation messages
✅ If any: update `_headers` CSP rule (likely Pyodide or chart library)
```

**Test 4f: Account Management**
```
✅ Click "Account" (top-right)
✅ Click "Subscription"
✅ See: "Prime" tier, renewal date, "Manage Subscription" button
✅ Click "Manage Subscription"
✅ Stripe Customer Portal opens (can update payment, cancel)
✅ Click back, close portal
```

**All tests pass? → Proceed to Step 5**

---

### Step 5: Execution Engine Multi-Tenant Setup 🔑

**File:** `workers/wrangler-execution.toml`

**Step 5a: Generate Encryption Key**

```bash
openssl rand -base64 32
# Output: AbCdEfGhIjKlMnOpQrStUvWxYz+1234567890abcde/=
```

**Step 5b: Set Secret in Cloudflare**

```bash
wrangler secret put EXEC_ENC_KEY --config workers/wrangler-execution.toml
# Paste: AbCdEfGhIjKlMnOpQrStUvWxYz+1234567890abcde/=
# Confirm
```

**Step 5c: Deploy Execution Worker**

```bash
npm run deploy:execution
# (or: wrangler publish --config workers/wrangler-execution.toml)
```

**Step 5d: Bind to Pages**

Cloudflare Pages → quan → Settings → Bindings:
- Add: `EXECUTION` (Service) → `execution` (Worker)

**Test:** (See Step 4 test 4b: Execution tab unlocks for Prime)

---

## Phase 2: Flip to Live (Production Keys)

**Prerequisites:**
- [ ] All smoke tests pass (Phase 1)
- [ ] Ready for real payments

**Steps:**

1. **Stripe:** Toggle from Test Mode → Live Mode (top-left)

2. **Re-create products** in Live Mode (Stripe doesn't port test → live)
   - Same products, same prices (Operator $99, Prime $249, Desk $699)
   - Collect new live `price_XXXXX` IDs

3. **Get live keys** (Developers → API Keys)
   - Publishable: pk_live_XXXXX
   - Secret: sk_live_XXXXX

4. **Re-create webhook** in Live Mode
   - Endpoint: `https://app.husrihtlaefan.org/api/webhook`
   - Events: same 4 (checkout.session.completed, etc.)
   - Get new live signing secret: whsec_live_XXXXX

5. **Update Cloudflare Pages environment** (Production env only)
   ```
   STRIPE_SECRET_KEY = sk_live_XXXXX
   STRIPE_WEBHOOK_SECRET = whsec_live_XXXXX
   STRIPE_PRICE_OPERATOR_MONTHLY = price_XXXXX (live)
   ... (all 6 prices, updated)
   ```

6. **Deploy to production**
   ```bash
   wrangler pages deploy --project-name quan
   ```

7. **Run one real end-to-end purchase** (using test card with different amounts)
   - Confirm Supabase subscription created
   - Confirm webhook processed
   - Confirm customer portal works

8. **Monitor live data**
   ```bash
   wrangler tail quan --env production  # Watch for errors
   ```

---

## Deferred (Not Blocking Trial Launch)

These can wait (documented in GO_LIVE.md):

- [ ] Per-user "live enabled" flag (subscribers demo-only at launch)
- [ ] Realtime Worker deploy (optional; analytics don't need it yet)
- [ ] Nonce-based CSP (current CSP is pragmatic; larger refactor)

---

## Timeline & Effort

| Phase | Task | Effort | Prerequisites |
|-------|------|--------|---|
| Phase 1 | Config (Supabase/Stripe/CF) | 3-4 hrs | Access to all 3 platforms |
| Phase 1 | Smoke tests | 30 min | Config complete |
| Phase 2 | Flip to live keys | 1 hr | Smoke tests pass |
| Phase 2 | Real purchase test | 15 min | Live keys set |

**Total:** ~5-6 hours (spread over 2-3 days if accounts need setup)

---

## Success Criteria

**Phase 1 (Test Mode):**
- ✅ Scout tier signs up, sees limited features
- ✅ Prime tier trial purchased, sees full features
- ✅ Supabase subscription table updated correctly
- ✅ Stripe webhook processed order
- ✅ Security headers present, no CSP violations
- ✅ Execution engine multi-tenant setup working (Exec tab unlocks)

**Phase 2 (Live Mode):**
- ✅ One real payment processed end-to-end
- ✅ Customer portal accessible
- ✅ Monitoring + alerting configured
- ✅ Operator can access admin panel

---

## Support Contacts

If you get stuck:

| Issue | Contact | Note |
|-------|---------|------|
| Supabase auth | Supabase Docs: https://supabase.com/docs/guides/auth | Email confirm trade-off |
| Stripe setup | Stripe Docs: https://stripe.com/docs/billing/subscriptions/fixed-price | Test mode is forgiving |
| Cloudflare Pages | CF Dashboard → quan → Deployments | Check build logs |
| Webhook failures | Stripe Dashboard → Webhooks → Event logs | Replay failed webhooks |

---

## Rollback (Test → Live)

If live mode has issues:

```bash
# Flip back to test keys in Cloudflare Pages (Production env)
STRIPE_SECRET_KEY = sk_test_XXXXX
STRIPE_WEBHOOK_SECRET = whsec_test_XXXXX

# Redeploy
wrangler pages deploy --project-name quan
```

Recovery time: <5 minutes. No data lost (all transactions logged to Supabase).

---

## Next: Begin Phase 1 Configuration

**Ready?** You have all the info above. Start with Step 1 (Supabase auth) and follow the sequence.

**Questions?** Each step is documented in GO_LIVE.md in the raw folder (more detail there).

**Status:** All code is ready. This checklist is your execution guide for turning on external services.

🚀 **Ship it.**
