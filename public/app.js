/**
 * OW2 메타 대시보드 — SPA 라우터
 * Hash 기반 라우팅: #home | #meta | #stadium | #patch
 * 딥링크 지원: #meta?rank=그랜드마스터&hero=tracer
 */
import { renderHome } from './views/home.js?v=1';
import { renderMeta } from './views/meta.js?v=6';
import { renderAnalysis } from './views/analysis.js?v=1';
import { renderStadium } from './views/stadium.js?v=5';
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

// meta.json에서 hero_id → portrait_url 인덱스 빌드 (stadium/patch 뷰에서 사용)
let _portraitIndex = null;
export async function getPortraitIndex() {
  if (_portraitIndex) return _portraitIndex;
  try {
    const meta = await loadJSON('meta');
    _portraitIndex = {};
    for (const heroes of Object.values(meta)) {
      for (const h of heroes) {
        if (h.portrait_url && !_portraitIndex[h.hero_id]) {
          _portraitIndex[h.hero_id] = h.portrait_url;
        }
      }
    }
  } catch {
    _portraitIndex = {};
  }
  return _portraitIndex;
}

// ── 라우터 ────────────────────────────────────────────────────────────────────
const VIEWS = {
  home:     renderHome,
  meta:     renderMeta,
  analysis: renderAnalysis,
  stadium:  renderStadium,
  patch:    renderPatch,
};

const app = document.getElementById('app');
let firstNavigation = true;

async function navigate() {
  const raw = location.hash.slice(1) || 'home';
  const qIdx = raw.indexOf('?');
  const tab = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const params = new URLSearchParams(qIdx >= 0 ? raw.slice(qIdx + 1) : '');
  const activeTab = tab in VIEWS ? tab : 'home';
  const render = VIEWS[activeTab];

  // 탭 활성화
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
  });

  if (firstNavigation) {
    // 최초 로드: SEO용 정적 콘텐츠(generate_pages.py 주입)를 뷰가 준비될 때까지 유지.
    // GA4 초기 page_view는 gtag('config')가 전송하므로 여기서는 생략.
    firstNavigation = false;
  } else {
    // 로딩 표시
    app.innerHTML = `
      <div class="flex items-center justify-center h-64 text-gray-500">
        <div class="text-center">
          <div class="loading-spinner mx-auto mb-3"></div>
          <p>데이터 로드 중...</p>
        </div>
      </div>`;

    // SPA 가상 페이지뷰 (GA4는 hashchange를 페이지뷰로 집계하지 않음)
    if (window.gtag) {
      window.gtag('event', 'page_view', {
        page_location: location.href,
        page_title: `${document.title} — ${activeTab}`,
      });
    }
  }

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
