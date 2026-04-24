/**
 * 메타 통계 뷰
 * - 이번 주 변화 섹션
 * - 전체 영웅 메타 점수 차트 (영웅 클릭 → 히스토리 + 통합 상세 패널)
 * - 티어별 카드 그리드 / 테이블 뷰 전환
 * - 딥링크: #meta?rank=그랜드마스터&hero=tracer
 */
import { loadJSON } from '../app.js';

const RANKS = ['전체', '브론즈', '실버', '골드', '플래티넘', '다이아몬드', '마스터', '그랜드마스터', '챔피언'];
const ROLES = ['전체', '탱커', '딜러', '지원가'];
const TIERS = ['S', 'A', 'B', 'C', 'D'];
const ROLE_MAP = { '탱커': 'tank', '딜러': 'damage', '지원가': 'support' };
const TIER_COLOR = { S: '#ef4444', A: '#f97316', B: '#eab308', C: '#22c55e', D: '#6b7280' };
const HERO_COLOR = {
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

// ── 상태 변수 ─────────────────────────────────────────────────────────────────
let currentRank = '전체';
let currentRole = '전체';
let currentMode = 'rank';
let currentMap = null;
let currentMapType = '전체';
let selectedHeroId = null;
let selectedHeroName = null;
let currentView = 'card';    // 'card' | 'table'
let sortCol = 'meta_score';
let sortDir = 'desc';
let activeChart = null;
let cachedMeta = null;
let cachedHistory = null;
let cachedMapMeta = null;
let cachedMapHistory = null;
let cachedPatches = null;

// ── 진입점 ────────────────────────────────────────────────────────────────────

export async function renderMeta(container, params) {
  // URL 파라미터로 상태 복원
  if (params) {
    const rank = params.get('rank');
    if (rank && RANKS.includes(rank)) currentRank = rank;
  }

  [cachedMeta, cachedHistory, cachedMapMeta, cachedMapHistory, cachedPatches] = await Promise.all([
    loadJSON('meta'),
    loadJSON('meta_history').catch(() => null),
    loadJSON('map_meta').catch(() => null),
    loadJSON('map_meta_history').catch(() => null),
    loadJSON('patch').catch(() => null),
  ]);

  container.innerHTML = buildHTML();
  attachEvents(container);
  renderWeeklyChanges(container);
  renderChart(container);
  renderCards(container);

  // 영웅 선택 복원
  if (params) {
    const heroId = params.get('hero');
    if (heroId) {
      const allHeroes = Object.values(cachedMeta ?? {}).flat();
      const hero = allHeroes.find(h => h.hero_id === heroId);
      if (hero) selectHero(container, heroId, hero.hero_name);
    }
  }
}

// ── URL 업데이트 ──────────────────────────────────────────────────────────────

function updateURL() {
  if (currentMode !== 'rank') return;
  const p = new URLSearchParams();
  if (currentRank !== '전체') p.set('rank', currentRank);
  if (selectedHeroId) p.set('hero', selectedHeroId);
  const qs = p.toString();
  history.replaceState(null, '', '#meta' + (qs ? '?' + qs : ''));
}

// ── HTML 골격 ─────────────────────────────────────────────────────────────────

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

  const viewToggle = `
    <div class="flex gap-1 ml-auto shrink-0">
      <button id="view-card-btn" class="view-toggle-btn${currentView === 'card' ? ' active' : ''}">카드</button>
      <button id="view-table-btn" class="view-toggle-btn${currentView === 'table' ? ' active' : ''}">테이블</button>
    </div>`;

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
      ${viewToggle}
    </div>

    <!-- 맵별 컨트롤 -->
    <div id="map-controls" class="${!isMap ? 'hidden ' : ''}mb-4">
      <div class="flex gap-2 flex-wrap mb-2">${mapTypeButtons}</div>
      <div class="flex gap-2 flex-wrap mb-3" id="map-btn-grid">${mapButtons}</div>
      <div class="flex gap-2 flex-wrap items-center">
        ${roleButtons.replace(/data-role/g, 'data-role')}
        ${viewToggle.replace('id="view-card-btn"', 'id="view-card-btn-map"').replace('id="view-table-btn"', 'id="view-table-btn-map"')}
      </div>
    </div>

    <!-- 이번 주 메타 변화 (랭크 모드 전용) -->
    ${!isMap ? '<div id="weekly-changes" class="mb-4"></div>' : ''}

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

    <!-- 영웅 통합 상세 패널 (선택 시 표시) -->
    <div id="hero-detail" class="hidden mb-6"></div>

    <!-- 영웅 카드 / 테이블 -->
    <div id="meta-grid"></div>
  `;
}

// ── 이벤트 ────────────────────────────────────────────────────────────────────

function attachEvents(container) {
  // 모드 탭
  container.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === currentMode) return;
      currentMode = btn.dataset.mode;
      resetSelection(container);
      container.innerHTML = buildHTML();
      attachEvents(container);
      if (currentMode === 'rank') renderWeeklyChanges(container);
      renderChart(container);
      renderCards(container);
    });
  });

  // 랭크 선택
  container.querySelector('#rank-select')?.addEventListener('change', e => {
    currentRank = e.target.value;
    resetSelection(container);
    renderWeeklyChanges(container);
    renderChart(container);
    renderCards(container);
    updateURL();
  });

  // 역할 필터
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

  // 영웅 카드 클릭
  container.querySelector('#meta-grid').addEventListener('click', e => {
    const card = e.target.closest('.hero-card');
    if (!card) return;
    selectHero(container, card.dataset.heroId, card.dataset.heroName);
  });

  // 뷰 토글 (랭크 컨트롤)
  container.querySelector('#view-card-btn')?.addEventListener('click', () => setView(container, 'card'));
  container.querySelector('#view-table-btn')?.addEventListener('click', () => setView(container, 'table'));
  // 뷰 토글 (맵 컨트롤)
  container.querySelector('#view-card-btn-map')?.addEventListener('click', () => setView(container, 'card'));
  container.querySelector('#view-table-btn-map')?.addEventListener('click', () => setView(container, 'table'));
}

function setView(container, view) {
  currentView = view;
  ['view-card-btn', 'view-table-btn', 'view-card-btn-map', 'view-table-btn-map'].forEach(id => {
    const el = container.querySelector(`#${id}`);
    if (!el) return;
    el.classList.toggle('active', el.id.includes('card') ? view === 'card' : view === 'table');
  });
  renderCards(container);
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
  renderHeroDetail(container, heroId, heroName);
  updateURL();
  container.querySelector('#chart-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetSelection(container) {
  selectedHeroId = null;
  selectedHeroName = null;
  container.querySelector('#chart-back')?.classList.add('hidden');
  const panel = container.querySelector('#hero-detail');
  if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
  updateURL();
}

