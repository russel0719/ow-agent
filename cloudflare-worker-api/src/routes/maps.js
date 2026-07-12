import { getDataset, supabaseSelect } from '../lib/github.js';
import { ok, notFound, badRequest } from '../lib/http.js';
import { isValidRole, isValidDate } from '../lib/validate.js';

export async function handleMapList(request, params, query, ctx, env) {
  const mapMeta = await getDataset('map_meta', ctx, env);
  const list = Object.entries(mapMeta).map(([map_id, heroes]) => {
    const top = [...heroes].sort((a, b) => b.meta_score - a.meta_score).slice(0, 3);
    return { map_id, top_heroes: top.map((h) => ({ hero_id: h.hero_id, hero_name: h.hero_name, tier: h.tier })) };
  });
  return ok(list, { count: list.length });
}

export async function handleMapDetail(request, params, query, ctx, env) {
  const role = query.get('role');
  if (!isValidRole(role)) {
    return badRequest('invalid_role', `role은 tank/damage/support 중 하나여야 합니다: '${role}'`);
  }

  const mapMeta = await getDataset('map_meta', ctx, env);
  const rows = mapMeta[params.mapId];
  if (!rows) {
    return notFound('map_not_found', `map_id '${params.mapId}'를 찾을 수 없습니다.`);
  }

  const filtered = role ? rows.filter((h) => h.role === role) : rows;
  return ok(filtered, { map_id: params.mapId, role: role ?? null, count: filtered.length });
}

export async function handleMapHistory(request, params, query, ctx, env) {
  const from = query.get('from');
  const to = query.get('to');
  if (!isValidDate(from) || !isValidDate(to)) {
    return badRequest('invalid_date_range', 'from/to는 YYYY-MM-DD 형식이어야 합니다.');
  }

  // 정규화 테이블에서 해당 맵 · 기간만 조회
  let search = `map_id=eq.${encodeURIComponent(params.mapId)}`
    + '&select=snapshot_date,entries&order=snapshot_date';
  if (from) search += `&snapshot_date=gte.${from}`;
  if (to) search += `&snapshot_date=lte.${to}`;

  const rows = await supabaseSelect(env, 'map_meta_history', search);
  if (!rows.length) {
    return notFound('map_not_found', `map_id '${params.mapId}'의 히스토리를 찾을 수 없습니다.`);
  }

  const series = rows.map((r) => ({ date: r.snapshot_date, heroes: r.entries }));
  return ok(series, { map_id: params.mapId, count: series.length });
}
