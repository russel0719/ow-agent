import { createRouter } from './router.js';
import { preflight, methodNotAllowed, notFound, upstreamError } from './lib/http.js';
import { UpstreamError } from './lib/github.js';
import { handleHealth } from './routes/health.js';
import { handleHeroList, handleHeroDetail, handleRoles } from './routes/heroes.js';
import { handleMetaList, handleMetaByHero } from './routes/meta.js';
import { handleMetaHistoryByHero } from './routes/metaHistory.js';
import { handlePatchList, handlePatchLatest } from './routes/patch.js';
import { handleStadiumSummary, handleStadiumByHero } from './routes/stadium.js';
import { handleMapList, handleMapDetail, handleMapHistory } from './routes/maps.js';

const router = createRouter();

router.get('/v1/health', handleHealth);
router.get('/v1/heroes', handleHeroList);
router.get('/v1/heroes/:heroId', handleHeroDetail);
router.get('/v1/roles', handleRoles);
router.get('/v1/meta', handleMetaList);
router.get('/v1/meta/history/:heroId', handleMetaHistoryByHero);
router.get('/v1/meta/:heroId', handleMetaByHero);
router.get('/v1/patch', handlePatchList);
router.get('/v1/patch/latest', handlePatchLatest);
router.get('/v1/stadium', handleStadiumSummary);
router.get('/v1/stadium/:heroId', handleStadiumByHero);
router.get('/v1/maps', handleMapList);
router.get('/v1/maps/:mapId/history', handleMapHistory);
router.get('/v1/maps/:mapId', handleMapDetail);

async function route(request, ctx) {
  const url = new URL(request.url);
  const match = router.match(url.pathname);
  if (!match) {
    return notFound('not_found', `경로 '${url.pathname}'를 찾을 수 없습니다.`);
  }

  try {
    return await match.handler(request, match.params, url.searchParams, ctx);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return upstreamError(err.message);
    }
    throw err;
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return preflight();
    if (request.method !== 'GET') return methodNotAllowed();

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await route(request, ctx);
    if (response.status === 200) {
      const toCache = response.clone();
      toCache.headers.set('Cache-Control', 'public, max-age=300');
      ctx.waitUntil(cache.put(request, toCache));
    }
    return response;
  },
};
