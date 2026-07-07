/* Realtime (WebSocket) configuration.
 *
 * Leave `base` EMPTY to keep realtime DISABLED — the terminal then behaves exactly
 * as before (Live anchor polls /api/quote; no Desk shared sessions). This mirrors
 * js/auth-config.js: the feature is inert until you point it at a deployed Worker.
 *
 * After deploying workers/realtime.js (see CLOUDFLARE_SETUP.md §8), put its URL
 * here as a wss:// origin, e.g.:
 *   base: 'wss://quan-realtime.<your-subdomain>.workers.dev'
 */
window.__QUAN_RT = {
  base: ''
};
