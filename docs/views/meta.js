/**
 * 메타 통계 뷰
 * 랭크 드롭다운 + 역할 필터 + 티어별 카드 그리드
 * 카드 클릭 → 인라인 히스토리 차트 토글 (Chart.js)
 */
import { loadJSON } from '../app.js';

const RANKS = ['전체', '브론즈', '실버', '골드', '플래티넘', '다이아몬드', '마스터', '그랜드마스터', '챔피언'];
const ROLES = ['전체', '탱커', '딜러', '지원가'];
const TIERS = ['S', 'A', 'B', 'C', 'D'];

// 역할 한→영 매핑 (heroes.json role 필드 대응)
const ROLE_MAP = { '탱커': 'tank', '딜러': 'damage', '지원가': 'support' };

// Chart 인스턴스 관리
let activeChart = null;
let activeHeroId = null;

// 현재 상태
let currentRank = '전체';
let currentRole = '전체';

export async function renderMeta(container) {
  const [meta, history] = await Promise.all([
    loadJSON('meta'),
    loadJSON('meta_history').catch(() => null),
  ]);

  container.innerHTML = buildHTML();
  attachEvents(container, meta, history);
  renderCards(container, meta);
}

function buildHTML() {
  const rankOptions = RANKS.map(r =>
    `<option value="${r}"${r === currentRank ? ' selected' : ''}>${r}</option>`
  ).join('');

  const roleButtons = ROLES.map(r =>
    `<button class="filter-btn${r === currentRole ? ' active' : ''}" data-role="${r}">${r}</button>`
  ).join('');

  return `
    <div class="mb-5 flex flex-wrap items-center gap-3">
      <select class="ow-select" id="rank-select">${rankOptions}</select>
      <div class="flex gap-2 flex-wrap">${roleButtons}</div>
      <span class="ml-auto text-xs text-gray-500" id="hero-count"></span>
    </div>
    <div id="meta-grid"></div>
  `;
}

function attachEvents(container, meta, history) {
  container.querySelector('#rank-select').addEventListener('change', e => {
    currentRank = e.target.value;
    closeChart(container);
    renderCards(container, meta);
  });

  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRole = btn.dataset.role;
      closeChart(container);
      renderCards(container, meta);
    });
  });

  // 카드 클릭 이벤트 위임
  container.querySelector('#meta-grid').addEventListener('click', e => {
    const card = e.target.closest('.hero-card');
    if (!card) return;
    handleCardClick(container, card, history);
  });
}

function renderCards(container, meta) {
  const heroes = meta[currentRank] ?? [];
  const filtered = currentRole === '전체'
    ? heroes
    : heroes.filter(h => h.role === ROLE_MAP[currentRole]);

  const countEl = container.querySelector('#hero-count');
  if (countEl) countEl.textContent = `${filtered.length}명`;

  const grid = container.querySelector('#meta-grid');
  if (!filtered.length) {
    grid.innerHTML = `<p class="text-center text-gray-500 py-12">데이터가 없습니다.</p>`;
    return;
  }

  // 티어별 그룹화
  const byTier = {};
  TIERS.forEach(t => byTier[t] = []);
  filtered.forEach(h => {
    const t = h.tier ?? 'D';
    if (byTier[t]) byTier[t].push(h);
    else byTier['D'].push(h);
  });

  const html = TIERS.filter(t => byTier[t].length > 0).map(tier => `
    <div class="mb-6">
      <div class="tier-header-${tier} pl-3 mb-3 flex items-center gap-3">
        <span class="text-sm font-bold tier-${tier} border px-2 py-0.5 rounded">${tier}</span>
        <span class="text-sm text-gray-400">${byTier[tier].length}명</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        ${byTier[tier].map(h => heroCard(h)).join('')}
      </div>
    </div>
  `).join('');

  grid.innerHTML = html;
}

function heroCard(h) {
  const roleClass = { tank: 'role-tank', damage: 'role-damage', support: 'role-support' }[h.role] ?? '';
  const roleLabel = { tank: '탱커', damage: '딜러', support: '지원가' }[h.role] ?? h.role;
  return `
    <div class="hero-card" data-hero-id="${h.hero_id}" data-hero-name="${h.hero_name}">
      <div class="flex items-start justify-between mb-2">
        <span class="font-semibold text-sm leading-tight">${h.hero_name}</span>
        <span class="text-xs px-1.5 py-0.5 rounded ${roleClass}">${roleLabel}</span>
      </div>
      <div class="text-ow-orange font-bold text-lg mb-1">${h.meta_score?.toFixed(1) ?? '-'}</div>
      <div class="text-xs text-gray-400 space-y-0.5">
        <div>픽률 <span class="text-gray-200">${h.pick_rate?.toFixed(1) ?? '-'}%</span></div>
        <div>승률 <span class="text-gray-200">${h.win_rate?.toFixed(1) ?? '-'}%</span></div>
      </div>
    </div>
  `;
}

