const BASE = 'https://russel0719.github.io/ow-agent/data';
const TTL_SECONDS = 300;

export class UpstreamError extends Error {}

export async function getDataset(name, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(`${BASE}/${name}.json`);
  let res = await cache.match(cacheKey);

  if (!res) {
    const origin = await fetch(`${BASE}/${name}.json`, {
      cf: { cacheTtl: TTL_SECONDS, cacheEverything: true },
    });
    if (!origin.ok) {
      throw new UpstreamError(`GitHub Pages fetch 실패: ${name}.json (${origin.status})`);
    }
    res = new Response(origin.body, origin);
    res.headers.set('Cache-Control', `public, max-age=${TTL_SECONDS}`);
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }

  return res.json();
}
