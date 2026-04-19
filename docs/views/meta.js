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
const HERO_COLOR = {
  // Tanks
  dva:           '#F472B6',
  doomfist:      '#D97706',
  hazard:        '#10B981',
  junker_queen:  '#EF4444',
  mauga:         '#991B1B',
  orisa:         '#65A30D',
  ramattra:      '#7C3AED',
  reinhardt:     '#94A3B8',
  roadhog:       '#92400E',
  sigma:         '#60A5FA',
  winston:       '#8B5CF6',
  wrecking_ball: '#F59E0B',
  zarya:         '#EC4899',
  // Damage
  ashe:          '#B91C1C',
  bastion:       '#4D7C0F',
  cassidy:       '#B45309',
  echo:          '#38BDF8',
  freja:         '#2563EB',
  genji:         '#4ADE80',
  hanzo:         '#1D4ED8',
  junkrat:       '#FBBF24',
  mei:           '#93C5FD',
  pharah:        '#3B82F6',
  reaper:        '#6B7280',
  sojourn:       '#F97316',
  soldier76:     '#475569',
  sombra:        '#A855F7',
  symmetra:      '#06B6D4',
  torbjorn:      '#DC2626',
  tracer:        '#FB923C',
  vendetta:      '#7F1D1D',
  venture:       '#C2410C',
  widowmaker:    '#C026D3',
  // Support
  ana:           '#0EA5E9',
  baptiste:      '#0D9488',
  briggitte:     '#E97419',
  illari:        '#EAB308',
  juno:          '#818CF8',
  kiriko:        '#F43F5E',
  lifeweaver:    '#FB7185',
  lucio:         '#22D3EE',
  mercy:         '#FCD34D',
  moira:         '#9333EA',
  zenyatta:      '#FFD700',
  // 미출시 영웅
  wuyang:        '#9CA3AF',
  mizuki:        '#9CA3AF',
  emre:          '#9CA3AF',
  domina:        '#9CA3AF',
  anran:         '#9CA3AF',
  jetpack_cat:   '#9CA3AF',
  sierra:        '#9CA3AF',
};
const FALLBACK_COLOR = '#9CA3AF';
const ROLE_LABEL = { tank: '탱커', damage: '딜러', support: '지원가' };
const ROLE_CLASS = { tank: 'role-tank', damage: 'role-damage', support: 'role-support' };

const MAP_TYPES = ['전체', '제어', '호위', '혼합', '밀기', '플래시포인트', '격돌'];
const MAP_LIST = [
  { id: 'antarctic-peninsula', name: '남극 반도',          type: '제어' },
  { id: 'busan',               name: '부산',               type: '제어' },
  { id: 'ilios',               name: '일리오스',           type: '제어' },
  { id: 'lijiang-tower',       name: '리장 타워',          type: '제어' },
  { id: 'nepal',               name: '네팔',               type: '제어' },
  { id: 'oasis',               name: '오아시스',           type: '제어' },
  { id: 'samoa',               name: '사모아',             type: '제어' },
  { id: 'circuit-royal',       name: '서킷 로얄',          type: '호위' },
  { id: 'dorado',              name: '도라도',             type: '호위' },
  { id: 'havana',              name: '하바나',             type: '호위' },
  { id: 'junkertown',          name: '쓰레기촌',           type: '호위' },
  { id: 'rialto',              name: '리알토',             type: '호위' },
  { id: 'route-66',            name: '66번 국도',          type: '호위' },
  { id: 'shambali-monastery',  name: '샴발리 수도원',      type: '호위' },
  { id: 'watchpoint-gibraltar',name: '감시 기지: 지브롤터',type: '호위' },
  { id: 'blizzard-world',      name: '블리자드 월드',      type: '혼합' },
  { id: 'eichenwalde',         name: '아이헨발데',         type: '혼합' },
  { id: 'hollywood',           name: '할리우드',           type: '혼합' },
  { id: 'kings-row',           name: '왕의 길',            type: '혼합' },
  { id: 'midtown',             name: '미드타운',           type: '혼합' },
  { id: 'numbani',             name: '눔바니',             type: '혼합' },
  { id: 'paraiso',             name: '파라이수',           type: '혼합' },
  { id: 'colosseum',           name: '콜로세오',           type: '밀기' },
  { id: 'esperanca',           name: '이스페란사',         type: '밀기' },
  { id: 'new-queen-street',    name: '뉴 퀸 스트리트',     type: '밀기' },
  { id: 'runasapi',            name: '루나사피',           type: '밀기' },
  { id: 'new-junk-city',       name: '뉴 정크 시티',       type: '플래시포인트' },
  { id: 'suravasa',            name: '수라바사',           type: '플래시포인트' },
  { id: 'hanaoka',             name: '하나오카',           type: '격돌' },
  { id: 'throne-of-anubis',    name: '아누비스의 왕좌',    type: '격돌' },
];

