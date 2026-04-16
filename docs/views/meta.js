/**
 * 메타 통계 뷰
 * 상단: 전체 영웅 메타 점수 가로 막대 차트
 *   → 영웅 카드/막대 클릭 시 해당 영웅 히스토리 라인 차트로 전환
 *   → "← 전체 보기" 클릭 시 복귀
 * 하단: 티어별 영웅 카드 그리드
 */
import { loadJSON } from '../app.js';

const RANKS = ['전체', '브론즈', '실버', '골드', '플래티넘', '다이아몬드', '마스터', '그랜드마스터', '챔피언'];
const ROLES = ['전체', '탱커', '딜러', '지원가'];
const TIERS = ['S', 'A', 'B', 'C', 'D'];
const ROLE_MAP = { '탱커': 'tank', '딜러': 'damage', '지원가': 'support' };
const TIER_COLOR = { S: '#ef4444', A: '#f97316', B: '#eab308', C: '#22c55e', D: '#6b7280' };
const ROLE_LABEL = { tank: '탱커', damage: '딜러', support: '지원가' };
const ROLE_CLASS = { tank: 'role-tank', damage: 'role-damage', support: 'role-support' };

let currentRank = '전체';
let currentRole = '전체';
let selectedHeroId = null;
let selectedHeroName = null;
let activeChart = null;
let cachedMeta = null;
let cachedHistory = null;

export async function renderMeta(container) {
  [cachedMeta, cachedHistory] = await Promise.all([
    loadJSON('meta'),
    loadJSON('meta_history').catch(() => null),
  ]);

  container.innerHTML = buildHTML();
  attachEvents(container);
  renderChart(container);
  renderCards(container);
}

// ── HTML 골격 ──────────────────────────────────────────────────────────────

function buildHTML() {
  const rankOptions = RANKS.map(r =>
    `<option value="${r}"${r === currentRank ? ' selected' : ''}>${r}</option>`
  ).join('');

  const roleButtons = ROLES.map(r =>
    `<button class="filter-btn${r === currentRole ? ' active' : ''}" data-role="${r}">${r}</button>`
  ).join('');

  return `
    <!-- 컨트롤 바 -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <select class="ow-select" id="rank-select">${rankOptions}</select>
      <div class="flex gap-2 flex-wrap">${roleButtons}</div>
      <span class="ml-auto text-xs text-gray-500" id="hero-count"></span>
    </div>

    <!-- 차트 패널 -->
    <div class="bg-ow-card border border-ow-border rounded-xl mb-6 overflow-hidden" id="chart-panel">
      <div class="flex items-center justify-between px-5 pt-4 pb-2">
        <span class="text-sm font-semibold text-gray-200" id="chart-title"></span>
        <button
          class="text-xs text-ow-blue hover:text-white transition-colors hidden px-2 py-1 rounded border border-ow-border hover:border-ow-blue"
          id="chart-back">← 전체 보기</button>
      </div>
      <div id="chart-scroll" style="overflow-y:auto; max-height:380px;">
        <div id="chart-wrapper" class="px-4 pb-4" style="position:relative;">
          <canvas id="meta-chart"></canvas>
        </div>
      </div>
    </div>

    <!-- 영웅 카드 그리드 -->
    <div id="meta-grid"></div>
  `;
}

// ── 이벤트 ────────────────────────────────────────────────────────────────

function attachEvents(container) {
  container.querySelector('#rank-select').addEventListener('change', e => {
    currentRank = e.target.value;
    resetSelection(container);
    renderChart(container);
    renderCards(container);
  });

  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRole = btn.dataset.role;
      if (!selectedHeroId) renderChart(container);
      renderCards(container);
    });
  });

  container.querySelector('#chart-back').addEventListener('click', () => {
    resetSelection(container);
    renderChart(container);
    renderCards(container);
  });

  container.querySelector('#meta-grid').addEventListener('click', e => {
    const card = e.target.closest('.hero-card');
    if (!card) return;
    selectHero(container, card.dataset.heroId, card.dataset.heroName);
  });
}

