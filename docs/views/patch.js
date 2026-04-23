/**
 * 패치 노트 뷰
 * 최근 30일 패치 누적 표시 (아코디언, 최신 패치 기본 펼침)
 * 영웅 카드에 현재 메타 점수/티어 표시 (그랜드마스터 기준)
 */
import { loadJSON, getPortraitIndex } from '../app.js';

export async function renderPatch(container, _params) {
  const [raw, metaRaw, heroesData] = await Promise.all([
    loadJSON('patch'),
    loadJSON('meta').catch(() => null),
    loadJSON('heroes').catch(() => null),
  ]);

  // 하위 호환: 단일 객체도 처리
  const patches = Array.isArray(raw) ? raw : (raw ? [raw] : []);

  // 그랜드마스터 기준 한국어 영웅명 → {meta_score, tier} 맵
  const metaMap = buildMetaMap(metaRaw);

  // 한국어 영웅명 → hero_id 맵 (초상화용)
  const koToHeroId = buildKoToHeroIdMap(heroesData);
  const portraitIndex = await getPortraitIndex();

  if (!patches.length) {
    container.innerHTML = `<p class="text-center text-gray-500 py-12">패치 노트 데이터가 없습니다.</p>`;
    return;
  }

  container.innerHTML = patches.map((patch, idx) => `
    <details ${idx === 0 ? 'open' : ''} class="mb-4 bg-ow-card border border-ow-border rounded-lg overflow-hidden group">
      <summary class="flex items-center gap-3 px-5 py-4 cursor-pointer select-none list-none hover:bg-white/5 transition-colors">
        <span class="text-ow-orange font-bold flex-1 text-sm">${escHtml(patch.title ?? '패치 노트')}</span>
        ${patch.date ? `<span class="text-xs text-gray-400 shrink-0">${escHtml(patch.date)}</span>` : ''}
        ${patch.url ? `<a href="${escHtml(patch.url)}" target="_blank" rel="noopener"
            class="text-xs text-ow-blue hover:underline shrink-0" onclick="event.stopPropagation()">공식 페이지 →</a>` : ''}
        <svg class="w-4 h-4 text-gray-500 shrink-0 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
      </summary>
      <div class="px-5 pb-5 pt-2">
        ${renderPatchBody(patch, metaMap, koToHeroId, portraitIndex)}
      </div>
    </details>
  `).join('');
}

/** 한국어 영웅명 → hero_id 맵 생성 (초상화용) */
function buildKoToHeroIdMap(heroesData) {
  const map = {};
  if (!heroesData) return map;
  for (const [id, hero] of Object.entries(heroesData.heroes ?? heroesData)) {
    for (const alias of hero.aliases ?? []) {
      if (/[가-힣]/.test(alias)) map[alias] = id;
    }
  }
  return map;
}

/** 그랜드마스터 메타 데이터에서 한국어 영웅명 → {meta_score, tier} 맵 생성 */
function buildMetaMap(metaRaw) {
  const map = {};
  if (!metaRaw) return map;
  const gmList = metaRaw['그랜드마스터'] ?? [];
  for (const hero of gmList) {
    if (hero.hero_name) {
      map[hero.hero_name] = { meta_score: hero.meta_score, tier: hero.tier };
    }
  }
  return map;
}

function renderPatchBody(patch, metaMap, koToHeroId = {}, portraitIndex = {}) {
  const regular = patch.hero_changes?.filter(h => !h.is_stadium) ?? [];
  const stadium = patch.hero_changes?.filter(h => h.is_stadium) ?? [];

  return `
    ${patch.general_changes?.length ? `
      <section class="mb-6">
        <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">일반 변경사항</h3>
        <div class="bg-ow-bg border border-ow-border rounded-lg p-4">
          <ul class="space-y-1.5">
            ${patch.general_changes.map(c => `
              <li class="flex gap-2 text-sm text-gray-300">
                <span class="text-ow-orange mt-0.5 shrink-0">•</span>
                <span>${escHtml(c)}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      </section>
    ` : ''}

    ${regular.length ? `
      <section class="mb-6">
        <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          영웅 변경사항 <span class="text-gray-600 normal-case">(${regular.length}명)</span>
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${regular.map(h => heroChangeCard(h, false, metaMap, koToHeroId, portraitIndex)).join('')}
        </div>
      </section>
    ` : ''}

    ${stadium.length ? `
      <section class="mb-2">
        <h3 class="text-xs font-semibold text-ow-orange uppercase tracking-wider mb-3">
          스타디움 변경사항 <span class="text-ow-orange/60 normal-case">(${stadium.length}명)</span>
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${stadium.map(h => heroChangeCard(h, true, metaMap, koToHeroId, portraitIndex)).join('')}
        </div>
      </section>
    ` : ''}

    ${!regular.length && !stadium.length && !patch.general_changes?.length ? `
      <p class="text-center text-gray-500 py-6 text-sm">변경사항 데이터가 없습니다.</p>
    ` : ''}
  `;
}

function heroChangeCard(h, isStadium = false, metaMap = {}, koToHeroId = {}, portraitIndex = {}) {
  const changes = h.changes ?? [];
  const meta = metaMap[h.hero];
  const heroId = koToHeroId[h.hero];
  const portraitUrl = heroId ? portraitIndex[heroId] : null;
  const tierBadge = meta?.tier
    ? `<span class="patch-tier-badge tier-${meta.tier}">${escHtml(meta.tier)}</span>`
    : '';
  const scoreLabel = meta?.meta_score != null
    ? `<span class="text-xs text-gray-500">${meta.meta_score.toFixed(1)}점</span>`
    : '';
  const initial = escHtml(h.hero?.[0] ?? '?');
  const portraitHtml = portraitUrl ? `
    <div class="relative shrink-0" style="width:32px;height:32px;">
      <img src="${portraitUrl}" alt="${escHtml(h.hero)}"
           class="hero-portrait hero-portrait-md"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
           loading="lazy">
      <span class="hero-portrait-fallback hero-portrait-md"
            style="display:none;background:#30363D;font-size:0.65rem;">${initial}</span>
    </div>
  ` : `
    <div class="hero-portrait-fallback hero-portrait-md shrink-0"
         style="background:#30363D;font-size:0.65rem;">${initial}</div>
  `;

  return `
    <div class="patch-hero-card${isStadium ? ' is-stadium' : ''}">
      <div class="flex items-center gap-2 mb-3">
        ${portraitHtml}
        <span class="font-semibold text-sm flex-1">${escHtml(h.hero)}</span>
        ${tierBadge}${scoreLabel}
        ${isStadium ? `<span class="text-xs text-ow-orange border border-ow-orange/40 px-1.5 rounded">스타디움</span>` : ''}
      </div>
      ${changes.length ? `
        <ul class="space-y-1.5">
          ${changes.map(c => `
            <li class="flex gap-2 text-xs text-gray-300">
              <span class="text-gray-600 mt-0.5 shrink-0">–</span>
              <span>${escHtml(c)}</span>
            </li>
          `).join('')}
        </ul>
      ` : '<p class="text-xs text-gray-500">세부 변경 내용 없음</p>'}
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
