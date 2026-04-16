/**
 * 스타디움 빌드 뷰
 * 영웅 pill 버튼 + 빌드 카드 (코드 클릭 → 클립보드 복사)
 */
import { loadJSON } from '../app.js';

let currentHero = null;

export async function renderStadium(container) {
  const stadium = await loadJSON('stadium');
  const heroes = Object.keys(stadium).sort((a, b) => a.localeCompare(b, 'en'));

  if (!currentHero || !stadium[currentHero]) {
    currentHero = heroes[0] ?? null;
  }

  container.innerHTML = buildHTML(heroes);
  attachEvents(container, stadium, heroes);
  renderBuilds(container, stadium);
}

function buildHTML(heroes) {
  const pills = heroes.map(h =>
    `<button class="hero-pill${h === currentHero ? ' active' : ''}" data-hero="${h}">${h}</button>`
  ).join('');

  return `
    <div class="mb-5">
      <div class="flex flex-wrap gap-2 max-h-28 overflow-y-auto pb-1">
        ${pills}
      </div>
    </div>
    <div id="builds-area"></div>
  `;
}

function attachEvents(container, stadium, heroes) {
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
    area.innerHTML = `<p class="text-center text-gray-500 py-12">${currentHero}의 빌드가 없습니다.</p>`;
    return;
  }

  area.innerHTML = `
    <div class="mb-3 flex items-center gap-2">
      <span class="text-ow-orange font-bold">${currentHero}</span>
      <span class="text-gray-500 text-sm">${builds.length}개 빌드</span>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      ${builds.map(b => buildCard(b)).join('')}
    </div>
  `;

  // 코드 복사 이벤트 위임
  area.querySelectorAll('.code-badge').forEach(badge => {
    badge.addEventListener('click', async () => {
      const code = badge.dataset.code;
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        // 클립보드 API 불가 시 fallback
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
      setTimeout(() => {
        badge.textContent = orig;
        badge.classList.remove('copied');
      }, 1500);
    });
  });
}

function buildCard(b) {
  const psClass = 'playstyle-badge';
  const upvoteIcon = '↑';
  return `
    <div class="patch-hero-card flex flex-col gap-3">
      <div class="flex items-start justify-between gap-2">
        <span class="font-semibold text-sm leading-snug flex-1">${escHtml(b.name)}</span>
        <span class="${psClass}">${escHtml(b.playstyle)}</span>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-500">빌드 코드</span>
        <span class="code-badge" data-code="${escHtml(b.code)}">${escHtml(b.code)}</span>
        <span class="ml-auto text-xs text-gray-500">${upvoteIcon} ${b.upvotes ?? 0}</span>
      </div>

      ${b.description ? `
        <p class="text-xs text-gray-400 leading-relaxed line-clamp-3">${escHtml(b.description)}</p>
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
