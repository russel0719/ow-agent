/**
 * 스타디움 빌드 뷰
 * 역할군별 영웅 pill 버튼 + 빌드 카드 (코드 클릭 → 클립보드 복사)
 */
import { loadJSON } from '../app.js';

let currentHero = null;  // stadium.json 의 영어 키
let koNameMap = {};       // 영어명 → 한국어명
let roleMap = {};         // 영어명 → role (tank/damage/support)

const ROLE_ORDER = ['tank', 'damage', 'support'];
const ROLE_LABEL = { tank: '탱커', damage: '딜러', support: '지원가' };
const ROLE_CLASS = { tank: 'role-tank', damage: 'role-damage', support: 'role-support' };

export async function renderStadium(container) {
  const [stadium, heroesData] = await Promise.all([
    loadJSON('stadium'),
    loadJSON('heroes').catch(() => null),
  ]);

  koNameMap = buildKoNameMap(heroesData);
  roleMap = buildRoleMap(heroesData);

  const heroes = Object.keys(stadium).sort((a, b) =>
    (koNameMap[a] ?? a).localeCompare(koNameMap[b] ?? b, 'ko')
  );

  if (!currentHero || !stadium[currentHero]) {
    currentHero = heroes[0] ?? null;
  }

  container.innerHTML = buildHTML(heroes);
  attachEvents(container, stadium);
  renderBuilds(container, stadium);
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

function koName(enName) {
  return koNameMap[enName] ?? enName;
}

function buildHTML(heroes) {
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
          ${grouped[r].map(h => `
            <button class="hero-pill${h === currentHero ? ' active' : ''}" data-hero="${h}">
              ${escHtml(koName(h))}
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');

  // unknown 영웅 처리 (역할 정보 없음)
  const unknownSection = grouped.unknown.length ? `
    <div>
      <div class="text-xs text-gray-500 font-semibold tracking-wide mb-1.5">기타</div>
      <div class="flex flex-wrap gap-1.5">
        ${grouped.unknown.map(h => `
          <button class="hero-pill${h === currentHero ? ' active' : ''}" data-hero="${h}">
            ${escHtml(koName(h))}
          </button>
        `).join('')}
      </div>
    </div>
  ` : '';

  return `
    <div class="mb-5 space-y-3 max-h-52 overflow-y-auto pb-1 pr-1">
      ${sections}${unknownSection}
    </div>
    <div id="builds-area"></div>
  `;
}

function attachEvents(container, stadium) {
  container.querySelectorAll('.hero-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.hero-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentHero = btn.dataset.hero;
      renderBuilds(container, stadium);
    });
  });
}

function renderBuilds(container, stadium) {
  const area = container.querySelector('#builds-area');
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
  { key: 'Total LIFE',         label: '최대 체력',   max: 600, fmt: v => `${v}`,   color: '#22c55e', always: true },
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
