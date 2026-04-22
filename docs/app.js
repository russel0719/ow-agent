/**
 * OW2 메타 대시보드 — SPA 라우터
 * Hash 기반 라우팅: #meta | #stadium | #patch
 * 딥링크 지원: #meta?rank=그랜드마스터&hero=tracer
 */
import { renderMeta } from './views/meta.js?v=5';
import { renderStadium } from './views/stadium.js?v=4';
import { renderPatch } from './views/patch.js?v=4';

// ── 데이터 캐시 ───────────────────────────────────────────────────────────────
const cache = {};
const BASE = import.meta.url.replace('app.js', '') + 'data/';

export async function loadJSON(name) {
  if (cache[name]) return cache[name];
  const res = await fetch(BASE + name + '.json?v=' + Date.now());
  if (!res.ok) throw new Error(`${name}.json 로드 실패: ${res.status}`);
  cache[name] = await res.json();
  return cache[name];
}

// ── 라우터 ────────────────────────────────────────────────────────────────────
const VIEWS = {
  meta:    renderMeta,
  stadium: renderStadium,
  patch:   renderPatch,
};

const app = document.getElementById('app');

async function navigate() {
  const raw = location.hash.slice(1) || 'meta';
  const qIdx = raw.indexOf('?');
  const tab = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const params = new URLSearchParams(qIdx >= 0 ? raw.slice(qIdx + 1) : '');
  const activeTab = tab in VIEWS ? tab : 'meta';
  const render = VIEWS[activeTab];

  // 탭 활성화
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
  });

  // 로딩 표시
  app.innerHTML = `
    <div class="flex items-center justify-center h-64 text-gray-500">
      <div class="text-center">
        <div class="loading-spinner mx-auto mb-3"></div>
        <p>데이터 로드 중...</p>
      </div>
    </div>`;

  try {
    await render(app, params);
  } catch (e) {
    app.innerHTML = `
      <div class="flex items-center justify-center h-64 text-red-400">
        <div class="text-center">
          <p class="text-lg mb-2">데이터를 불러올 수 없습니다</p>
          <p class="text-sm text-gray-500">${e.message}</p>
        </div>
      </div>`;
  }
}

// ── 마지막 업데이트 표시 ───────────────────────────────────────────────────────
async function showLastUpdated() {
  try {
    const data = await loadJSON('last_updated');
    const dt = new Date(data.timestamp);
    const fmt = dt.toLocaleString('ko-KR', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Seoul',
    });
    document.getElementById('last-updated').textContent = `업데이트: ${fmt}`;
  } catch {
    // 무시
  }
}

// ── 초기화 ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    location.hash = btn.dataset.tab;
  });
});

window.addEventListener('hashchange', navigate);
showLastUpdated();
navigate();
