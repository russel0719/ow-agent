/**
 * 메타 분석 뷰
 * - 지수 요약 카드 (통합 메타 / 존재감 / 밴 효율)
 * - 버블 차트: 존재감 vs 통합 메타지수, 버블 크기 = 밴 효율
 * - 종합 지수 테이블 (정렬 가능)
 * - 밴 효율 TOP15 수평 바 차트
 * - ban 데이터 없을 때 fallback 공식 안내 배너
 */
import { loadJSON, getPortraitIndex } from '../app.js';

const RANKS = ['전체', '브론즈', '실버', '골드', '플래티넘', '다이아몬드', '마스터', '그랜드마스터', '챔피언'];
const ROLES = ['전체', '탱커', '딜러', '지원가'];
const ROLE_MAP = { '탱커': 'tank', '딜러': 'damage', '지원가': 'support' };
const ROLE_LABEL = { tank: '탱커', damage: '딜러', support: '지원가' };
const ROLE_CLASS = { tank: 'role-tank', damage: 'role-damage', support: 'role-support' };
const ROLE_COLOR = { tank: '#4FC3F7', damage: '#ef4444', support: '#22c55e' };
const TIER_COLOR = { S: '#ef4444', A: '#f97316', B: '#eab308', C: '#22c55e', D: '#6b7280' };

const HERO_COLOR = {
  dva: '#F472B6', doomfist: '#D97706', hazard: '#10B981', junker_queen: '#EF4444',
  mauga: '#991B1B', orisa: '#65A30D', ramattra: '#7C3AED', reinhardt: '#94A3B8',
  roadhog: '#92400E', sigma: '#60A5FA', winston: '#8B5CF6', wrecking_ball: '#F59E0B',
  zarya: '#EC4899', ashe: '#B91C1C', bastion: '#4D7C0F', cassidy: '#B45309',
  echo: '#38BDF8', freja: '#2563EB', genji: '#4ADE80', hanzo: '#1D4ED8',
  junkrat: '#FBBF24', mei: '#93C5FD', pharah: '#3B82F6', reaper: '#6B7280',
  sojourn: '#F97316', soldier76: '#475569', sombra: '#A855F7', symmetra: '#06B6D4',
  torbjorn: '#DC2626', tracer: '#FB923C', vendetta: '#7F1D1D', venture: '#C2410C',
  widowmaker: '#C026D3', ana: '#0EA5E9', baptiste: '#0D9488', briggitte: '#E97419',
  illari: '#EAB308', juno: '#818CF8', kiriko: '#F43F5E', lifeweaver: '#FB7185',
  lucio: '#22D3EE', mercy: '#FCD34D', moira: '#9333EA', zenyatta: '#FFD700',
  wuyang: '#9CA3AF', mizuki: '#9CA3AF', emre: '#9CA3AF', domina: '#9CA3AF',
  anran: '#9CA3AF', jetpack_cat: '#9CA3AF', sierra: '#9CA3AF',
};
const FALLBACK_COLOR = '#9CA3AF';

// ── 차트 높이 헬퍼 (모바일 반응형) ───────────────────────────────────────────
const CHART_H = () => window.innerWidth < 640 ? '260px' : '420px';

// ── 상태 변수 ─────────────────────────────────────────────────────────────────
let currentRank = '전체';
let currentRole = '전체';
let cachedMeta = null;
let portraitIndex = {};
let bubbleChart = null;
let banChart = null;
let sortCol = 'meta_score';
let sortDir = 'desc';

// ── 진입점 ────────────────────────────────────────────────────────────────────
export async function renderAnalysis(container, params) {
  currentRank = params.get('rank') || '전체';
  currentRole = '전체';
  sortCol = 'meta_score';
  sortDir = 'desc';

  cachedMeta = await loadJSON('meta');
  portraitIndex = await getPortraitIndex();

  container.innerHTML = buildHTML();
  attachEvents(container);
  renderAll(container);
}

