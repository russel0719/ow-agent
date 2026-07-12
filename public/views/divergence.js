/**
 * 랭크 간 격차 뷰
 * 저랭(브론즈·실버·골드) vs 고랭(마스터·그마·챔피언) 평균 승률 차이로
 * "고랭에서 강한 영웅"과 "저랭에서 강한 영웅"을 대비해 보여준다.
 * meta.json(랭크별 통계)만으로 계산 — 외부 API 없음.
 */
import { loadJSON, getPortraitIndex } from '../app.js';

const LOW_RANKS = ['브론즈', '실버', '골드'];
const HIGH_RANKS = ['마스터', '그랜드마스터', '챔피언'];
const ROLE_LABEL = { tank: '돌격', damage: '공격', support: '지원' };

function avgWin(meta, ranks, heroId) {
  const vals = [];
  for (const r of ranks) {
    const h = (meta[r] || []).find(x => x.hero_id === heroId);
    if (h && h.win_rate > 0) vals.push(h.win_rate);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function portraitCell(url, name) {
  if (url) {
    return `<img src="${url}" alt="${name}" width="24" height="24"
      class="rounded-full object-cover shrink-0 border border-ow-border inline-block align-middle mr-1.5"
      style="width:24px;height:24px"
      onerror="this.style.display='none'">`;
  }
  return '';
}

function table(rows, portraitIndex, { diffColor }) {
  if (!rows.length) return '<p class="text-gray-500 text-sm">데이터 없음</p>';
  const body = rows.map(r => {
    const url = portraitIndex?.[r.hero_id] ?? '';
    const sign = r.diff > 0 ? '+' : '';
    return `
      <tr class="border-t border-ow-border">
        <td class="py-1.5 pr-2">${portraitCell(url, r.name)}<span class="align-middle">${r.name}</span></td>
        <td class="py-1.5 px-2 text-gray-400">${ROLE_LABEL[r.role] ?? r.role}</td>
        <td class="py-1.5 px-2 text-right tabular-nums">${r.low.toFixed(1)}%</td>
        <td class="py-1.5 px-2 text-right tabular-nums">${r.high.toFixed(1)}%</td>
        <td class="py-1.5 pl-2 text-right tabular-nums font-semibold ${diffColor}">${sign}${r.diff}</td>
      </tr>`;
  }).join('');
  return `
    <table class="w-full text-sm">
      <thead>
        <tr class="text-xs text-gray-500 text-left">
          <th class="pb-1.5 pr-2 font-medium">영웅</th>
          <th class="pb-1.5 px-2 font-medium">역할</th>
          <th class="pb-1.5 px-2 font-medium text-right">저랭 승률</th>
          <th class="pb-1.5 px-2 font-medium text-right">고랭 승률</th>
          <th class="pb-1.5 pl-2 font-medium text-right">차이</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

export async function renderDivergence(container) {
  const meta = await loadJSON('meta');
  const portraitIndex = await getPortraitIndex();

  const base = meta['전체'] ?? meta[Object.keys(meta)[0]] ?? [];
  const rows = [];
  for (const h of base) {
    const low = avgWin(meta, LOW_RANKS, h.hero_id);
    const high = avgWin(meta, HIGH_RANKS, h.hero_id);
    if (low == null || high == null) continue;
    rows.push({
      hero_id: h.hero_id,
      name: h.hero_name,
      role: h.role,
      low,
      high,
      diff: +(high - low).toFixed(1),
    });
  }

  const highSkill = [...rows].filter(r => r.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 12);
  const lowElo = [...rows].filter(r => r.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 12);

  container.innerHTML = `
    <div class="max-w-5xl mx-auto space-y-5 pb-10">
      <div>
        <h2 class="text-lg font-bold text-gray-100">랭크 간 격차</h2>
        <p class="text-sm text-gray-500 mt-1">
          저랭(브론즈·실버·골드)과 고랭(마스터·그마·챔피언)의 평균 승률 차이입니다.
          같은 영웅도 실력대에 따라 성적이 크게 갈립니다.
        </p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="bg-ow-card border border-ow-border rounded-xl p-5">
          <div class="text-sm font-semibold text-ow-blue mb-1">고랭에서 강한 영웅</div>
          <div class="text-xs text-gray-500 mb-3">고랭 승률이 저랭보다 높음 — 숙련도가 성적에 크게 반영</div>
          ${table(highSkill, portraitIndex, { diffColor: 'text-ow-blue' })}
        </div>
        <div class="bg-ow-card border border-ow-border rounded-xl p-5">
          <div class="text-sm font-semibold text-ow-orange mb-1">저랭에서 강한 영웅</div>
          <div class="text-xs text-gray-500 mb-3">저랭 승률이 고랭보다 높음 — 낮은 실력대에서 특히 강세</div>
          ${table(lowElo, portraitIndex, { diffColor: 'text-ow-orange' })}
        </div>
      </div>

      <p class="text-xs text-gray-600">
        승률은 각 실력대 그룹의 랭크별 평균이며, 두 그룹 모두에 데이터가 있는 영웅만 표시됩니다.
      </p>
    </div>`;
}
