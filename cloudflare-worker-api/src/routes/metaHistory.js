import { getDataset } from '../lib/github.js';
import { ok, notFound, badRequest } from '../lib/http.js';
import { resolveRank, HISTORY_RANKS, isValidDate } from '../lib/validate.js';

export async function handleMetaHistoryByHero(request, params, query, ctx) {
  const rank = resolveRank(query.get('rank'));
  if (rank === null || !HISTORY_RANKS.has(rank)) {
    return notFound('rank_not_found', `rank '${query.get('rank') ?? rank}'의 히스토리를 찾을 수 없습니다.`);
  }
  const from = query.get('from');
  const to = query.get('to');
  if (!isValidDate(from) || !isValidDate(to)) {
    return badRequest('invalid_date_range', 'from/to는 YYYY-MM-DD 형식이어야 합니다.');
  }

  const history = await getDataset('meta_history', ctx);
  const byDate = history[rank];
  if (!byDate) {
    return notFound('rank_not_found', `rank '${rank}'의 히스토리를 찾을 수 없습니다.`);
  }

  const series = Object.entries(byDate)
    .filter(([date]) => (!from || date >= from) && (!to || date <= to))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, heroes]) => {
      const entry = heroes.find((h) => h.hero_id === params.heroId);
      return entry ? { date, ...entry } : null;
    })
    .filter(Boolean);

  if (series.length === 0) {
    return notFound('hero_not_found', `hero_id '${params.heroId}'의 히스토리를 찾을 수 없습니다.`);
  }

  return ok(series, { rank, hero_id: params.heroId, count: series.length });
}