// ── HTML 골격 ─────────────────────────────────────────────────────────────────
function buildHTML() {
  const rankOptions = RANKS.map(r =>
    `<option value="${r}"${r === currentRank ? ' selected' : ''}>${r}</option>`
  ).join('');

  const roleButtons = ROLES.map(r =>
    `<button class="filter-btn${r === currentRole ? ' active' : ''}" data-role="${r}">${r}</button>`
  ).join('');

  return `
    <div class="space-y-6">
      <!-- 헤더 필터 -->
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <label class="text-sm text-gray-400">랭크</label>
          <select id="rank-select" class="bg-ow-card border border-ow-border rounded px-2 py-1 text-sm text-gray-200 focus:outline-none">
            ${rankOptions}
          </select>
        </div>
        <div class="flex gap-1" id="role-filter">${roleButtons}</div>
      </div>

      <!-- ban 데이터 없음 배너 -->
      <div id="no-ban-banner" class="hidden rounded-lg border border-yellow-700 bg-yellow-900/20 px-4 py-2.5 text-sm text-yellow-300">
        밴 데이터 미제공 — 승률·픽률 기반 fallback 공식 적용 중 (통합 메타 = win×0.6 + pick×0.4)
      </div>

      <!-- 섹션 A: 지수 요약 카드 3개 -->
      <div id="index-cards" class="grid grid-cols-1 md:grid-cols-3 gap-4"></div>

      <!-- 섹션 B: 버블 차트 -->
      <div class="bg-ow-card border border-ow-border rounded-xl p-4">
        <h2 class="font-semibold text-gray-200 mb-1">존재감 vs 통합 메타지수</h2>
        <p class="text-xs text-gray-500 mb-4">X축: 존재감(픽+밴) &nbsp;|&nbsp; Y축: 통합 메타지수 &nbsp;|&nbsp; 크기: 밴 효율</p>
        <div class="relative" style="height:${CHART_H()};">
          <canvas id="bubble-chart"></canvas>
        </div>
      </div>

      <!-- 섹션 C: 종합 지수 테이블 -->
      <div class="bg-ow-card border border-ow-border rounded-xl p-4">
        <h2 class="font-semibold text-gray-200 mb-4">종합 지수 테이블</h2>
        <div id="index-table" class="overflow-x-auto"></div>
      </div>

      <!-- 섹션 D: 밴 효율 설명 + TOP15 바 차트 -->
      <div id="ban-chart-section" class="bg-ow-card border border-ow-border rounded-xl p-4">
        <h2 class="font-semibold text-gray-200 mb-1">밴 효율 지수 TOP 15</h2>

        <!-- 밴 효율 계산 방식 설명 -->
        <div class="mb-4 rounded-lg border border-ow-border bg-black/20 p-3 text-xs text-gray-400 space-y-2">
          <p class="font-semibold text-gray-300">밴 효율 지수 계산 방식</p>
          <p>
            <code class="text-purple-300">raw = ban_rate × (win_rate ÷ 50)</code>
          </p>
          <p>
            승률 50%를 기준선으로 삼아, 밴을 많이 당하면서 실제로 강한 영웅에게 높은 점수를 줍니다.
            최종 점수는 <code class="text-gray-300">raw ÷ max_raw × 100</code>으로 정규화해 0~100 범위로 표시합니다.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            <div class="rounded bg-green-900/30 border border-green-800/40 px-2 py-1.5">
              <p class="text-green-400 font-semibold mb-0.5">높음 — 필수 밴</p>
              <p>밴률 높음 + 승률 높음</p>
              <p class="text-gray-500 mt-0.5">예: 밴률 60% × 승률 56% ÷ 50 = 67.2</p>
            </div>
            <div class="rounded bg-yellow-900/30 border border-yellow-800/40 px-2 py-1.5">
              <p class="text-yellow-400 font-semibold mb-0.5">중간 — 상황적 밴</p>
              <p>밴률 높음 + 승률 보통</p>
              <p class="text-gray-500 mt-0.5">예: 밴률 60% × 승률 50% ÷ 50 = 60.0</p>
            </div>
            <div class="rounded bg-red-900/30 border border-red-800/40 px-2 py-1.5">
              <p class="text-red-400 font-semibold mb-0.5">낮음 — 과대 밴</p>
              <p>밴률 높음 + 승률 낮음</p>
              <p class="text-gray-500 mt-0.5">예: 밴률 60% × 승률 44% ÷ 50 = 52.8</p>
            </div>
          </div>
          <p class="text-gray-500">
            ※ 승률이 50% 미만이면 밴률에 감산 보정이 적용됩니다. 인식(밴률)과 실력(승률)의 괴리를 보여주는 지표입니다.
          </p>
        </div>

        <div id="ban-chart-inner" class="relative" style="height:${CHART_H()};">
          <canvas id="ban-chart"></canvas>
        </div>
        <div id="ban-chart-empty" class="hidden flex items-center justify-center h-32 text-gray-500 text-sm">
          밴 데이터가 없어 표시할 수 없습니다
        </div>
      </div>
    </div>`;
}