// ── 이번 주 메타 변화 ─────────────────────────────────────────────────────────

function getWeeklyDelta(rank) {
  const historyRank = rank === '챔피언' ? '그랜드마스터' : rank;
  const rankData = cachedHistory?.[historyRank];
  if (!rankData) return {};
  const dates = Object.keys(rankData).sort();
  if (dates.length < 2) return {};

  const latestDate = dates[dates.length - 1];
  const latestMap = Object.fromEntries(
    (rankData[latestDate] ?? []).map(h => [h.hero_id, { score: h.meta_score, name: h.hero_name }])
  );

  // 7일 전에 가장 가까운 날짜 찾기
  const target = new Date(latestDate);
  target.setDate(target.getDate() - 7);
  const targetStr = target.toISOString().slice(0, 10);
  const olderDate = [...dates].reverse().find(d => d <= targetStr) ?? dates[0];

  const olderMap = Object.fromEntries(
    (rankData[olderDate] ?? []).map(h => [h.hero_id, h.meta_score])
  );

  const result = {};
  for (const [id, { score, name }] of Object.entries(latestMap)) {
    if (id in olderMap && score != null && olderMap[id] != null) {
      result[id] = { delta: score - olderMap[id], name };
    }
  }
  return result;
}

function renderWeeklyChanges(container) {
  const el = container.querySelector('#weekly-changes');
  if (!el || !cachedHistory) return;

  const deltas = getWeeklyDelta(currentRank);
  const entries = Object.entries(deltas).sort((a, b) => b[1].delta - a[1].delta);
  if (!entries.length) { el.innerHTML = ''; return; }

  const rising = entries.filter(([, v]) => v.delta > 0.1).slice(0, 4);
  const falling = [...entries].reverse().filter(([, v]) => v.delta < -0.1).slice(0, 4);

  if (!rising.length && !falling.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="bg-ow-card border border-ow-border rounded-xl px-5 py-4 mb-2">
      <div class="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">이번 주 메타 변화 (${currentRank})</div>
      <div class="flex flex-wrap gap-x-10 gap-y-3">
        ${rising.length ? `
          <div>
            <div class="text-xs text-green-400 font-semibold mb-2">↑ 상승</div>
            <div class="flex flex-wrap gap-2">
              ${rising.map(([id, v]) => `
                <button class="weekly-hero-btn" data-hero-id="${id}" data-hero-name="${escHtml(v.name)}">
                  <span class="text-gray-200 text-sm">${escHtml(v.name)}</span>
                  <span class="text-green-400 font-mono text-xs ml-1">+${v.delta.toFixed(1)}</span>
                </button>`).join('')}
            </div>
          </div>` : ''}
        ${falling.length ? `
          <div>
            <div class="text-xs text-red-400 font-semibold mb-2">↓ 하락</div>
            <div class="flex flex-wrap gap-2">
              ${falling.map(([id, v]) => `
                <button class="weekly-hero-btn" data-hero-id="${id}" data-hero-name="${escHtml(v.name)}">
                  <span class="text-gray-200 text-sm">${escHtml(v.name)}</span>
                  <span class="text-red-400 font-mono text-xs ml-1">${v.delta.toFixed(1)}</span>
                </button>`).join('')}
            </div>
          </div>` : ''}
      </div>
    </div>`;

  el.querySelectorAll('.weekly-hero-btn').forEach(btn => {
    btn.addEventListener('click', () => selectHero(container, btn.dataset.heroId, btn.dataset.heroName));
  });
}

// ── 패치 세로선 플러그인 ──────────────────────────────────────────────────────

function parsePatchDate(dateStr) {
  // "2026년 4월 17일" → "2026-04-17"
  const m = String(dateStr ?? '').match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function makePatchLinePlugin(dates) {
  // dates: ["2026-04-10", "2026-04-11", ...] (히스토리 날짜 배열, 정렬됨)
  if (!cachedPatches?.length || !dates?.length) return null;

  // 패치 날짜별로 히스토리에서 "그 날짜 이후 첫 번째 데이터 인덱스" 계산
  // → 패치가 17일이면 17일(인덱스 n)과 18일(인덱스 n+1) 사이에 선을 그려야 함
  // → 즉 dates에서 patchDate < d 를 만족하는 첫 번째 인덱스를 찾음
  const lines = [];
  for (const p of cachedPatches) {
    const pd = parsePatchDate(p.date);
    if (!pd) continue;
    const idx = dates.findIndex(d => d > pd);
    // idx=0은 패치가 히스토리 시작 이전 → 표시 생략
    if (idx > 0) lines.push({ idx, label: p.date });
  }
  if (!lines.length) return null;

  return {
    id: 'patchLines',
    afterDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      ctx.save();
      ctx.strokeStyle = 'rgba(245, 166, 35, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);

      for (const { idx } of lines) {
        // idx-1과 idx 사이 중간 x 좌표
        const x = (scales.x.getPixelForValue(idx - 1) + scales.x.getPixelForValue(idx)) / 2;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();

        // "패치" 텍스트 레이블
        ctx.fillStyle = 'rgba(245, 166, 35, 0.75)';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText('PATCH', x + 3, chartArea.top + 10);
      }
      ctx.restore();
    },
  };
}

// ── 차트 렌더링 ───────────────────────────────────────────────────────────────

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
  const historyRank = currentRank === '챔피언' ? '그랜드마스터' : currentRank;
  const rankData = cachedHistory?.[historyRank];
  if (!rankData || !Object.keys(rankData).length) {
    wrapper.innerHTML = noDataMsg('히스토리 데이터가 없습니다. 내일 다시 확인해주세요.');
    return;
  }

  wrapper.style.height = '560px';
  wrapper.innerHTML = '<canvas id="meta-chart"></canvas>';
  const canvas = container.querySelector('#meta-chart');
  canvas.style.width = '100%';
  canvas.style.height = '560px';

  const dates = Object.keys(rankData).sort();
  const labelDates = dates.map(d => d.slice(5));

  const heroMap = {};
  for (const date of dates) {
    for (const h of rankData[date] ?? []) {
      if (!heroMap[h.hero_id]) {
        heroMap[h.hero_id] = { hero_id: h.hero_id, hero_name: h.hero_name, tier: h.tier, scores: new Array(dates.length).fill(null) };
      }
      heroMap[h.hero_id].scores[dates.indexOf(date)] = h.meta_score ?? null;
    }
  }

  const roleFilter = ROLE_MAP[currentRole];
  const currentHeroes = cachedMeta?.[currentRank] ?? [];
  const roleSet = roleFilter
    ? new Set(currentHeroes.filter(h => h.role === roleFilter).map(h => h.hero_id))
    : null;
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

  const patchPlugin = makePatchLinePlugin(dates);
  activeChart = new Chart(canvas, {
    type: 'line',
    data: { labels: labelDates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { mode: 'nearest', intersect: false },
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
    plugins: patchPlugin ? [patchPlugin] : [],
  });
}

function renderHistoryChart(container) {
  const color = HERO_COLOR[selectedHeroId] ?? FALLBACK_COLOR;
  container.querySelector('#chart-title').textContent =
    `${selectedHeroName} — 메타 점수 추이 (${currentRank})`;
  container.querySelector('#chart-scroll').style.maxHeight = '640px';

  const wrapper = container.querySelector('#chart-wrapper');
  const historyRank = currentRank === '챔피언' ? '그랜드마스터' : currentRank;
  const rankData = cachedHistory?.[historyRank];
  if (!rankData) { wrapper.innerHTML = noDataMsg('히스토리 데이터가 없습니다.'); return; }

  const dates = Object.keys(rankData).sort();
  const scores = dates.map(d => rankData[d]?.find(h => h.hero_id === selectedHeroId)?.meta_score ?? null);

  if (!scores.some(s => s !== null)) {
    wrapper.innerHTML = noDataMsg('이 영웅의 히스토리 데이터가 없습니다.');
    return;
  }

  wrapper.style.height = '560px';
  wrapper.innerHTML = '<canvas id="meta-chart"></canvas>';
  const canvas = container.querySelector('#meta-chart');
  canvas.style.width = '100%';
  canvas.style.height = '560px';

  const patchPlugin = makePatchLinePlugin(dates);
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
    plugins: patchPlugin ? [patchPlugin] : [],
  });
}

// ── 맵별 차트 ─────────────────────────────────────────────────────────────────

function renderMapOverviewChart(container) {
  const mapName = MAP_LIST.find(m => m.id === currentMap)?.name ?? currentMap ?? '';
  container.querySelector('#chart-title').textContent =
    currentMap ? `전체 영웅 메타 점수 추이 — ${mapName}` : '맵을 선택하세요';
  container.querySelector('#chart-scroll').style.maxHeight = '640px';

  const wrapper = container.querySelector('#chart-wrapper');
  if (!currentMap) { wrapper.innerHTML = noDataMsg('맵을 선택하면 차트가 표시됩니다.'); return; }

  const mapData = cachedMapHistory?.[currentMap];
  if (!mapData || !Object.keys(mapData).length) {
    wrapper.innerHTML = noDataMsg('히스토리 데이터가 없습니다. 내일 다시 확인해주세요.');
    return;
  }

  wrapper.style.height = '560px';
  wrapper.innerHTML = '<canvas id="meta-chart"></canvas>';
  const canvas = container.querySelector('#meta-chart');
  canvas.style.width = '100%';
  canvas.style.height = '560px';

  const dates = Object.keys(mapData).sort();
  const labelDates = dates.map(d => d.slice(5));

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

  const patchPlugin = makePatchLinePlugin(dates);
  activeChart = new Chart(canvas, {
    type: 'line',
    data: { labels: labelDates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { mode: 'nearest', intersect: false },
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
    plugins: patchPlugin ? [patchPlugin] : [],
  });
}

function renderMapHistoryChart(container) {
  const color = HERO_COLOR[selectedHeroId] ?? FALLBACK_COLOR;
  const mapName = MAP_LIST.find(m => m.id === currentMap)?.name ?? currentMap ?? '';
  container.querySelector('#chart-title').textContent =
    `${selectedHeroName} — 메타 점수 추이 (${mapName})`;
  container.querySelector('#chart-scroll').style.maxHeight = '640px';

  const wrapper = container.querySelector('#chart-wrapper');
  const mapData = cachedMapHistory?.[currentMap];
  if (!mapData) { wrapper.innerHTML = noDataMsg('히스토리 데이터가 없습니다.'); return; }

  const dates = Object.keys(mapData).sort();
  const scores = dates.map(d => mapData[d]?.find(h => h.hero_id === selectedHeroId)?.meta_score ?? null);

  if (!scores.some(s => s !== null)) {
    wrapper.innerHTML = noDataMsg('이 영웅의 히스토리 데이터가 없습니다.');
    return;
  }

  wrapper.style.height = '560px';
  wrapper.innerHTML = '<canvas id="meta-chart"></canvas>';
  const canvas = container.querySelector('#meta-chart');
  canvas.style.width = '100%';
  canvas.style.height = '560px';

  const patchPlugin = makePatchLinePlugin(dates);
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
    plugins: patchPlugin ? [patchPlugin] : [],
  });
}

function noDataMsg(msg) {
  return `<p class="flex items-center justify-center h-full text-gray-500 text-sm py-16">${msg}</p>`;
}

// ── 영웅 통합 상세 패널 ───────────────────────────────────────────────────────

async function renderHeroDetail(container, heroId, heroName) {
  const panel = container.querySelector('#hero-detail');
  if (!panel) return;
  panel.classList.remove('hidden');
  panel.dataset.loadingFor = heroId;
  panel.innerHTML = `
    <div class="bg-ow-card border border-ow-border rounded-xl p-5">
      <div class="flex items-center gap-2 text-gray-500 text-sm py-4">
        <div class="loading-spinner shrink-0"></div> 상세 정보 로드 중...
      </div>
    </div>`;

  const [stadium, patches, heroesData] = await Promise.all([
    loadJSON('stadium').catch(() => null),
    loadJSON('patch').catch(() => null),
    loadJSON('heroes').catch(() => null),
  ]);

  if (panel.dataset.loadingFor !== heroId) return;

  // hero_id → 영문명, 한국어 별칭
  const heroesMap = heroesData?.heroes ?? {};
  const heroEntry = Object.entries(heroesMap).find(([id]) => id === heroId);
  const englishName = heroEntry?.[1]?.name ?? heroId;
  const koAlias = (heroEntry?.[1]?.aliases ?? []).find(a => /[가-힣]/.test(a)) ?? heroName;

  // 스타디움 빌드 (영문명 키로 조회)
  const builds = stadium?.[englishName] ?? [];

  // 최근 패치 이력
  const patchItems = [];
  for (const patch of (patches ?? []).slice(0, 4)) {
    const hc = (patch.hero_changes ?? []).find(h => h.hero === koAlias || h.hero === heroName);
    if (hc?.changes?.length) {
      patchItems.push({ date: patch.date ?? patch.title, changes: hc.changes, isStadium: hc.is_stadium });
    }
  }

  const color = HERO_COLOR[heroId] ?? FALLBACK_COLOR;

  panel.innerHTML = `
    <div class="bg-ow-card border border-ow-border rounded-xl p-5" style="border-left: 3px solid ${color}">
      <div class="flex items-center gap-2 mb-5">
        <span class="font-bold text-lg" style="color:${color}">${escHtml(heroName)}</span>
        <span class="text-gray-400 text-sm">통합 정보</span>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <!-- 스타디움 빌드 -->
        <div>
          <h3 class="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">스타디움 인기 빌드</h3>
          ${builds.length ? `
            <div class="space-y-2">
              ${builds.slice(0, 3).map((b, i) => `
                <div class="bg-ow-bg border border-ow-border rounded-lg p-3 flex items-center gap-3">
                  <span class="text-xs text-ow-orange font-bold w-4 shrink-0">${i + 1}</span>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm text-gray-100 font-medium truncate">${escHtml(b.name)}</div>
                    <div class="text-xs text-gray-500 mt-0.5">${escHtml(b.playstyle ?? '')}</div>
                  </div>
                  <button class="detail-code-badge shrink-0" data-code="${escHtml(b.code)}">${escHtml(b.code)}</button>
                </div>`).join('')}
            </div>` : `<p class="text-gray-500 text-sm">스타디움 빌드 데이터가 없습니다.</p>`}
        </div>

        <!-- 패치 이력 -->
        <div>
          <h3 class="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">최근 패치 이력</h3>
          ${patchItems.length ? `
            <div class="space-y-4">
              ${patchItems.map(p => `
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <span class="text-xs text-ow-orange">${escHtml(p.date ?? '')}</span>
                    ${p.isStadium ? `<span class="text-xs border border-ow-orange/40 text-ow-orange px-1.5 rounded">스타디움</span>` : ''}
                  </div>
                  <ul class="space-y-1">
                    ${p.changes.map(c => `
                      <li class="flex gap-1.5 text-xs text-gray-300">
                        <span class="text-gray-600 shrink-0 mt-0.5">–</span>
                        <span>${escHtml(c)}</span>
                      </li>`).join('')}
                  </ul>
                </div>`).join('')}
            </div>` : `<p class="text-gray-500 text-sm">최근 패치에서 변경사항이 없습니다.</p>`}
        </div>
      </div>
    </div>`;

  // 빌드 코드 복사
  panel.querySelectorAll('.detail-code-badge').forEach(badge => {
    badge.addEventListener('click', async () => {
      const code = badge.dataset.code;
      try { await navigator.clipboard.writeText(code); } catch {
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
      const orig = badge.textContent;
      badge.textContent = '복사됨!';
      badge.style.color = '#22c55e';
      setTimeout(() => { badge.textContent = orig; badge.style.color = ''; }, 1500);
    });
  });
}

// ── 영웅 카드 그리드 / 테이블 ─────────────────────────────────────────────────

function getPrevScoreMap(rank) {
  const historyRank = rank === '챔피언' ? '그랜드마스터' : rank;
  const rankData = cachedHistory?.[historyRank];
  if (!rankData) return {};
  const dates = Object.keys(rankData).sort();
  const today = new Date().toISOString().slice(0, 10);
  const prevDate = [...dates].reverse().find(d => d < today);
  if (!prevDate) return {};
  return Object.fromEntries(
    (rankData[prevDate] ?? []).map(h => [h.hero_id, h.meta_score])
  );
}

function getPrevMapScoreMap(mapId) {
  const mapData = cachedMapHistory?.[mapId];
  if (!mapData) return {};
  const dates = Object.keys(mapData).sort();
  const today = new Date().toISOString().slice(0, 10);
  const prevDate = [...dates].reverse().find(d => d < today);
  if (!prevDate) return {};
  return Object.fromEntries(
    (mapData[prevDate] ?? []).map(h => [h.hero_id, h.meta_score])
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

  const prevMap = (currentMode === 'map' && currentMap)
    ? getPrevMapScoreMap(currentMap)
    : getPrevScoreMap(currentRank);

  if (currentView === 'table') {
    renderTable(container, filtered, prevMap);
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
        ${byTier[tier].map(h => heroCard(h, prevMap[h.hero_id])).join('')}
      </div>
    </div>
  `).join('');
}