let currentRank = '전체';
let currentRole = '전체';
let currentMode = 'rank';   // 'rank' | 'map'
let currentMap = null;
let currentMapType = '전체';
let selectedHeroId = null;
let selectedHeroName = null;
let activeChart = null;
let cachedMeta = null;
let cachedHistory = null;
let cachedMapMeta = null;
let cachedMapHistory = null;

export async function renderMeta(container) {
  [cachedMeta, cachedHistory, cachedMapMeta, cachedMapHistory] = await Promise.all([
    loadJSON('meta'),
    loadJSON('meta_history').catch(() => null),
    loadJSON('map_meta').catch(() => null),
    loadJSON('map_meta_history').catch(() => null),
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

  const mapTypeButtons = MAP_TYPES.map(t =>
    `<button class="filter-btn${t === currentMapType ? ' active' : ''}" data-map-type="${t}">${t}</button>`
  ).join('');

  const visibleMaps = currentMapType === '전체' ? MAP_LIST : MAP_LIST.filter(m => m.type === currentMapType);
  const mapButtons = visibleMaps.map(m => {
    const hasData = !!(cachedMapMeta?.[m.id]);
    return `<button class="map-btn${m.id === currentMap ? ' active' : ''}"
                    data-map-id="${m.id}"${!hasData ? ' disabled' : ''}>${m.name}</button>`;
  }).join('');

  const isMap = currentMode === 'map';

  return `
    <!-- 모드 탭 -->
    <div class="flex gap-2 mb-4">
      <button class="mode-tab${!isMap ? ' active' : ''}" data-mode="rank">랭크별</button>
      <button class="mode-tab${isMap ? ' active' : ''}" data-mode="map">맵별</button>
    </div>

    <!-- 랭크별 컨트롤 -->
    <div id="rank-controls" class="${isMap ? 'hidden ' : ''}mb-4 flex flex-wrap items-center gap-3">
      <select class="ow-select" id="rank-select">${rankOptions}</select>
      <div class="flex gap-2 flex-wrap">${roleButtons}</div>
      <span class="ml-auto text-xs text-gray-500" class="hero-count"></span>
    </div>

    <!-- 맵별 컨트롤 -->
    <div id="map-controls" class="${!isMap ? 'hidden ' : ''}mb-4">
      <div class="flex gap-2 flex-wrap mb-2">${mapTypeButtons}</div>
      <div class="flex gap-2 flex-wrap mb-3" id="map-btn-grid">${mapButtons}</div>
      <div class="flex gap-2 flex-wrap items-center">
        ${roleButtons.replace(/data-role/g, 'data-role')}
        <span class="ml-auto text-xs text-gray-500" class="hero-count"></span>
      </div>
    </div>

    <!-- 차트 패널 -->
    <div class="bg-ow-card border border-ow-border rounded-xl mb-6 overflow-hidden" id="chart-panel">
      <div class="flex items-center justify-between px-5 pt-4 pb-2">
        <span class="text-sm font-semibold text-gray-200" id="chart-title"></span>
        <button
          class="text-xs text-ow-blue hover:text-white transition-colors hidden px-2 py-1 rounded border border-ow-border hover:border-ow-blue"
          id="chart-back">← 전체 보기</button>
      </div>
      <div id="chart-scroll" style="overflow-y:auto; max-height:640px;">
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
  // 모드 탭
  container.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === currentMode) return;
      currentMode = btn.dataset.mode;
      resetSelection(container);
      container.innerHTML = buildHTML();
      attachEvents(container);
      renderChart(container);
      renderCards(container);
    });
  });

  // 랭크 선택
  container.querySelector('#rank-select')?.addEventListener('change', e => {
    currentRank = e.target.value;
    resetSelection(container);
    renderChart(container);
    renderCards(container);
  });

  // 역할 필터 (랭크/맵 양쪽)
  container.querySelectorAll('.filter-btn[data-role]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-btn[data-role]').forEach(b => b.classList.remove('active'));
      container.querySelectorAll(`.filter-btn[data-role="${btn.dataset.role}"]`).forEach(b => b.classList.add('active'));
      currentRole = btn.dataset.role;
      if (!selectedHeroId) renderChart(container);
      renderCards(container);
    });
  });

  // 맵 타입 필터
  container.querySelectorAll('.filter-btn[data-map-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-btn[data-map-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMapType = btn.dataset.mapType;
      renderMapButtons(container);
    });
  });

  // 맵 선택
  container.querySelector('#map-btn-grid')?.addEventListener('click', e => {
    const btn = e.target.closest('.map-btn');
    if (!btn || btn.disabled) return;
    currentMap = btn.dataset.mapId;
    resetSelection(container);
    container.querySelectorAll('.map-btn').forEach(b => b.classList.toggle('active', b.dataset.mapId === currentMap));
    renderChart(container);
    renderCards(container);
  });

  // 차트 뒤로가기
  container.querySelector('#chart-back')?.addEventListener('click', () => {
    resetSelection(container);
    renderChart(container);
    renderCards(container);
  });

  // 영웅 카드 클릭 → 히스토리 차트
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
  if (currentMode === 'map') {
    selectedHeroId ? renderMapHistoryChart(container) : renderMapOverviewChart(container);
  } else {
    selectedHeroId ? renderHistoryChart(container) : renderOverviewChart(container);
  }
}

function renderOverviewChart(container) {
  container.querySelector('#chart-title').textContent =
    `전체 영웅 메타 점수 추이 — ${currentRank}`;
  container.querySelector('#chart-scroll').style.maxHeight = '640px';

  const wrapper = container.querySelector('#chart-wrapper');
  wrapper.style.height = '560px';

  const canvas = container.querySelector('#meta-chart');
  canvas.style.width = '100%';
  canvas.style.height = '560px';

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
    const color = HERO_COLOR[hero.hero_id] ?? FALLBACK_COLOR;
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
  const color = HERO_COLOR[selectedHeroId] ?? FALLBACK_COLOR;

  container.querySelector('#chart-title').textContent =
    `${selectedHeroName} — 메타 점수 추이 (${currentRank})`;
  container.querySelector('#chart-scroll').style.maxHeight = '640px';

  const wrapper = container.querySelector('#chart-wrapper');
  wrapper.style.height = '560px';

  const canvas = container.querySelector('#meta-chart');
  canvas.style.width = '100%';
  canvas.style.height = '560px';

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

// ── 맵별 차트 ────────────────────────────────────────────────────────────────

function renderMapOverviewChart(container) {
  const mapName = MAP_LIST.find(m => m.id === currentMap)?.name ?? currentMap ?? '';
  container.querySelector('#chart-title').textContent =
    currentMap ? `전체 영웅 메타 점수 추이 — ${mapName}` : '맵을 선택하세요';
  container.querySelector('#chart-scroll').style.maxHeight = '640px';

  const wrapper = container.querySelector('#chart-wrapper');
  wrapper.style.height = '560px';
  const canvas = container.querySelector('#meta-chart');
  canvas.style.width = '100%';
  canvas.style.height = '560px';

  if (!currentMap) { wrapper.innerHTML = noDataMsg('맵을 선택하면 차트가 표시됩니다.'); return; }

  const mapData = cachedMapHistory?.[currentMap];
  if (!mapData || !Object.keys(mapData).length) {
    wrapper.innerHTML = noDataMsg('히스토리 데이터가 없습니다. 내일 다시 확인해주세요.');
    return;
  }

  const dates = Object.keys(mapData).sort();
  const labelDates = dates.map(d => d.slice(5));

  // hero_name / role은 cachedMapMeta에서 보완
  const infoMap = Object.fromEntries(
    (cachedMapMeta?.[currentMap] ?? []).map(h => [h.hero_id, h])
  );
  const heroMap = {};
  for (const date of dates) {
    for (const h of mapData[date] ?? []) {
      if (!heroMap[h.hero_id]) {
        const info = infoMap[h.hero_id] ?? {};
        heroMap[h.hero_id] = {
          hero_id: h.hero_id,
          hero_name: info.hero_name ?? h.hero_id,
          role: info.role ?? 'damage',
          scores: new Array(dates.length).fill(null),
        };
      }
      heroMap[h.hero_id].scores[dates.indexOf(date)] = h.meta_score ?? null;
    }
  }

  const roleFilter = ROLE_MAP[currentRole];
  const roleSet = roleFilter
    ? new Set(Object.values(infoMap).filter(h => h.role === roleFilter).map(h => h.hero_id))
    : null;

  const filteredHeroes = Object.values(heroMap).filter(h => !roleSet || roleSet.has(h.hero_id));
  const datasets = filteredHeroes.map(hero => {
    const color = HERO_COLOR[hero.hero_id] ?? FALLBACK_COLOR;
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
          backgroundColor: '#161B22', borderColor: '#30363D', borderWidth: 1,
          itemSort: (a, b) => b.parsed.y - a.parsed.y,
          filter: item => item.parsed.y !== null,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1) ?? '-'}` },
        },
      },
      scales: {
        x: { ticks: { color: '#6B7280', font: { size: 10 }, maxTicksLimit: 14 }, grid: { color: '#1F2937' } },
        y: { min: 0, max: 100, ticks: { color: '#6B7280', font: { size: 10 } }, grid: { color: '#1F2937' } },
      },
    },
  });
}

