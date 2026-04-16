/**
 * 영웅 정보 뷰
 * 검색 + 역할 필터 + 카드 클릭 시 상세 패널 (카운터·시너지·팁·현재 티어)
 */
import { loadJSON } from '../app.js';

let currentRole = '전체';
let currentSearch = '';
let selectedHeroId = null;

export async function renderHeroes(container) {
  const [heroes, meta] = await Promise.all([
    loadJSON('heroes'),
    loadJSON('meta').catch(() => null),
  ]);

  // heroes.json 포맷: { "ana": { name, name_ko, role, counters, synergies, tips, ... }, ... }
  const heroList = Object.entries(heroes).map(([id, h]) => ({ id, ...h }));

  // 현재 메타 티어 매핑 (전체 랭크 기준)
  const tierMap = {};
  if (meta?.['전체']) {
    meta['전체'].forEach(h => { tierMap[h.hero_id] = h; });
  }

  container.innerHTML = buildHTML();
  attachEvents(container, heroList, tierMap);
  renderGrid(container, heroList, tierMap);
}

function buildHTML() {
  return `
    <div class="mb-5 flex flex-wrap items-center gap-3">
      <input type="text" class="search-input w-48" placeholder="영웅 검색..." id="hero-search" value="${escHtml(currentSearch)}" />
      <div class="flex gap-2 flex-wrap">
        ${['전체', '탱커', '딜러', '지원가'].map(r => `
          <button class="filter-btn${r === currentRole ? ' active' : ''}" data-role="${r}">${r}</button>
        `).join('')}
      </div>
      <span class="ml-auto text-xs text-gray-500" id="hero-count"></span>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" id="heroes-grid"></div>
    <div id="hero-detail" class="mt-6"></div>
  `;
}

function attachEvents(container, heroList, tierMap) {
  container.querySelector('#hero-search').addEventListener('input', e => {
    currentSearch = e.target.value;
    renderGrid(container, heroList, tierMap);
  });

  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRole = btn.dataset.role;
      renderGrid(container, heroList, tierMap);
    });
  });

  container.querySelector('#heroes-grid').addEventListener('click', e => {
    const card = e.target.closest('[data-hero-id]');
    if (!card) return;
    const heroId = card.dataset.heroId;

    if (selectedHeroId === heroId) {
      selectedHeroId = null;
      card.classList.remove('selected');
      container.querySelector('#hero-detail').innerHTML = '';
      return;
    }

    container.querySelectorAll('[data-hero-id].selected').forEach(c => c.classList.remove('selected'));
    selectedHeroId = heroId;
    card.classList.add('selected');

    const hero = heroList.find(h => h.id === heroId);
    showDetail(container, hero, tierMap[heroId]);
  });
}

const ROLE_FILTER_MAP = { '탱커': 'tank', '딜러': 'damage', '지원가': 'support' };
const ROLE_LABEL = { tank: '탱커', damage: '딜러', support: '지원가' };
const ROLE_CLASS = { tank: 'role-tank', damage: 'role-damage', support: 'role-support' };

function renderGrid(container, heroList, tierMap) {
  const search = currentSearch.trim().toLowerCase();
  const roleEn = ROLE_FILTER_MAP[currentRole];

  const filtered = heroList.filter(h => {
    if (roleEn && h.role !== roleEn) return false;
    if (search) {
      const name = (h.name ?? '').toLowerCase();
      const nameKo = (h.name_ko ?? '').toLowerCase();
      if (!name.includes(search) && !nameKo.includes(search)) return false;
    }
    return true;
  });

  const countEl = container.querySelector('#hero-count');
  if (countEl) countEl.textContent = `${filtered.length}명`;

  const grid = container.querySelector('#heroes-grid');
  if (!filtered.length) {
    grid.innerHTML = `<p class="col-span-full text-center text-gray-500 py-12">결과가 없습니다.</p>`;
    return;
  }

  grid.innerHTML = filtered.map(h => {
    const meta = tierMap[h.id];
    const roleClass = ROLE_CLASS[h.role] ?? '';
    const roleLabel = ROLE_LABEL[h.role] ?? h.role;
    return `
      <div class="hero-card${selectedHeroId === h.id ? ' selected' : ''}" data-hero-id="${h.id}">
        <div class="flex items-start justify-between mb-2 gap-1">
          <div>
            <div class="font-semibold text-sm leading-tight">${escHtml(h.name_ko ?? h.name)}</div>
            <div class="text-xs text-gray-500">${escHtml(h.name)}</div>
          </div>
          <span class="text-xs px-1.5 py-0.5 rounded ${roleClass} shrink-0">${roleLabel}</span>
        </div>
        ${meta ? `
          <div class="flex items-center gap-1.5 mt-1">
            <span class="text-xs border rounded px-1 tier-${meta.tier}">${meta.tier}</span>
            <span class="text-xs text-gray-400">${meta.meta_score?.toFixed(1) ?? '-'}</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function showDetail(container, hero, metaInfo) {
  if (!hero) return;
  const detail = container.querySelector('#hero-detail');

  const counters = hero.counters ?? [];
  const synergies = hero.synergies ?? [];
  const tips = hero.tips ?? [];

  detail.innerHTML = `
    <div class="hero-detail-panel">
      <div class="flex items-center gap-3 mb-5">
        <div>
          <h2 class="text-xl font-bold">${escHtml(hero.name_ko ?? hero.name)}</h2>
          <div class="text-sm text-gray-400">${escHtml(hero.name)}</div>
        </div>
        <span class="text-sm px-2 py-0.5 rounded ${ROLE_CLASS[hero.role] ?? ''}">
          ${ROLE_LABEL[hero.role] ?? hero.role}
        </span>
        ${metaInfo ? `
          <div class="ml-auto text-right">
            <div class="text-ow-orange font-bold text-lg">${metaInfo.meta_score?.toFixed(1) ?? '-'}</div>
            <div class="text-xs text-gray-500">
              티어 <span class="font-semibold tier-${metaInfo.tier}">${metaInfo.tier}</span> ·
              픽 ${metaInfo.pick_rate?.toFixed(1) ?? '-'}% ·
              승 ${metaInfo.win_rate?.toFixed(1) ?? '-'}%
            </div>
          </div>
        ` : ''}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
        ${counters.length ? `
          <div>
            <h3 class="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">카운터</h3>
            <ul class="space-y-1">
              ${counters.map(c => `<li class="text-sm text-gray-300 flex gap-2"><span class="text-red-500/60">•</span>${escHtml(c)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${synergies.length ? `
          <div>
            <h3 class="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2">시너지</h3>
            <ul class="space-y-1">
              ${synergies.map(s => `<li class="text-sm text-gray-300 flex gap-2"><span class="text-green-500/60">•</span>${escHtml(s)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${tips.length ? `
          <div>
            <h3 class="text-xs font-semibold text-ow-blue uppercase tracking-wider mb-2">플레이 팁</h3>
            <ul class="space-y-1.5">
              ${tips.map(t => `<li class="text-sm text-gray-300 flex gap-2"><span class="text-ow-blue/60">•</span>${escHtml(t)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${!counters.length && !synergies.length && !tips.length ? `
          <div class="col-span-3 text-gray-500 text-sm text-center py-4">
            상세 정보가 없습니다.
          </div>
        ` : ''}
      </div>
    </div>
  `;

  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
