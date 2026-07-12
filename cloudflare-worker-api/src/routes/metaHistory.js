import { supabaseSelect } from '../lib/github.js';
import { ok, notFound, badRequest } from '../lib/http.js';
import { resolveRank, HISTORY_RANKS, isValidDate } from '../lib/validate.js';

export async function handleMetaHistoryByHero(request, params, query, ctx, env) {
  const rank = resolveRank(query.get('rank'));
  if (rank === null || !HISTORY_RANKS.has(rank)) {
    return notFound('rank_not_found', `rank '${query.get('rank') ?? rank}'의 히스토리를 찾을 수 없습니다.`);
  }
  const from = query.get('from');
  const to = query.get('to');
  if (!isValidDate(from) || !isValidDate(to)) {
    return badRequest('invalid_date_range', 'from/to는 YYYY-MM-DD 형식이어야 합니다.');
  }

  // 정규화 테이블에서 해당 랭크 · 기간만 조회
  let search = `rank=eq.${encodeURIComponent(rank)}&select=snapshot_date,heroes&order=snapshot_date`;
  if (from) search += `&snapshot_date=gte.${from}`;
  if (to) search += `&snapshot_date=lte.${to}`;

  const rows = await supabaseSelect(env, 'meta_history', search);
  const series = rows
    .map((r) => {
      const entry = r.heroes.find((h) => h.hero_id === params.heroId);
      return entry ? { date: r.snapshot_date, ...entry } : null;
    })
    .filter(Boolean);

  if (series.length === 0) {
    return notFound('hero_not_found', `hero_id '${params.heroId}'의 히스토리를 찾을 수 없습니다.`);
  }

  return ok(series, { rank, hero_id: params.heroId, count: series.length });
}