// ── 이벤트 바인딩 ─────────────────────────────────────────────────────────────
function attachEvents(container) {
  container.querySelector('#rank-select')?.addEventListener('change', e => {
    currentRank = e.target.value;
    renderAll(container);
  });

  container.querySelector('#role-filter')?.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    currentRole = btn.dataset.role;
    container.querySelectorAll('#role-filter .filter-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.role === currentRole)
    );
    renderAll(container);
  });
}

// ── 전체 렌더 ─────────────────────────────────────────────────────────────────
function renderAll(container) {
  const heroes = getFiltered();
  const hasBan = hasBanData(heroes);

  container.querySelector('#no-ban-banner')?.classList.toggle('hidden', hasBan);

  renderIndexCards(container, heroes, hasBan);
  renderBubbleChart(container, heroes, hasBan);
  renderRankingTable(container, heroes, hasBan);
  renderBanChart(container, heroes, hasBan);
}

// ── 섹션 A: 지수 요약 카드 ────────────────────────────────────────────────────
function renderIndexCards(container, heroes, hasBan) {
  const wrap = container.querySelector('#index-cards');
  if (!wrap) return;

  const byMeta = [...heroes].sort((a, b) => b.meta_score - a.meta_score);
  const byPresence = [...heroes].sort((a, b) => (b.presence_rate ?? b.pick_rate) - (a.presence_rate ?? a.pick_rate));
  const byBanEff = [...heroes].sort((a, b) => (b.ban_efficiency ?? 0) - (a.ban_efficiency ?? 0));

  const cards = [
    {
      title: '통합 메타 지수',
      formula: hasBan ? 'win×0.55 + pick×0.25 + ban×0.20' : 'win×0.6 + pick×0.4 (fallback)',
      desc: '승률·픽률·밴률을 종합한 메타 파워',
      topHeroes: byMeta.slice(0, 5),
      valKey: 'meta_score',
      color: '#f97316',
    },
    {
      title: '존재감 지수',
      formula: 'pick_rate + ban_rate (≤100%)',
      desc: '픽 또는 밴으로 경기에 관여하는 비율',
      topHeroes: byPresence.slice(0, 5),
      valKey: 'presence_rate',
      suffix: '%',
      color: '#4FC3F7',
    },
    {
      title: '밴 효율 지수',
      formula: 'ban_rate × (win_rate / 50)',
      desc: '밴 가치가 실제로 높은 영웅 (고밴+고승률)',
      topHeroes: hasBan ? byBanEff.slice(0, 5) : [],
      valKey: 'ban_efficiency',
      color: '#a855f7',
      empty: !hasBan,
    },
  ];

  wrap.innerHTML = cards.map(card => {
    const topHtml = card.empty
      ? `<div class="text-gray-500 text-xs mt-2">밴 데이터 없음</div>`
      : card.topHeroes.map((h, i) => {
          const val = h[card.valKey];
          const color = HERO_COLOR[h.hero_id] ?? FALLBACK_COLOR;
          const initial = escHtml(h.hero_name?.[0] ?? '?');
          const pUrl = portraitIndex[h.hero_id];
          const portraitHtml = pUrl
            ? `<img src="${pUrl}" alt="${escHtml(h.hero_name)}"
                    style="width:20px;height:20px;border-radius:50%;border:1px solid ${color}44;object-fit:cover;flex-shrink:0;"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" loading="lazy">
               <span style="display:none;width:20px;height:20px;border-radius:50%;background:${color}33;border:1px solid ${color}55;color:${color};font-size:0.6rem;font-weight:700;align-items:center;justify-content:center;flex-shrink:0;">${initial}</span>`
            : `<span style="display:flex;width:20px;height:20px;border-radius:50%;background:${color}33;border:1px solid ${color}55;color:${color};font-size:0.6rem;font-weight:700;align-items:center;justify-content:center;flex-shrink:0;">${initial}</span>`;
          return `
            <div class="flex items-center gap-2 py-1 ${i > 0 ? 'border-t border-ow-border' : ''}">
              <span class="text-gray-500 text-xs w-4">${i + 1}</span>
              ${portraitHtml}
              <span class="text-sm text-gray-200 flex-1 truncate">${escHtml(h.hero_name)}</span>
              <span class="text-sm font-bold" style="color:${card.color}">${val?.toFixed(1) ?? '-'}${card.suffix ?? ''}</span>
            </div>`;
        }).join('');

    return `
      <div class="bg-ow-card border border-ow-border rounded-xl p-4">
        <div class="flex items-start justify-between gap-2 mb-1">
          <h3 class="font-semibold text-gray-200 text-sm">${card.title}</h3>
        </div>
        <p class="text-xs text-gray-500 mb-0.5">${card.desc}</p>
        <code class="text-xs text-gray-600">${card.formula}</code>
        <div class="mt-3 space-y-0">${topHtml}</div>
      </div>`;
  }).join('');
}