function renderTable(container, filtered, prevMap) {
  const weeklyDelta = currentMode === 'rank' ? getWeeklyDelta(currentRank) : {};

  const sorted = [...filtered].sort((a, b) => {
    let aVal, bVal;
    if (sortCol === 'meta_score')   { aVal = a.meta_score ?? 0;  bVal = b.meta_score ?? 0; }
    else if (sortCol === 'pick_rate') { aVal = a.pick_rate ?? 0;  bVal = b.pick_rate ?? 0; }
    else if (sortCol === 'win_rate')  { aVal = a.win_rate ?? 0;   bVal = b.win_rate ?? 0; }
    else if (sortCol === 'delta')     { aVal = weeklyDelta[a.hero_id]?.delta ?? -999; bVal = weeklyDelta[b.hero_id]?.delta ?? -999; }
    else                              { aVal = a.hero_name ?? ''; bVal = b.hero_name ?? ''; }
    if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal, 'ko') : bVal.localeCompare(aVal, 'ko');
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const si = col => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const rows = sorted.map(h => {
    const delta = weeklyDelta[h.hero_id]?.delta;
    const color = HERO_COLOR[h.hero_id] ?? FALLBACK_COLOR;
    const dHtml = delta == null ? '<span class="delta-neutral">–</span>'
      : delta > 0.05  ? `<span class="delta-up">▲${delta.toFixed(1)}</span>`
      : delta < -0.05 ? `<span class="delta-down">▼${Math.abs(delta).toFixed(1)}</span>`
      : '<span class="delta-neutral">–</span>';
    return `
      <tr class="meta-table-row" data-hero-id="${h.hero_id}" data-hero-name="${escHtml(h.hero_name)}">
        <td class="py-2.5 px-4 font-semibold" style="color:${color}">${escHtml(h.hero_name)}</td>
        <td class="py-2.5 px-4">
          <span class="text-xs px-1.5 py-0.5 rounded ${ROLE_CLASS[h.role] ?? ''}">${ROLE_LABEL[h.role] ?? h.role}</span>
        </td>
        <td class="py-2.5 px-4">
          <span class="tier-${h.tier ?? 'D'} text-xs font-bold border px-1.5 py-0.5 rounded">${h.tier ?? '-'}</span>
        </td>
        <td class="py-2.5 px-4 font-bold tabular-nums" style="color:${color}">${h.meta_score?.toFixed(1) ?? '-'}</td>
        <td class="py-2.5 px-4">${dHtml}</td>
        <td class="py-2.5 px-4 text-gray-300 tabular-nums">${h.pick_rate?.toFixed(1) ?? '-'}%</td>
        <td class="py-2.5 px-4 text-gray-300 tabular-nums">${h.win_rate?.toFixed(1) ?? '-'}%</td>
      </tr>`;
  }).join('');

  const grid = container.querySelector('#meta-grid');
  grid.innerHTML = `
    <div class="overflow-x-auto rounded-xl border border-ow-border">
      <table class="meta-table w-full text-sm">
        <thead>
          <tr class="border-b border-ow-border">
            <th class="meta-th" data-sort="hero_name">영웅${si('hero_name')}</th>
            <th class="meta-th" data-sort="role">역할</th>
            <th class="meta-th" data-sort="tier">티어</th>
            <th class="meta-th" data-sort="meta_score">메타 점수${si('meta_score')}</th>
            <th class="meta-th" data-sort="delta">7일 변화${si('delta')}</th>
            <th class="meta-th" data-sort="pick_rate">픽률${si('pick_rate')}</th>
            <th class="meta-th" data-sort="win_rate">승률${si('win_rate')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  grid.querySelectorAll('.meta-th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      sortDir = sortCol === col ? (sortDir === 'desc' ? 'asc' : 'desc') : (col === 'hero_name' ? 'asc' : 'desc');
      sortCol = col;
      renderCards(container);
    });
  });

  grid.querySelectorAll('.meta-table-row').forEach(row => {
    row.addEventListener('click', () => selectHero(container, row.dataset.heroId, row.dataset.heroName));
  });
}

function heroCard(h, prevScore) {
  const isSelected = h.hero_id === selectedHeroId;
  const color = HERO_COLOR[h.hero_id] ?? FALLBACK_COLOR;
  const delta = (prevScore != null && h.meta_score != null) ? h.meta_score - prevScore : null;
  const deltaHtml = delta == null ? ''
    : delta > 0.05  ? `<span class="delta-up">▲${delta.toFixed(1)}</span>`
    : delta < -0.05 ? `<span class="delta-down">▼${Math.abs(delta).toFixed(1)}</span>`
    : `<span class="delta-neutral">–</span>`;
  const borderStyle = isSelected
    ? `border-left: 3px solid ${color}; box-shadow: 0 0 0 1px ${color}55, inset 0 0 20px ${color}10;`
    : `border-left: 3px solid ${color}; background: linear-gradient(135deg, ${color}12 0%, transparent 55%);`;
  const initial = escHtml(h.hero_name?.[0] ?? '?');
  return `
    <div class="hero-card${isSelected ? ' selected' : ''}"
         data-hero-id="${h.hero_id}" data-hero-name="${escHtml(h.hero_name)}"
         style="${borderStyle}">
      <div class="flex items-start gap-2 mb-1.5">
        <div class="relative shrink-0" style="width:40px;height:40px;">
          ${h.portrait_url ? `
          <img src="${h.portrait_url}" alt="${escHtml(h.hero_name)}"
               class="hero-portrait hero-portrait-sm"
               style="border:1px solid ${color}44;"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
               loading="lazy">
          ` : ''}
          <span class="hero-portrait-fallback hero-portrait-sm"
                style="${h.portrait_url ? 'display:none;' : ''}background:${color}33;border:1px solid ${color}44;">${initial}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-1 mb-0.5">
            <span class="font-semibold text-sm leading-tight truncate">${escHtml(h.hero_name)}</span>
            <span class="text-xs px-1.5 py-0.5 rounded shrink-0 ${ROLE_CLASS[h.role] ?? ''}">
              ${ROLE_LABEL[h.role] ?? h.role}
            </span>
          </div>
          <div class="flex items-baseline gap-1.5">
            <span class="font-bold text-lg" style="color:${color}">${h.meta_score?.toFixed(1) ?? '-'}</span>
            ${deltaHtml}
          </div>
        </div>
      </div>
      <div class="text-xs text-gray-400 space-y-0.5">
        <div>픽률 <span class="text-gray-200">${h.pick_rate?.toFixed(1) ?? '-'}%</span></div>
        <div>승률 <span class="text-gray-200">${h.win_rate?.toFixed(1) ?? '-'}%</span></div>
      </div>
    </div>`;
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
}

function getFiltered() {
  if (currentMode === 'map') {
    const heroes = currentMap ? (cachedMapMeta?.[currentMap] ?? []) : [];
    return currentRole === '전체' ? heroes : heroes.filter(h => h.role === ROLE_MAP[currentRole]);
  }
  const heroes = cachedMeta?.[currentRank] ?? [];
  return currentRole === '전체' ? heroes : heroes.filter(h => h.role === ROLE_MAP[currentRole]);
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