function handleCardClick(container, card, history) {
  const heroId = card.dataset.heroId;
  const heroName = card.dataset.heroName;

  // 같은 카드 재클릭 → 닫기
  if (activeHeroId === heroId) {
    closeChart(container);
    return;
  }

  // 이전 선택 해제
  closeChart(container);

  activeHeroId = heroId;
  card.classList.add('selected');

  // 히스토리 데이터 없으면 안내
  if (!history) {
    insertNoHistory(card, '히스토리 데이터가 없습니다.');
    return;
  }

  const rankData = history[currentRank] ?? history['전체'];
  if (!rankData) {
    insertNoHistory(card, '이 랭크의 히스토리가 없습니다.');
    return;
  }

  // 날짜 정렬 후 영웅 데이터 추출
  const dates = Object.keys(rankData).sort();
  const scores = dates.map(d => {
    const entry = rankData[d]?.find(h => h.hero_id === heroId);
    return entry ? entry.meta_score : null;
  });

  const hasData = scores.some(s => s !== null);
  if (!hasData) {
    insertNoHistory(card, '히스토리 데이터가 부족합니다.');
    return;
  }

  insertChart(card, heroName, dates, scores);
}

function insertNoHistory(card, msg) {
  const div = document.createElement('div');
  div.className = 'col-span-full chart-container mb-4';
  div.dataset.chartContainer = '1';
  div.innerHTML = `<p class="text-center text-gray-500 text-sm py-4">${msg}</p>`;
  card.parentElement.parentElement.insertAdjacentElement('afterend', div);
}

function insertChart(card, heroName, dates, scores) {
  // 차트 컨테이너를 카드 그리드(col) 바로 뒤에 삽입
  const gridRow = card.parentElement.parentElement; // tier section의 grid div → 부모 div
  const chartDiv = document.createElement('div');
  chartDiv.className = 'chart-container mb-4';
  chartDiv.dataset.chartContainer = '1';
  chartDiv.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <span class="text-sm font-semibold text-ow-orange">${heroName} — 메타 점수 추이 (${currentRank})</span>
      <span class="text-xs text-gray-500">${dates.length}일</span>
    </div>
    <canvas id="history-chart" height="80"></canvas>
  `;
  gridRow.parentElement.insertAdjacentElement('afterend', chartDiv);

  const ctx = chartDiv.querySelector('#history-chart').getContext('2d');

  const labelDates = dates.map(d => d.slice(5)); // MM-DD

  activeChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labelDates,
      datasets: [{
        label: '메타 점수',
        data: scores,
        borderColor: '#F5A623',
        backgroundColor: 'rgba(245,166,35,0.08)',
        borderWidth: 2,
        pointRadius: dates.length <= 14 ? 4 : 2,
        pointBackgroundColor: '#F5A623',
        spanGaps: true,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#161B22',
          borderColor: '#30363D',
          borderWidth: 1,
          titleColor: '#9CA3AF',
          bodyColor: '#F5A623',
          callbacks: {
            title: ctx => dates[ctx[0].dataIndex],
            label: ctx => ` 메타 점수: ${ctx.parsed.y?.toFixed(1) ?? 'N/A'}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#6B7280',
            maxTicksLimit: 12,
            font: { size: 10 },
          },
          grid: { color: '#1F2937' },
        },
        y: {
          ticks: { color: '#6B7280', font: { size: 10 } },
          grid: { color: '#1F2937' },
          min: 0,
          max: 100,
        },
      },
    },
  });
}

function closeChart(container) {
  if (activeChart) {
    activeChart.destroy();
    activeChart = null;
  }
  activeHeroId = null;

  // 선택 해제
  container.querySelectorAll('.hero-card.selected').forEach(c => c.classList.remove('selected'));

  // 차트 컨테이너 제거
  container.querySelectorAll('[data-chart-container]').forEach(el => el.remove());
}