// ── 섹션 B: 버블 차트 ────────────────────────────────────────────────────────
function renderBubbleChart(container, heroes, hasBan) {
  const canvas = container.querySelector('#bubble-chart');
  if (!canvas) return;

  if (bubbleChart) { bubbleChart.destroy(); bubbleChart = null; }

  const roleGroups = { tank: [], damage: [], support: [] };
  for (const h of heroes) {
    const role = h.role in roleGroups ? h.role : 'damage';
    const x = h.presence_rate ?? h.pick_rate ?? 0;
    const y = h.meta_score ?? 0;
    const r = hasBan
      ? Math.max(7, (h.ban_efficiency ?? 0) * 0.18 + 7)
      : Math.max(7, (h.meta_score ?? 0) * 0.1 + 5);
    roleGroups[role].push({ x, y, r, hero: h });
  }

  const avgPresence = heroes.length
    ? heroes.reduce((s, h) => s + (h.presence_rate ?? h.pick_rate ?? 0), 0) / heroes.length
    : 50;

  const quadrantPlugin = {
    id: 'quadrant',
    beforeDraw(chart) {
      const { ctx, chartArea: { left, right, top, bottom }, scales } = chart;
      const cx = scales.x.getPixelForValue(avgPresence);
      const cy = scales.y.getPixelForValue(50);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(left, cy); ctx.lineTo(right, cy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillText('숨겨진 강캐', left + 6, top + 14);
      ctx.fillText('메타 지배자', cx + 6, top + 14);
      ctx.fillText('비주류', left + 6, bottom - 6);
      ctx.fillText('인기 but 약세', cx + 6, bottom - 6);
      ctx.restore();
    },
  };

  bubbleChart = new Chart(canvas, {
    type: 'bubble',
    plugins: [quadrantPlugin],
    data: {
      datasets: Object.entries(roleGroups)
        .filter(([, pts]) => pts.length > 0)
        .map(([role, pts]) => ({
          label: ROLE_LABEL[role] ?? role,
          data: pts,
          backgroundColor: ROLE_COLOR[role] + '88',
          borderColor: ROLE_COLOR[role],
          borderWidth: 1,
        })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          min: 0, max: 100,
          title: { display: true, text: '존재감 지수 (%)', color: '#9ca3af' },
          ticks: { color: '#6b7280' },
          grid: { color: '#30363d' },
        },
        y: {
          min: 0, max: 100,
          title: { display: true, text: '통합 메타지수', color: '#9ca3af' },
          ticks: { color: '#6b7280' },
          grid: { color: '#30363d' },
        },
      },
      plugins: {
        legend: { labels: { color: '#d1d5db', boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label(ctx) {
              const h = ctx.raw.hero;
              return [
                ` ${h.hero_name}`,
                ` 메타지수: ${h.meta_score?.toFixed(1) ?? '-'}`,
                ` 존재감:   ${(h.presence_rate ?? h.pick_rate)?.toFixed(1) ?? '-'}%`,
                ` 밴 효율:  ${h.ban_efficiency?.toFixed(1) ?? '-'}`,
                ` 픽률:     ${h.pick_rate?.toFixed(1) ?? '-'}%`,
                ` 승률:     ${h.win_rate?.toFixed(1) ?? '-'}%`,
                ` 밴률:     ${h.ban_rate?.toFixed(1) ?? '-'}%`,
              ];
            },
          },
        },
      },
    },
  });
}

