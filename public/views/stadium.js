/**
 * 스타디움 빌드 뷰
 * 역할군별 영웅 pill 버튼 + 빌드 카드 (코드 클릭 → 클립보드 복사)
 * 검색/플레이스타일 필터 지원
 */
import { loadJSON, getPortraitIndex } from '../app.js';

let currentHero = null;  // stadium.json 의 영어 키
let koNameMap = {};       // 영어명 → 한국어명
let roleMap = {};         // 영어명 → role (tank/damage/support)
let heroIdMap = {};       // 영어명 → hero_id (초상화용)
let portraitIndex = {};   // hero_id → portrait_url
let searchQuery = '';
let styleFilter = '전체';
let stadiumData = null;

const ROLE_ORDER = ['tank', 'damage', 'support'];
const ROLE_LABEL = { tank: '탱커', damage: '딜러', support: '지원가' };
const ROLE_CLASS = { tank: 'role-tank', damage: 'role-damage', support: 'role-support' };

export async function renderStadium(container, params) {
  const [stadium, heroesData] = await Promise.all([
    loadJSON('stadium'),
    loadJSON('heroes').catch(() => null),
  ]);

  stadiumData = stadium;
  koNameMap = buildKoNameMap(heroesData);
  roleMap = buildRoleMap(heroesData);
  heroIdMap = buildHeroIdMap(heroesData);
  portraitIndex = await getPortraitIndex();

  const heroes = Object.keys(stadium).sort((a, b) =>
    (koNameMap[a] ?? a).localeCompare(koNameMap[b] ?? b, 'ko')
  );

  // URL 파라미터로 영웅 복원
  const heroParam = params?.get('hero');
  if (heroParam && stadium[heroParam]) {
    currentHero = heroParam;
  } else if (!currentHero || !stadium[currentHero]) {
    currentHero = heroes[0] ?? null;
  }

  // URL 파라미터로 검색어/필터 복원
  searchQuery = params?.get('q') ?? '';
  styleFilter = params?.get('style') ?? '전체';

  container.innerHTML = buildHTML(heroes, stadium);
  attachEvents(container, stadium);

  if (searchQuery || styleFilter !== '전체') {
    renderBuilds(container, stadium);
  } else {
    renderBuilds(container, stadium);
  }
}

/** URL 업데이트 (hashchange 없이) */
function updateURL() {
  const qs = new URLSearchParams();
  if (currentHero) qs.set('hero', currentHero);
  if (searchQuery) qs.set('q', searchQuery);
  if (styleFilter !== '전체') qs.set('style', styleFilter);
  const str = qs.toString();
  history.replaceState(null, '', '#stadium' + (str ? '?' + str : ''));
}

/** heroes.json 에서 영어명 → 한국어명 매핑 생성 */
function buildKoNameMap(heroesData) {
  const map = {};
  if (!heroesData) return map;
  const list = heroesData.heroes ?? heroesData;
  for (const hero of Object.values(list)) {
    const enName = hero.name;
    const koAlias = (hero.aliases ?? []).find(a => /[가-힣]/.test(a));
    if (enName && koAlias) map[enName] = koAlias;
  }
  return map;
}

/** heroes.json 에서 영어명 → 역할(tank/damage/support) 매핑 생성 */
function buildRoleMap(heroesData) {
  const map = {};
  if (!heroesData) return map;
  const list = heroesData.heroes ?? heroesData;
  for (const hero of Object.values(list)) {
    if (hero.name && hero.role) map[hero.name] = hero.role;
  }
  return map;
}

/** heroes.json 에서 영어명 → hero_id 매핑 생성 (초상화 URL용) */
function buildHeroIdMap(heroesData) {
  const map = {};
  if (!heroesData) return map;
  const list = heroesData.heroes ?? heroesData;
  for (const [id, hero] of Object.entries(list)) {
    if (hero.name) map[hero.name] = id;
  }
  return map;
}

function koName(enName) {
  return koNameMap[enName] ?? enName;
}