function selectHero(container, heroId, heroName) {
  if (selectedHeroId === heroId) {
    resetSelection(container);
    renderChart(container);
    renderCards(container);
    return;
  }
  selectedHeroId = heroId;
  selectedHeroName = heroName;
  container.querySelector('#chart-back').classList.remove('hidden');
  renderChart(container);
  renderCards(container);
  container.querySelector('#chart-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetSelection(container) {
  selectedHeroId = null;
  selectedHeroName = null;
  container.querySelector('#chart-back')?.classList.add('hidden');
}

// ── 차트 렌더링 ──────────────────────────────────────────────────────────

function renderChart(container) {
  if (activeChart) { activeChart.destroy(); activeChart = null; }
  selectedHeroId ? renderHistoryChart(container) : renderOverviewChart(container);
}

function renderOverviewChart(container) {
  container.querySelector('#chart-title').textContent =
    `전체 영웅 메타 점수 추이 — ${currentRank}`;
  container.querySelector('#chart-scroll').style.maxHeight = '320px';

  const wrapper = container.querySelector('#chart-wrapper');
  wrapper.style.height = '280px';

  const canvas = container.querySelector('#meta-chart');
  canvas.style.width = '100%';
  canvas.style.height = '280px';

  // 히스토리 데이터로 멀티라인 구성
  const rankData = cachedHistory?.[currentRank] ?? cachedHistory?.['전체'];
  if (!rankData || !Object.keys(rankData).length) {
    wrapper.innerHTML = noDataMsg('히스토리 데이터가 없습니다. 내일 다시 확인해주세요.');
    return;
  }

  const dates = Object.keys(rankData).sort();
  const labelDates = dates.map(d => d.slice(5)); // MM-DD

  // 영웅별 점수 배열 구성
  const heroMap = {};
  for (const date of dates) {
    for (const h of rankData[date] ?? []) {
      if (!heroMap[h.hero_id]) {
        heroMap[h.hero_id] = { hero_id: h.hero_id, hero_name: h.hero_name, tier: h.tier, scores: new Array(dates.length).fill(null) };
      }
      heroMap[h.hero_id].scores[dates.indexOf(date)] = h.meta_score ?? null;
    }
  }

  // 역할 필터 적용 (현재 스냅샷 기준)
  const roleFilter = ROLE_MAP[currentRole];
  const currentHeroes = cachedMeta?.[currentRank] ?? [];
  const roleSet = roleFilter
    ? new Set(currentHeroes.filter(h => h.role === roleFilter).map(h => h.hero_id))
    : null;
  // 현재 티어로 갱신
  const tierMap = Object.fromEntries(currentHeroes.map(h => [h.hero_id, h.tier]));

  const filteredHeroes = Object.values(heroMap).filter(h => !roleSet || roleSet.has(h.hero_id));
  filteredHeroes.forEach(h => { h.tier = tierMap[h.hero_id] ?? h.tier; });

  const datasets = filteredHeroes.map(hero => {
    const color = TIER_COLOR[hero.tier] ?? '#6b7280';
    return {
      label: hero.hero_name,
      heroId: hero.hero_id,
      data: hero.scores,
      borderColor: color + 'cc',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: color,
      spanGaps: true,
      tension: 0.3,
    };
  });

  activeChart = new Chart(canvas, {
    type: 'line',
    data: { labels: labelDates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      onClick(_, elements) {
        if (!elements.length) return;
        const ds = datasets[elements[0].datasetIndex];
        selectHero(container, ds.heroId, ds.label);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#161B22',
          borderColor: '#30363D',
          borderWidth: 1,
          itemSort: (a, b) => b.parsed.y - a.parsed.y,
          filter: item => item.parsed.y !== null,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1) ?? '-'}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#6B7280', font: { size: 10 }, maxTicksLimit: 14 },
          grid: { color: '#1F2937' },
        },
        y: {
          min: 0, max: 100,
          ticks: { color: '#6B7280', font: { size: 10 } },
          grid: { color: '#1F2937' },
        },
      },
    },
  });
}

