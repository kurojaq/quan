/* Host-based root routing for the production subdomains.

   Cloudflare Pages `_redirects` ignores host-matched 200 rewrites (host sources
   only work for 3xx), so this middleware serves each subdomain's page at its
   root instead — same URL, no redirect, query string untouched (client tokens:
   client.husrihtlaefan.org/?token=...).

   _routes.json only routes "/api/*" and "/" through Functions, so this runs for
   root requests and API requests only; every other path stays pure static.
*/
// Extensionless targets: asking ASSETS for '/blog.html' triggers Pages'
// clean-URL normalizer, which answers 308 → '/blog' (and that redirect would
// drop a client link's ?token= query). The clean URLs serve content directly.
const HOST_PAGES = {
  'blog.husrihtlaefan.org': '/blog',
  'app.husrihtlaefan.org': '/app',
  'client.husrihtlaefan.org': '/view'
};

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const dest = HOST_PAGES[url.hostname];
  if (dest && url.pathname === '/') {
    const assetUrl = new URL(dest, url.origin);
    return context.env.ASSETS.fetch(new Request(assetUrl.toString(), context.request));
  }
  return context.next();
}