function heroPill(enName) {
  const isActive = enName === currentHero && !searchQuery && styleFilter === '전체';
  const heroId = heroIdMap[enName];
  const url = heroId ? portraitIndex[heroId] : null;
  const initial = escHtml((koNameMap[enName] ?? enName)?.[0] ?? '?');
  const avatarHtml = url ? `
    <img src="${url}" alt=""
         class="hero-portrait hero-portrait-xs"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
         loading="lazy">
    <span class="hero-portrait-fallback hero-portrait-xs" style="display:none;font-size:0.6rem;">${initial}</span>
  ` : `<span class="hero-portrait-fallback hero-portrait-xs" style="background:#30363D;font-size:0.6rem;">${initial}</span>`;
  return `
    <button class="hero-pill${isActive ? ' active' : ''}" data-hero="${escHtml(enName)}">
      ${avatarHtml}${escHtml(koName(enName))}
    </button>`;
}

/** 모든 플레이스타일 태그 동적 수집 */
function collectStyles(stadium) {
  const set = new Set();
  for (const builds of Object.values(stadium)) {
    for (const b of builds) {
      if (b.playstyle) {
        // "메타 · 무기 파워" → ["메타", "무기 파워"]
        b.playstyle.split(' · ').forEach(s => set.add(s.trim()));
      }
    }
  }
  return ['전체', ...Array.from(set).sort()];
}

function buildHTML(heroes, stadium) {
  // 역할군별 그룹화
  const grouped = { tank: [], damage: [], support: [], unknown: [] };
  for (const h of heroes) {
    const role = roleMap[h] ?? 'unknown';
    (grouped[role] ?? grouped.unknown).push(h);
  }

  const sections = ROLE_ORDER
    .filter(r => grouped[r]?.length)
    .map(r => `
      <div>
        <div class="text-xs font-semibold tracking-wide mb-1.5 flex items-center gap-1.5">
          <span class="px-1.5 py-0.5 rounded ${ROLE_CLASS[r] ?? 'text-gray-400'}">${ROLE_LABEL[r]}</span>
          <span class="text-gray-500 font-normal">${grouped[r].length}명</span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          ${grouped[r].map(h => heroPill(h)).join('')}
        </div>
      </div>
    `).join('');

  const unknownSection = grouped.unknown.length ? `
    <div>
      <div class="text-xs text-gray-500 font-semibold tracking-wide mb-1.5">기타</div>
      <div class="flex flex-wrap gap-1.5">
        ${grouped.unknown.map(h => heroPill(h)).join('')}
      </div>
    </div>
  ` : '';

  const styleOptions = collectStyles(stadium);

  return `
    <!-- 검색 바 -->
    <div class="flex gap-2 mb-4">
      <input
        id="stadium-search"
        type="text"
        class="search-input flex-1"
        placeholder="빌드 이름, 설명, 코드 검색..."
        value="${escHtml(searchQuery)}"
      />
      <select id="style-filter" class="ow-select shrink-0">
        ${styleOptions.map(s => `<option value="${escHtml(s)}"${s === styleFilter ? ' selected' : ''}>${escHtml(s)}</option>`).join('')}
      </select>
    </div>
    <!-- 영웅 pill -->
    <div class="mb-5 space-y-3 max-h-52 overflow-y-auto pb-1 pr-1">
      ${sections}${unknownSection}
    </div>
    <div id="builds-area"></div>
  `;
}