function renderHistoryChart(container) {
  const color = (() => {
    const hero = (cachedMeta?.[currentRank] ?? []).find(h => h.hero_id === selectedHeroId);
    return TIER_COLOR[hero?.tier] ?? '#F5A623';
  })();

  container.querySelector('#chart-title').textContent =
    `${selectedHeroName} — 메타 점수 추이 (${currentRank})`;
  container.querySelector('#chart-scroll').style.maxHeight = '320px';

  const wrapper = container.querySelector('#chart-wrapper');
  wrapper.style.height = '280px';

  const canvas = container.querySelector('#meta-chart');
  canvas.style.width = '100%';
  canvas.style.height = '280px';

  const rankData = cachedHistory?.[currentRank] ?? cachedHistory?.['전체'];
  if (!rankData) { wrapper.innerHTML = noDataMsg('히스토리 데이터가 없습니다.'); return; }

  const dates = Object.keys(rankData).sort();
  const scores = dates.map(d => rankData[d]?.find(h => h.hero_id === selectedHeroId)?.meta_score ?? null);

  if (!scores.some(s => s !== null)) {
    wrapper.innerHTML = noDataMsg('이 영웅의 히스토리 데이터가 없습니다.');
    return;
  }

  activeChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: dates.map(d => d.slice(5)),
      datasets: [{
        label: selectedHeroName,
        data: scores,
        borderColor: color,
        backgroundColor: color + '15',
        borderWidth: 2.5,
        pointRadius: dates.length <= 14 ? 4 : 2,
        pointBackgroundColor: color,
        spanGaps: true,
        tension: 0.35,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#161B22',
          borderColor: '#30363D',
          borderWidth: 1,
          callbacks: {
            title: ctx => dates[ctx[0].dataIndex],
            label: ctx => ` 메타 점수: ${ctx.parsed.y?.toFixed(1) ?? 'N/A'}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#6B7280', maxTicksLimit: 14, font: { size: 10 } },
          grid: { color: '#1F2937' },
        },
        y: {
          min: 0, max: 100,
          ticks: { color: '#6B7280', font: { size: 10 } },
          grid: { color: '#1F2937' },
        },
      },
    },
  });
}

function noDataMsg(msg) {
  return `<p class="flex items-center justify-center h-full text-gray-500 text-sm py-16">${msg}</p>`;
}

// ── 영웅 카드 그리드 ───────────────────────────────────────────────────────

function renderCards(container) {
  const filtered = getFiltered();
  const countEl = container.querySelector('#hero-count');
  if (countEl) countEl.textContent = `${filtered.length}명`;

  const grid = container.querySelector('#meta-grid');
  if (!filtered.length) {
    grid.innerHTML = `<p class="text-center text-gray-500 py-12">데이터가 없습니다.</p>`;
    return;
  }

  const byTier = Object.fromEntries(TIERS.map(t => [t, []]));
  filtered.forEach(h => (byTier[h.tier ?? 'D'] ??= []).push(h));

  grid.innerHTML = TIERS.filter(t => byTier[t]?.length).map(tier => `
    <div class="mb-6">
      <div class="tier-header-${tier} pl-3 mb-3 flex items-center gap-3">
        <span class="text-sm font-bold tier-${tier} border px-2 py-0.5 rounded">${tier}</span>
        <span class="text-sm text-gray-400">${byTier[tier].length}명</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        ${byTier[tier].map(heroCard).join('')}
      </div>
    </div>
  `).join('');
}

function heroCard(h) {
  const isSelected = h.hero_id === selectedHeroId;
  return `
    <div class="hero-card${isSelected ? ' selected' : ''}"
         data-hero-id="${h.hero_id}" data-hero-name="${h.hero_name}">
      <div class="flex items-start justify-between mb-1.5 gap-1">
        <span class="font-semibold text-sm leading-tight">${h.hero_name}</span>
        <span class="text-xs px-1.5 py-0.5 rounded shrink-0 ${ROLE_CLASS[h.role] ?? ''}">
          ${ROLE_LABEL[h.role] ?? h.role}
        </span>
      </div>
      <div class="text-ow-orange font-bold text-xl mb-1.5">${h.meta_score?.toFixed(1) ?? '-'}</div>
      <div class="text-xs text-gray-400 space-y-0.5">
        <div>픽률 <span class="text-gray-200">${h.pick_rate?.toFixed(1) ?? '-'}%</span></div>
        <div>승률 <span class="text-gray-200">${h.win_rate?.toFixed(1) ?? '-'}%</span></div>
      </div>
    </div>
  `;
}

function getFiltered() {
  const heroes = cachedMeta?.[currentRank] ?? [];
  return currentRole === '전체' ? heroes : heroes.filter(h => h.role === ROLE_MAP[currentRole]);
}