// ── 섹션 C: 종합 지수 테이블 ─────────────────────────────────────────────────
function renderRankingTable(container, heroes, hasBan) {
  const wrap = container.querySelector('#index-table');
  if (!wrap) return;

  const sorted = [...heroes].sort((a, b) => {
    const av = a[sortCol] ?? 0;
    const bv = b[sortCol] ?? 0;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const th = (col, label) => {
    const isActive = sortCol === col;
    const arrow = isActive ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
    return `<th class="meta-th px-3 py-2 text-left text-xs font-semibold text-gray-400 cursor-pointer select-none whitespace-nowrap${isActive ? ' text-gray-200' : ''}"
                data-sort="${col}">${label}${arrow}</th>`;
  };

  const banCols = hasBan
    ? `${th('presence_rate', '존재감')}${th('ban_efficiency', '밴 효율')}${th('ban_rate', '밴률')}`
    : '';

  const rows = sorted.map(h => {
    const color = HERO_COLOR[h.hero_id] ?? FALLBACK_COLOR;
    const tierColor = TIER_COLOR[h.tier] ?? '#6b7280';
    const initial = escHtml(h.hero_name?.[0] ?? '?');
    const banCells = hasBan
      ? `<td class="px-3 py-2 text-sm text-right">${(h.presence_rate ?? h.pick_rate)?.toFixed(1) ?? '-'}%</td>
         <td class="px-3 py-2 text-sm text-right">${h.ban_efficiency?.toFixed(1) ?? '-'}</td>
         <td class="px-3 py-2 text-sm text-right">${h.ban_rate?.toFixed(1) ?? '-'}%</td>`
      : '';

    return `
      <tr class="meta-table-row border-t border-ow-border hover:bg-white/5 cursor-default"
          data-hero-id="${h.hero_id}">
        <td class="px-3 py-2">
          <div class="flex items-center gap-2">
            <div class="relative shrink-0" style="width:28px;height:28px;">
              ${portraitIndex[h.hero_id] ? `
              <img src="${portraitIndex[h.hero_id]}" alt="${escHtml(h.hero_name)}"
                   class="hero-portrait hero-portrait-sm"
                   style="width:28px;height:28px;border:1px solid ${color}44;"
                   onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" loading="lazy">
              ` : ''}
              <span class="hero-portrait-fallback hero-portrait-sm"
                    style="${portraitIndex[h.hero_id] ? 'display:none;' : ''}width:28px;height:28px;background:${color}33;border:1px solid ${color}44;font-size:0.65rem;">${initial}</span>
            </div>
            <span class="text-sm font-medium text-gray-200 whitespace-nowrap">${escHtml(h.hero_name)}</span>
          </div>
        </td>
        <td class="px-3 py-2">
          <span class="text-xs px-1.5 py-0.5 rounded ${ROLE_CLASS[h.role] ?? ''}">${ROLE_LABEL[h.role] ?? h.role}</span>
        </td>
        <td class="px-3 py-2">
          <span class="font-bold text-xs px-1.5 py-0.5 rounded" style="color:${tierColor};background:${tierColor}22">${h.tier}</span>
        </td>
        <td class="px-3 py-2 text-sm font-bold text-right" style="color:${color}">${h.meta_score?.toFixed(1) ?? '-'}</td>
        <td class="px-3 py-2 text-sm text-right">${h.pick_rate?.toFixed(1) ?? '-'}%</td>
        <td class="px-3 py-2 text-sm text-right">${h.win_rate?.toFixed(1) ?? '-'}%</td>
        ${banCells}
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="meta-table w-full border-collapse text-sm">
      <thead>
        <tr class="text-left">
          <th class="px-3 py-2 text-xs font-semibold text-gray-400">영웅</th>
          <th class="px-3 py-2 text-xs font-semibold text-gray-400">역할</th>
          <th class="px-3 py-2 text-xs font-semibold text-gray-400">티어</th>
          ${th('meta_score', '통합 메타')}
          ${th('pick_rate', '픽률')}
          ${th('win_rate', '승률')}
          ${banCols}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  wrap.querySelectorAll('.meta-th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortCol === col) {
        sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        sortCol = col;
        sortDir = 'desc';
      }
      renderRankingTable(container, heroes, hasBan);
    });
  });
}

// ── 섹션 D: 밴 효율 TOP15 수평 바 차트 ───────────────────────────────────────
function renderBanChart(container, heroes, hasBan) {
  const section = container.querySelector('#ban-chart-section');
  const inner = container.querySelector('#ban-chart-inner');
  const empty = container.querySelector('#ban-chart-empty');
  const canvas = container.querySelector('#ban-chart');
  if (!section || !canvas) return;

  if (banChart) { banChart.destroy(); banChart = null; }

  if (!hasBan) {
    inner?.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }

  inner?.classList.remove('hidden');
  empty?.classList.add('hidden');

  const top15 = [...heroes]
    .sort((a, b) => (b.ban_efficiency ?? 0) - (a.ban_efficiency ?? 0))
    .slice(0, 15);

  banChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top15.map(h => h.hero_name),
      datasets: [{
        data: top15.map(h => h.ban_efficiency ?? 0),
        backgroundColor: top15.map(h => (HERO_COLOR[h.hero_id] ?? FALLBACK_COLOR) + 'bb'),
        borderColor: top15.map(h => HERO_COLOR[h.hero_id] ?? FALLBACK_COLOR),
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const h = top15[ctx.dataIndex];
              return [
                ` 밴 효율: ${ctx.parsed.x.toFixed(1)}`,
                ` 밴률: ${h.ban_rate?.toFixed(1) ?? '-'}%`,
                ` 승률: ${h.win_rate?.toFixed(1) ?? '-'}%`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          min: 0, max: 100,
          title: { display: true, text: '밴 효율 지수', color: '#9ca3af' },
          ticks: { color: '#6b7280' },
          grid: { color: '#30363d' },
        },
        y: {
          ticks: { color: '#d1d5db' },
          grid: { color: '#30363d' },
        },
      },
    },
  });
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────
function getFiltered() {
  const heroes = cachedMeta?.[currentRank] ?? [];
  return currentRole === '전체' ? heroes : heroes.filter(h => h.role === ROLE_MAP[currentRole]);
}

function hasBanData(heroes) {
  return heroes.some(h => (h.ban_rate ?? 0) > 0);
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
