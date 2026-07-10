/* /api/blog — public blogroll of daily field briefs (blog.husrihtlaefan.org).

   GET            → { posts: [{slug, inst, date, title, classification, summary, publishedAt}, ...] }  (newest-first)
   GET ?slug=X    → one full post, including the report payload
   POST           → operator only (requireOperator). Body: { inst, date, title?, classification?, summary?, report }
                    Upserts blog:post:<slug> and the blog:index listing. Slug = <date>-<inst>.
   DELETE ?slug=X → operator only. Removes the post and its index entry.

   Unlike the client-view snapshots (pub:* keys, 4-day TTL), blog posts are
   permanent — they only leave KV via an explicit DELETE.
*/
import { json, badRequest, serverError, requireOperator } from './_shared.js';

const INDEX_KEY = 'blog:index';
const MAX_POSTS = 500; // index cap; oldest entries fall off the roll (posts themselves stay fetchable by slug)

const slugFor = (inst, date) =>
  `${date}-${String(inst).toLowerCase()}`.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-');

async function readIndex(env) {
  const raw = await env.QUAN_PUBLISH.get(INDEX_KEY);
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

export async function onRequestGet({ request, env }) {
  const slug = new URL(request.url).searchParams.get('slug');
  if (!slug) {
    const posts = await readIndex(env);
    return json({ posts }, 200, { 'Cache-Control': 'public, max-age=60' });
  }
  const raw = await env.QUAN_PUBLISH.get(`blog:post:${slug}`);
  if (!raw) return json({ error: 'no such post' }, 404);
  return new Response(raw, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;

    const { inst, date, title, classification, summary, report } = await request.json().catch(() => ({}));
    if (!inst || !date) return badRequest('inst and date are required');
    if (!report) return badRequest('report payload is required');

    const slug = slugFor(inst, date);
    const publishedAt = new Date().toISOString();
    const entry = {
      slug, inst, date,
      title: title || `${inst} — Daily Field Brief · ${date}`,
      classification: classification || null,
      summary: summary || null,
      publishedAt
    };

    await env.QUAN_PUBLISH.put(`blog:post:${slug}`, JSON.stringify({ ...entry, report }));

    const index = await readIndex(env);
    const next = [entry, ...index.filter((p) => p.slug !== slug)]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, MAX_POSTS);
    await env.QUAN_PUBLISH.put(INDEX_KEY, JSON.stringify(next));

    return json({ ok: true, slug });
  } catch (err) {
    return serverError(err.message);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;

    const slug = new URL(request.url).searchParams.get('slug');
    if (!slug) return badRequest('slug query param is required');

    await env.QUAN_PUBLISH.delete(`blog:post:${slug}`);
    const index = await readIndex(env);
    await env.QUAN_PUBLISH.put(INDEX_KEY, JSON.stringify(index.filter((p) => p.slug !== slug)));

    return json({ ok: true });
  } catch (err) {
    return serverError(err.message);
  }
}
