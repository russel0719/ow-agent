import { getDataset } from '../lib/github.js';
import { ok, notFound, badRequest } from '../lib/http.js';
import { isValidRole, isValidDate } from '../lib/validate.js';

export async function handleMapList(request, params, query, ctx) {
  const mapMeta = await getDataset('map_meta', ctx);
  const list = Object.entries(mapMeta).map(([map_id, heroes]) => {
    const top = [...heroes].sort((a, b) => b.meta_score - a.meta_score).slice(0, 3);
    return { map_id, top_heroes: top.map((h) => ({ hero_id: h.hero_id, hero_name: h.hero_name, tier: h.tier })) };
  });
  return ok(list, { count: list.length });
}

export async function handleMapDetail(request, params, query, ctx) {
  const role = query.get('role');
  if (!isValidRole(role)) {
    return badRequest('invalid_role', `role은 tank/damage/support 중 하나여야 합니다: '${role}'`);
  }

  const mapMeta = await getDataset('map_meta', ctx);
  const rows = mapMeta[params.mapId];
  if (!rows) {
    return notFound('map_not_found', `map_id '${params.mapId}'를 찾을 수 없습니다.`);
  }

  const filtered = role ? rows.filter((h) => h.role === role) : rows;
  return ok(filtered, { map_id: params.mapId, role: role ?? null, count: filtered.length });
}

export async function handleMapHistory(request, params, query, ctx) {
  const from = query.get('from');
  const to = query.get('to');
  if (!isValidDate(from) || !isValidDate(to)) {
    return badRequest('invalid_date_range', 'from/to는 YYYY-MM-DD 형식이어야 합니다.');
  }

  const history = await getDataset('map_meta_history', ctx);
  const byDate = history[params.mapId];
  if (!byDate) {
    return notFound('map_not_found', `map_id '${params.mapId}'의 히스토리를 찾을 수 없습니다.`);
  }

  const series = Object.entries(byDate)
    .filter(([date]) => (!from || date >= from) && (!to || date <= to))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, heroes]) => ({ date, heroes }));

  return ok(series, { map_id: params.mapId, count: series.length });
}
