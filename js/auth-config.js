/* Supabase auth configuration.
 *
 * Leave url/anonKey EMPTY to keep authentication disabled — the app then behaves
 * exactly as before (the legacy word-lock). Fill both in to activate real login.
 *
 * Both values are safe to commit: the anon (public) key is designed to live in
 * client code; row-level-security on the Supabase side is what actually protects data.
 *
 * Get them from your Supabase project: Settings -> API -> Project URL + anon public key.
 */
window.__SUPA = {
  url: 'https://guyscjcqvgffitsxuzxx.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1eXNjamNxdmdmZml0c3h1enh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMzg1MDAsImV4cCI6MjA5ODgxNDUwMH0.nzAG3yUTTjmJtiqIO1fLuvA7_rgk6oFIW_9qLAN6r_o'
};
