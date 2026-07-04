import { getDataset } from '../lib/github.js';
import { ok, notFound, badRequest } from '../lib/http.js';
import { isValidRole } from '../lib/validate.js';

export async function handleHeroList(request, params, query, ctx) {
  const role = query.get('role');
  if (!isValidRole(role)) {
    return badRequest('invalid_role', `role은 tank/damage/support 중 하나여야 합니다: '${role}'`);
  }

  const heroes = await getDataset('heroes', ctx);
  let list = Object.entries(heroes.heroes).map(([hero_id, h]) => ({ hero_id, ...h }));
  if (role) list = list.filter((h) => h.role === role);

  return ok(list, { role: role ?? null, count: list.length });
}

export async function handleHeroDetail(request, params, query, ctx) {
  const heroes = await getDataset('heroes', ctx);
  const hero = heroes.heroes[params.heroId];
  if (!hero) {
    return notFound('hero_not_found', `hero_id '${params.heroId}'를 찾을 수 없습니다.`);
  }
  return ok({ hero_id: params.heroId, ...hero });
}

export async function handleRoles(request, params, query, ctx) {
  const heroes = await getDataset('heroes', ctx);
  return ok(heroes.roles);
}