function attachEvents(container, stadium) {
  // 영웅 pill
  container.querySelectorAll('.hero-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      searchQuery = '';
      styleFilter = '전체';
      container.querySelector('#stadium-search').value = '';
      container.querySelector('#style-filter').value = '전체';
      container.querySelectorAll('.hero-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentHero = btn.dataset.hero;
      updateURL();
      renderBuilds(container, stadium);
    });
  });

  // 검색어
  const searchInput = container.querySelector('#stadium-search');
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      // 검색 모드에서는 hero pill active 해제
      if (searchQuery || styleFilter !== '전체') {
        container.querySelectorAll('.hero-pill').forEach(b => b.classList.remove('active'));
      } else {
        container.querySelectorAll('.hero-pill').forEach(b => {
          b.classList.toggle('active', b.dataset.hero === currentHero);
        });
      }
      updateURL();
      renderBuilds(container, stadium);
    }, 200);
  });

  // 플레이스타일 필터
  container.querySelector('#style-filter').addEventListener('change', e => {
    styleFilter = e.target.value;
    if (searchQuery || styleFilter !== '전체') {
      container.querySelectorAll('.hero-pill').forEach(b => b.classList.remove('active'));
    } else {
      container.querySelectorAll('.hero-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.hero === currentHero);
      });
    }
    updateURL();
    renderBuilds(container, stadium);
  });
}

function renderBuilds(container, stadium) {
  const area = container.querySelector('#builds-area');

  // 검색/필터 모드
  if (searchQuery || styleFilter !== '전체') {
    renderSearchResults(area, stadium);
    return;
  }

  // 영웅 선택 모드
  if (!currentHero) {
    area.innerHTML = `<p class="text-center text-gray-500 py-12">영웅을 선택하세요.</p>`;
    return;
  }

  const builds = stadium[currentHero] ?? [];
  if (!builds.length) {
    area.innerHTML = `<p class="text-center text-gray-500 py-12">${escHtml(koName(currentHero))}의 빌드가 없습니다.</p>`;
    return;
  }

  area.innerHTML = `
    <div class="mb-4 flex items-center gap-2">
      <span class="text-ow-orange font-bold text-lg">${escHtml(koName(currentHero))}</span>
      <span class="text-gray-500 text-sm">${escHtml(currentHero)}</span>
      <span class="text-gray-500 text-sm">· ${builds.length}개 빌드</span>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      ${builds.map((b, i) => buildCard(b, i + 1)).join('')}
    </div>
  `;

  attachCodeBadgeEvents(area);
}

function renderSearchResults(area, stadium) {
  const q = searchQuery.toLowerCase();

  // 모든 영웅 빌드 수집
  const results = [];
  for (const [heroEn, builds] of Object.entries(stadium)) {
    for (const b of builds) {
      // 플레이스타일 필터
      if (styleFilter !== '전체') {
        const parts = (b.playstyle ?? '').split(' · ').map(s => s.trim());
        if (!parts.includes(styleFilter)) continue;
      }
      // 검색어 필터
      if (q) {
        const hay = [b.name, b.description, b.code, b.playstyle, koName(heroEn), heroEn]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) continue;
      }
      results.push({ heroEn, build: b });
    }
  }

  if (!results.length) {
    area.innerHTML = `<p class="text-center text-gray-500 py-12">검색 결과가 없습니다.</p>`;
    return;
  }

  // 영웅별로 그룹화
  const grouped = {};
  for (const { heroEn, build } of results) {
    (grouped[heroEn] ??= []).push(build);
  }

  const sections = Object.entries(grouped).map(([heroEn, builds]) => `
    <div class="mb-6">
      <div class="mb-3 flex items-center gap-2">
        <span class="text-ow-orange font-bold">${escHtml(koName(heroEn))}</span>
        <span class="text-gray-500 text-sm">${escHtml(heroEn)}</span>
        <span class="text-gray-500 text-sm">· ${builds.length}개</span>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        ${builds.map((b, i) => buildCard(b, i + 1)).join('')}
      </div>
    </div>
  `).join('');

  const filterLabel = styleFilter !== '전체' ? ` · ${styleFilter}` : '';
  area.innerHTML = `
    <div class="mb-4 text-sm text-gray-400">
      ${q ? `"${escHtml(searchQuery)}"` : ''}${filterLabel} 검색 결과: ${results.length}개 빌드 (${Object.keys(grouped).length}명)
    </div>
    ${sections}
  `;

  attachCodeBadgeEvents(area);
}