function renderMapHistoryChart(container) {
  const color = HERO_COLOR[selectedHeroId] ?? FALLBACK_COLOR;
  const mapName = MAP_LIST.find(m => m.id === currentMap)?.name ?? currentMap ?? '';
  container.querySelector('#chart-title').textContent =
    `${selectedHeroName} — 메타 점수 추이 (${mapName})`;
  container.querySelector('#chart-scroll').style.maxHeight = '640px';

  const wrapper = container.querySelector('#chart-wrapper');
  wrapper.style.height = '560px';
  const canvas = container.querySelector('#meta-chart');
  canvas.style.width = '100%';
  canvas.style.height = '560px';

  const mapData = cachedMapHistory?.[currentMap];
  if (!mapData) { wrapper.innerHTML = noDataMsg('히스토리 데이터가 없습니다.'); return; }

  const dates = Object.keys(mapData).sort();
  const scores = dates.map(d => mapData[d]?.find(h => h.hero_id === selectedHeroId)?.meta_score ?? null);

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
          backgroundColor: '#161B22', borderColor: '#30363D', borderWidth: 1,
          callbacks: {
            title: ctx => dates[ctx[0].dataIndex],
            label: ctx => ` 메타 점수: ${ctx.parsed.y?.toFixed(1) ?? 'N/A'}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#6B7280', maxTicksLimit: 14, font: { size: 10 } }, grid: { color: '#1F2937' } },
        y: { min: 0, max: 100, ticks: { color: '#6B7280', font: { size: 10 } }, grid: { color: '#1F2937' } },
      },
    },
  });
}

function noDataMsg(msg) {
  return `<p class="flex items-center justify-center h-full text-gray-500 text-sm py-16">${msg}</p>`;
}

// ── 영웅 카드 그리드 ───────────────────────────────────────────────────────

function getPrevScoreMap(rank) {
  const rankData = cachedHistory?.[rank] ?? cachedHistory?.['전체'];
  if (!rankData) return {};
  const dates = Object.keys(rankData).sort();
  const today = new Date().toISOString().slice(0, 10);
  const prevDate = [...dates].reverse().find(d => d < today);
  if (!prevDate) return {};
  return Object.fromEntries(
    (rankData[prevDate] ?? []).map(h => [h.hero_id, h.meta_score])
  );
}

function renderCards(container) {
  const filtered = getFiltered();
  container.querySelectorAll('.hero-count').forEach(el => { el.textContent = `${filtered.length}명`; });

  const grid = container.querySelector('#meta-grid');
  if (!filtered.length) {
    const msg = currentMode === 'map' && !currentMap
      ? '맵을 선택하면 해당 맵의 영웅 통계를 볼 수 있습니다.'
      : '데이터가 없습니다.';
    grid.innerHTML = `<p class="text-center text-gray-500 py-12">${msg}</p>`;
    return;
  }

  const prevMap = getPrevScoreMap(currentRank);

  const byTier = Object.fromEntries(TIERS.map(t => [t, []]));
  filtered.forEach(h => (byTier[h.tier ?? 'D'] ??= []).push(h));

  grid.innerHTML = TIERS.filter(t => byTier[t]?.length).map(tier => `
    <div class="mb-6">
      <div class="tier-header-${tier} pl-3 mb-3 flex items-center gap-3">
        <span class="text-sm font-bold tier-${tier} border px-2 py-0.5 rounded">${tier}</span>
        <span class="text-sm text-gray-400">${byTier[tier].length}명</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        ${byTier[tier].map(h => heroCard(h, prevMap[h.hero_id])).join('')}
      </div>
    </div>
  `).join('');
}

function heroCard(h, prevScore) {
  const isSelected = currentMode === 'rank' && h.hero_id === selectedHeroId;
  const color = HERO_COLOR[h.hero_id] ?? FALLBACK_COLOR;
  const delta = (prevScore != null && h.meta_score != null) ? h.meta_score - prevScore : null;
  const deltaHtml = delta == null ? ''
    : delta > 0.05  ? `<span class="delta-up">▲${delta.toFixed(1)}</span>`
    : delta < -0.05 ? `<span class="delta-down">▼${Math.abs(delta).toFixed(1)}</span>`
    : `<span class="delta-neutral">–</span>`;
  const borderStyle = isSelected
    ? `border-left: 3px solid ${color}; box-shadow: 0 0 0 1px ${color}55, inset 0 0 20px ${color}10;`
    : `border-left: 3px solid ${color}; background: linear-gradient(135deg, ${color}12 0%, transparent 55%);`;
  return `
    <div class="hero-card${isSelected ? ' selected' : ''}"
         data-hero-id="${h.hero_id}" data-hero-name="${h.hero_name}"
         style="${borderStyle}">
      <div class="flex items-start justify-between mb-1.5 gap-1">
        <span class="font-semibold text-sm leading-tight">${h.hero_name}</span>
        <span class="text-xs px-1.5 py-0.5 rounded shrink-0 ${ROLE_CLASS[h.role] ?? ''}">
          ${ROLE_LABEL[h.role] ?? h.role}
        </span>
      </div>
      <div class="flex items-baseline gap-1.5 mb-1.5">
        <span class="font-bold text-xl" style="color:${color}">${h.meta_score?.toFixed(1) ?? '-'}</span>
        ${deltaHtml}
      </div>
      <div class="text-xs text-gray-400 space-y-0.5">
        <div>픽률 <span class="text-gray-200">${h.pick_rate?.toFixed(1) ?? '-'}%</span></div>
        <div>승률 <span class="text-gray-200">${h.win_rate?.toFixed(1) ?? '-'}%</span></div>
      </div>
    </div>
  `;
}

function renderMapButtons(container) {
  const grid = container.querySelector('#map-btn-grid');
  if (!grid) return;
  const maps = currentMapType === '전체' ? MAP_LIST : MAP_LIST.filter(m => m.type === currentMapType);
  grid.innerHTML = maps.map(m => {
    const hasData = !!(cachedMapMeta?.[m.id]);
    return `<button class="map-btn${m.id === currentMap ? ' active' : ''}"
                    data-map-id="${m.id}"${!hasData ? ' disabled' : ''}>${m.name}</button>`;
  }).join('');
  grid.querySelectorAll('.map-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      currentMap = btn.dataset.mapId;
      resetSelection(container);
      grid.querySelectorAll('.map-btn').forEach(b => b.classList.toggle('active', b.dataset.mapId === currentMap));
      renderChart(container);
      renderCards(container);
    });
  });
}

function getFiltered() {
  if (currentMode === 'map') {
    const heroes = currentMap ? (cachedMapMeta?.[currentMap] ?? []) : [];
    return currentRole === '전체' ? heroes : heroes.filter(h => h.role === ROLE_MAP[currentRole]);
  }
  const heroes = cachedMeta?.[currentRank] ?? [];
  return currentRole === '전체' ? heroes : heroes.filter(h => h.role === ROLE_MAP[currentRole]);
}
