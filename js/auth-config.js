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
  url: '',       // e.g. 'https://abcdefgh.supabase.co'
  anonKey: ''    // e.g. 'eyJhbGciOi...'  (anon / public key)
};