function attachCodeBadgeEvents(area) {
  area.querySelectorAll('.code-badge').forEach(badge => {
    badge.addEventListener('click', async () => {
      const code = badge.dataset.code;
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      const orig = badge.textContent;
      badge.textContent = '복사됨!';
      badge.classList.add('copied');
      setTimeout(() => { badge.textContent = orig; badge.classList.remove('copied'); }, 1500);
    });
  });
}

const STAT_CONFIG = [
  { key: 'Weapon Power',       label: '무기 파워',   max: 80,  fmt: v => `+${v}%`, color: '#ef4444', always: true },
  { key: 'Ability Power',      label: '능력 파워',   max: 80,  fmt: v => `+${v}%`, color: '#a855f7', always: true },
  { key: 'Total LIFE',         label: '최대 체력',   max: 600, fmt: v => `+${v} HP`, color: '#22c55e', always: true },
  { key: 'Move Speed',         label: '이동 속도',   max: 40,  fmt: v => `+${v}%`, color: '#4FC3F7', always: false },
  { key: 'Cooldown Reduction', label: '재사용 단축', max: 40,  fmt: v => `-${v}%`, color: '#f59e0b', always: false },
  { key: 'Attack Speed',       label: '공격 속도',   max: 40,  fmt: v => `+${v}%`, color: '#f97316', always: false },
];

function buildStatBars(stats) {
  if (!stats || Object.keys(stats).length === 0) return '';

  const ls = (stats['Weapon Lifesteal'] ?? 0) + (stats['Ability Lifesteal'] ?? 0);
  const rows = [
    ...STAT_CONFIG
      .filter(s => s.always || (stats[s.key] ?? 0) > 0)
      .map(s => ({ label: s.label, value: stats[s.key] ?? 0, max: s.max, fmt: s.fmt, color: s.color })),
    ...(ls > 0 ? [{ label: '생명력 흡수', value: ls, max: 60, fmt: v => `+${v}%`, color: '#ec4899' }] : []),
  ];

  const bars = rows.map(s => {
    const pct = Math.min(100, Math.round((s.value / s.max) * 100));
    return `
      <div class="stat-bar-row">
        <span class="stat-bar-label">${escHtml(s.label)}</span>
        <div class="stat-bar-track">
          <div class="stat-bar-fill" style="width:${pct}%;background:${s.color}"></div>
        </div>
        <span class="stat-bar-value">${escHtml(s.fmt(s.value))}</span>
      </div>`;
  }).join('');

  return `<div class="space-y-1.5 border-t border-ow-border pt-3">${bars}</div>`;
}

function buildCard(b, rank) {
  return `
    <div class="stadium-card flex flex-col gap-3">
      <!-- 헤더: 순위 + 이름 + 플레이스타일 -->
      <div class="flex items-start gap-3">
        <span class="stadium-rank shrink-0">${rank}</span>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-base leading-snug text-gray-100">${escHtml(b.name)}</div>
        </div>
        <span class="playstyle-badge shrink-0">${escHtml(b.playstyle)}</span>
      </div>
      <!-- 빌드 코드 + 추천 수 + 비용 -->
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-500">빌드 코드</span>
        <span class="code-badge" data-code="${escHtml(b.code)}">${escHtml(b.code)}</span>
        <span class="ml-auto text-sm text-gray-400 flex items-center gap-2">
          ${b.cost ? `<span class="text-xs text-gray-500">${escHtml(b.cost)}</span>` : ''}
          <span class="flex items-center gap-1"><span class="text-ow-orange">↑</span>${(b.upvotes ?? 0).toLocaleString()}</span>
        </span>
      </div>
      <!-- 스탯 바 -->
      ${buildStatBars(b.stats)}
      <!-- 설명 -->
      ${b.description ? `
        <p class="text-sm text-gray-300 leading-relaxed border-t border-ow-border pt-3">${escHtml(b.description)}</p>
      ` : ''}
    </div>
  `;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
