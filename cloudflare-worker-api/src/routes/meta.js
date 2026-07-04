import { getDataset } from '../lib/github.js';
import { ok, notFound, badRequest } from '../lib/http.js';
import { resolveRank, isValidRole } from '../lib/validate.js';

export async function handleMetaList(request, params, query, ctx) {
  const rank = resolveRank(query.get('rank'));
  if (rank === null) {
    return notFound('rank_not_found', `rank '${query.get('rank')}'를 찾을 수 없습니다.`);
  }
  const role = query.get('role');
  if (!isValidRole(role)) {
    return badRequest('invalid_role', `role은 tank/damage/support 중 하나여야 합니다: '${role}'`);
  }

  const meta = await getDataset('meta', ctx);
  const rows = meta[rank];
  if (!rows) {
    return notFound('rank_not_found', `rank '${rank}'를 찾을 수 없습니다.`);
  }

  const filtered = role ? rows.filter((h) => h.role === role) : rows;
  return ok(filtered, { rank, role: role ?? null, count: filtered.length });
}

export async function handleMetaByHero(request, params, query, ctx) {
  const rank = resolveRank(query.get('rank'));
  if (rank === null) {
    return notFound('rank_not_found', `rank '${query.get('rank')}'를 찾을 수 없습니다.`);
  }

  const meta = await getDataset('meta', ctx);
  const rows = meta[rank];
  if (!rows) {
    return notFound('rank_not_found', `rank '${rank}'를 찾을 수 없습니다.`);
  }

  const hero = rows.find((h) => h.hero_id === params.heroId);
  if (!hero) {
    return notFound('hero_not_found', `hero_id '${params.heroId}'를 rank '${rank}'에서 찾을 수 없습니다.`);
  }
  return ok(hero, { rank });
}
