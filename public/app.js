/**
 * OW2 메타 대시보드 — SPA 라우터
 * Hash 기반 라우팅: #home | #meta | #analysis | #divergence | #stadium | #patch
 * 딥링크 지원: #meta?rank=그랜드마스터&hero=tracer
 */
import { renderHome } from './views/home.js?v=3';
import { renderMeta } from './views/meta.js?v=8';
import { renderAnalysis } from './views/analysis.js?v=1';
import { renderDivergence } from './views/divergence.js?v=1';
import { renderStadium } from './views/stadium.js?v=5';
import { renderPatch } from './views/patch.js?v=4';

// ── 데이터 소스 ───────────────────────────────────────────────────────────────
// 매일 갱신 데이터는 Supabase(ow_agent)에서 직접 읽는다. window.SUPABASE_* 는
// generate_pages.py 가 index.html <head> 에 주입 (data/site_config.json 값).
// 정적 lookup(heroes/maps)과 Supabase 미설정 과도기에는 로컬 ./data/*.json 폴백.
const cache = {};
const BASE = import.meta.url.replace('app.js', '') + 'data/';

const SB_URL = (window.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = window.SUPABASE_ANON_KEY || '';
const SB_ENABLED = !!(SB_URL && SB_KEY);

// Supabase datasets 테이블(blob)에서 읽는 이름. 그 외는 repo(./data).
const SUPABASE_DATASETS = new Set(['meta', 'map_meta', 'stadium', 'patch', 'last_updated']);

function sbHeaders() {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'ow_agent' };
}

async function fetchLocal(name) {
  const res = await fetch(`${BASE}${name}.json?v=${Date.now()}`);
  if (!res.ok) throw new Error(`${name}.json 로드 실패: ${res.status}`);
  return res.json();
}

async function fetchDataset(name) {
  const url = `${SB_URL}/rest/v1/datasets?name=eq.${encodeURIComponent(name)}&select=data`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`${name} 로드 실패: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`${name} 데이터 없음`);
  return rows[0].data;
}

export async function loadJSON(name) {
  if (cache[name]) return cache[name];
  const useSupabase = SB_ENABLED && SUPABASE_DATASETS.has(name);
  cache[name] = await (useSupabase ? fetchDataset(name) : fetchLocal(name));
  return cache[name];
}

// ── 정규화 히스토리 ───────────────────────────────────────────────────────────
// 필요한 랭크/맵만 조회해 egress 최소화. 키별 캐시. 반환 형태는 {date: 배열} —
// 기존 meta_history[rank] / map_meta_history[mapId] 와 동일해 소비부 변경 최소.
const _historyCache = {};
const _mapHistoryCache = {};

async function _loadNormalizedHistory(table, filterCol, key, valueCol, cacheObj, fallbackName) {
  if (key in cacheObj) return cacheObj[key];
  let byDate = {};
  if (SB_ENABLED) {
    const url = `${SB_URL}/rest/v1/${table}?${filterCol}=eq.${encodeURIComponent(key)}`
      + `&select=snapshot_date,${valueCol}&order=snapshot_date`;
    const res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) throw new Error(`${table} 로드 실패: ${res.status}`);
    for (const r of await res.json()) byDate[r.snapshot_date] = r[valueCol];
  } else {
    // 폴백: 로컬 전체 blob에서 해당 키 슬라이스
    const all = await loadJSON(fallbackName).catch(() => ({}));
    byDate = all?.[key] ?? {};
  }
  cacheObj[key] = byDate;
  return byDate;
}

export function loadHistory(rank) {
  return _loadNormalizedHistory(
    'meta_history', 'rank', rank, 'heroes', _historyCache, 'meta_history'
  );
}

export function loadMapHistory(mapId) {
  return _loadNormalizedHistory(
    'map_meta_history', 'map_id', mapId, 'entries', _mapHistoryCache, 'map_meta_history'
  );
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
  home:       renderHome,
  meta:       renderMeta,
  analysis:   renderAnalysis,
  divergence: renderDivergence,
  stadium:    renderStadium,
  patch:      renderPatch,
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
