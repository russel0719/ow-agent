import { getDataset } from '../lib/github.js';
import { ok, notFound, badRequest } from '../lib/http.js';

async function buildHeroIdIndex(ctx) {
  const heroes = await getDataset('heroes', ctx);
  const nameToId = {};
  for (const [hero_id, h] of Object.entries(heroes.heroes)) {
    nameToId[h.name] = hero_id;
  }
  return nameToId;
}

export async function handleStadiumSummary(request, params, query, ctx) {
  const [stadium, nameToId] = await Promise.all([
    getDataset('stadium', ctx),
    buildHeroIdIndex(ctx),
  ]);

  const summary = Object.entries(stadium).map(([displayName, builds]) => ({
    hero_id: nameToId[displayName] ?? null,
    hero_name: displayName,
    build_count: builds.length,
  }));

  return ok(summary, { count: summary.length });
}

export async function handleStadiumByHero(request, params, query, ctx) {
  const limitParam = query.get('limit');
  let limit = null;
  if (limitParam != null) {
    limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit <= 0) {
      return badRequest('invalid_limit', `limit은 양의 정수여야 합니다: '${limitParam}'`);
    }
  }

  const [stadium, nameToId] = await Promise.all([
    getDataset('stadium', ctx),
    buildHeroIdIndex(ctx),
  ]);

  const displayName = Object.keys(nameToId).find((name) => nameToId[name] === params.heroId);
  const builds = displayName ? stadium[displayName] : null;
  if (!builds) {
    return notFound('hero_not_found', `hero_id '${params.heroId}'의 스타디움 빌드를 찾을 수 없습니다.`);
  }

  const sorted = [...builds].sort((a, b) => b.upvotes - a.upvotes);
  const result = limit ? sorted.slice(0, limit) : sorted;
  return ok(result, { hero_id: params.heroId, count: result.length });
}
