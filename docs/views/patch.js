/**
 * 패치 노트 뷰
 * 일반 변경 + 영웅 변경 카드 그리드, 스타디움 섹션 분리
 */
import { loadJSON } from '../app.js';

export async function renderPatch(container) {
  const patch = await loadJSON('patch');

  const regular = patch.hero_changes?.filter(h => !h.is_stadium) ?? [];
  const stadium = patch.hero_changes?.filter(h => h.is_stadium) ?? [];

  container.innerHTML = `
    <div class="mb-6">
      <div class="flex items-center gap-3 mb-1">
        <h2 class="text-xl font-bold text-ow-orange">${escHtml(patch.title ?? '패치 노트')}</h2>
        ${patch.date ? `<span class="text-sm text-gray-400">${escHtml(patch.date)}</span>` : ''}
        ${patch.url ? `<a href="${escHtml(patch.url)}" target="_blank" rel="noopener"
            class="text-xs text-ow-blue hover:underline ml-auto">공식 페이지 →</a>` : ''}
      </div>
    </div>

    ${patch.general_changes?.length ? `
      <section class="mb-8">
        <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">일반 변경사항</h3>
        <div class="bg-ow-card border border-ow-border rounded-lg p-4">
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
      <section class="mb-8">
        <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          영웅 변경사항 <span class="text-gray-600 normal-case">(${regular.length}명)</span>
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${regular.map(h => heroChangeCard(h)).join('')}
        </div>
      </section>
    ` : ''}

    ${stadium.length ? `
      <section class="mb-8">
        <h3 class="text-sm font-semibold text-ow-orange uppercase tracking-wider mb-3">
          스타디움 변경사항 <span class="text-ow-orange/60 normal-case">(${stadium.length}명)</span>
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${stadium.map(h => heroChangeCard(h, true)).join('')}
        </div>
      </section>
    ` : ''}

    ${!regular.length && !stadium.length && !patch.general_changes?.length ? `
      <p class="text-center text-gray-500 py-12">패치 노트 데이터가 없습니다.</p>
    ` : ''}
  `;
}

function heroChangeCard(h, isStadium = false) {
  const changes = h.changes ?? [];
  return `
    <div class="patch-hero-card${isStadium ? ' is-stadium' : ''}">
      <div class="flex items-center gap-2 mb-3">
        <span class="font-semibold text-sm">${escHtml(h.hero)}</span>
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
