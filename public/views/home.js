/**
 * OW2 홈 대시보드
 * - AI 주간 메타 요약 (NVIDIA Kimi K2 via Cloudflare Worker)
 * - 이번주 꿀/똥 영웅 TOP3
 * - 픽률 vs 승률 버블 차트 (메타 맵)
 */
import { loadJSON, getPortraitIndex, WORKER_URL } from '../app.js';

const ROLE_COLOR = {
  tank:    '#60a5fa',
  damage:  '#f87171',
  support: '#4ade80',
};

const TIER_BADGE = {
  S: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
  A: 'bg-orange-500/20 text-orange-400 border border-orange-500/40',
  B: 'bg-blue-500/20 text-blue-400 border border-blue-500/40',
  C: 'bg-gray-500/20 text-gray-400 border border-gray-500/40',
  D: 'bg-red-900/20 text-red-400 border border-red-900/40',
};

// ── 7일 델타 계산 ─────────────────────────────────────────────────────────────

function calcWeeklyDeltas(history) {
  const dates = Object.keys(history).sort();
  if (dates.length < 2) return [];

  const latestDate = dates[dates.length - 1];
  const latest = history[latestDate] ?? [];

  // 7일 전 또는 가장 오래된 날짜
  const targetDate = dates.find(d => d >= subtractDays(latestDate, 7)) ?? dates[0];
  const prev = history[targetDate] ?? [];
  const prevMap = Object.fromEntries(prev.map(h => [h.hero_id, h.meta_score]));

  return latest.map(h => ({
    ...h,
    delta: prevMap[h.hero_id] != null
      ? +(h.meta_score - prevMap[h.hero_id]).toFixed(1)
      : null,
  }));
}

function subtractDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── 영웅 초상화 ───────────────────────────────────────────────────────────────

function portraitImg(url, name, size = 40) {
  if (url) {
    return `<img src="${url}" alt="${name}" width="${size}" height="${size}"
      class="rounded-full object-cover shrink-0 border border-ow-border"
      style="width:${size}px;height:${size}px"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <span class="hero-portrait-fallback shrink-0" style="width:${size}px;height:${size}px;display:none">${name.slice(0, 1)}</span>`;
  }
  return `<span class="hero-portrait-fallback shrink-0" style="width:${size}px;height:${size}px">${name.slice(0, 1)}</span>`;
}

// ── TOP3 카드 렌더링 ──────────────────────────────────────────────────────────

function heroCard(h, portraitIndex, rank) {
  const url = portraitIndex?.[h.hero_id] ?? '';
  const deltaSign = h.delta > 0 ? '+' : '';
  const deltaColor = h.delta > 0 ? 'text-green-400' : h.delta < 0 ? 'text-red-400' : 'text-gray-400';
  const deltaTxt = h.delta != null ? `${deltaSign}${h.delta}` : '–';
  const tierClass = TIER_BADGE[h.tier] ?? TIER_BADGE.C;
  const roleColor = ROLE_COLOR[h.role] ?? '#9ca3af';

  return `
    <div class="flex items-center gap-3 bg-ow-bg border border-ow-border rounded-xl p-3">
      <span class="text-ow-orange font-bold text-sm w-4 shrink-0 text-center">${rank}</span>
      <div class="shrink-0 relative" style="border: 2px solid ${roleColor}; border-radius: 50%;">
        ${portraitImg(url, h.hero_name, 40)}
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm truncate">${h.hero_name}</div>
        <div class="flex items-center gap-1.5 mt-0.5">
          <span class="text-xs px-1.5 py-0.5 rounded ${tierClass}">${h.tier}티어</span>
          <span class="text-xs text-gray-500">${h.meta_score.toFixed(1)}점</span>
        </div>
      </div>
      <span class="text-sm font-semibold ${deltaColor} shrink-0">${deltaTxt}</span>
    </div>`;
}

// ── AI 주간 요약 ──────────────────────────────────────────────────────────────

async function buildAISummaryContext(heroes, patches) {
  const sorted = [...heroes].sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  const rising = sorted.filter(h => h.delta != null).slice(0, 5)
    .map(h => `${h.hero_name}(${h.delta > 0 ? '+' : ''}${h.delta})`).join(', ');
  const falling = [...sorted].reverse().filter(h => h.delta != null).slice(0, 5)
    .map(h => `${h.hero_name}(${h.delta > 0 ? '+' : ''}${h.delta})`).join(', ');

  const sTier = heroes.filter(h => h.tier === 'S').map(h => h.hero_name).join(', ') || '없음';
  const aTier = heroes.filter(h => h.tier === 'A').map(h => h.hero_name).join(', ') || '없음';

  const recentPatch = patches?.[0];
  let patchSummary = '';
  if (recentPatch) {
    const changes = (recentPatch.hero_changes ?? []).slice(0, 5)
      .map(hc => `[${hc.hero}] ${hc.changes[0] ?? ''}`).join(' / ');
    patchSummary = `최근 패치(${recentPatch.date}): ${changes}`;
  }

  return `오버워치 2 전체 랭크 메타 데이터 기준.
상승 TOP5: ${rising}
하락 TOP5: ${falling}
현재 S티어: ${sTier}
현재 A티어: ${aTier}
${patchSummary}`;
}

async function fetchAISummary(context) {
  if (!WORKER_URL) return null;
  const resp = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: `다음 오버워치 2 메타 데이터를 바탕으로 이번 주 메타 특징을 한국어로 3줄 요약해줘. 불릿 포인트(•) 형식으로, 각 줄 50자 이내로 간결하게:\n\n${context}`,
        },
      ],
      max_tokens: 256,
      temperature: 0.4,
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? null;
}

// ── 버블 차트 ─────────────────────────────────────────────────────────────────

let homeChart = null;

async function preloadPortraits(heroes, portraitIndex) {
  const map = new Map();
  await Promise.all(heroes.map(h => {
    const url = portraitIndex?.[h.hero_id];
    if (!url) return;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => { map.set(h.hero_id, img); resolve(); };
      img.onerror = resolve;
      img.src = url;
    });
  }));
  return map;
}

async function renderBubbleChart(container, heroes, portraitIndex) {
  const canvas = container.querySelector('#home-bubble-chart');
  if (!canvas) return;

  // Chart.getChart으로 이 canvas에 붙은 차트를 확실히 제거
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  homeChart = null;

  const validHeroes = heroes.filter(h => h.pick_rate > 0 && h.win_rate > 0);
  const imageMap = await preloadPortraits(validHeroes, portraitIndex);

  // 이미지 로딩 중 canvas가 DOM에서 사라졌으면 중단
  if (!canvas.isConnected) return;

  const datasets = Object.entries(ROLE_COLOR).map(([role, color]) => ({
    label: role === 'tank' ? '탱커' : role === 'damage' ? '딜러' : '지원가',
    data: validHeroes
      .filter(h => h.role === role)
      .map(h => ({
        x: h.pick_rate,
        y: h.win_rate,
        r: Math.max(14, Math.sqrt(h.meta_score) * 1.6),
        hero: h,
      })),
    backgroundColor: 'rgba(0,0,0,0)',
    borderColor: 'rgba(0,0,0,0)',
    borderWidth: 0,
    // 범례 색상은 legendColor로 별도 제공
    legendColor: color,
  }));

  const avgPick = validHeroes.reduce((s, h) => s + h.pick_rate, 0) / (validHeroes.length || 1);
  const winRates = validHeroes.map(h => h.win_rate);
  const minWin = Math.floor(Math.min(...winRates)) - 1;
  const maxWin = Math.ceil(Math.max(...winRates)) + 1;

  // 기준선 + 사분면 레이블
  const quadrantPlugin = {
    id: 'quadrants',
    afterDraw(chart) {
      const { ctx, chartArea: { left, right, top, bottom }, scales: { x, y } } = chart;
      const cx = x.getPixelForValue(avgPick);
      const cy = y.getPixelForValue(50);

      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(156,163,175,0.35)';
      ctx.lineWidth = 1;

      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(left, cy); ctx.lineTo(right, cy); ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(156,163,175,0.5)';
      ctx.textAlign = 'right';  ctx.fillText('숨겨진 강캐', cx - 6, top + 14);
      ctx.textAlign = 'left';   ctx.fillText('주요 강캐',   cx + 6, top + 14);
      ctx.textAlign = 'right';  ctx.fillText('약세',        cx - 6, bottom - 6);
      ctx.textAlign = 'left';   ctx.fillText('인기 but 약세', cx + 6, bottom - 6);
      ctx.restore();
    },
  };

  // 초상화 + 티어 배지 플러그인
  const portraitPlugin = {
    id: 'heroPortraits',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((ds, dsIdx) => {
        const dsMeta = chart.getDatasetMeta(dsIdx);
        const roleColor = Object.values(ROLE_COLOR)[dsIdx] ?? '#9ca3af';
        ds.data.forEach((pt, ptIdx) => {
          const h = pt.hero;
          const el = dsMeta.data[ptIdx];
          if (!el) return;
          const r = pt.r;
          const img = imageMap.get(h.hero_id);

          // 원형 클리핑 후 초상화 (또는 역할 색상 폴백)
          ctx.save();
          ctx.beginPath();
          ctx.arc(el.x, el.y, r, 0, Math.PI * 2);
          ctx.clip();
          if (img) {
            ctx.drawImage(img, el.x - r, el.y - r, r * 2, r * 2);
          } else {
            ctx.fillStyle = roleColor + 'cc';
            ctx.fill();
          }
          ctx.restore();

          // 역할 색상 테두리
          ctx.save();
          ctx.beginPath();
          ctx.arc(el.x, el.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = roleColor;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();

          // S/A 티어 배지 (우상단)
          if (h.tier === 'S' || h.tier === 'A') {
            const bx = el.x + r * 0.65;
            const by = el.y - r * 0.65;
            const br = Math.max(6, r * 0.35);
            ctx.save();
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fillStyle = h.tier === 'S' ? '#facc15' : '#fb923c';
            ctx.fill();
            ctx.font = `bold ${Math.floor(Math.max(8, br))}px sans-serif`;
            ctx.fillStyle = '#000';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(h.tier, bx, by);
            ctx.restore();
          }
        });
      });
    },
  };

  homeChart = new Chart(canvas, {
    type: 'bubble',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: {
          labels: {
            color: '#9ca3af',
            font: { size: 12 },
            generateLabels(chart) {
              return chart.data.datasets.map((ds, i) => ({
                text: ds.label,
                fillStyle: Object.values(ROLE_COLOR)[i] + '80',
                strokeStyle: Object.values(ROLE_COLOR)[i],
                lineWidth: 2,
                hidden: false,
                datasetIndex: i,
                fontColor: '#9ca3af',
                color: '#9ca3af',
              }));
            },
          },
        },
        tooltip: {
          backgroundColor: '#161B22',
          borderColor: '#30363D',
          borderWidth: 1,
          callbacks: {
            label(ctx) {
              const h = ctx.raw.hero;
              return ` ${h.hero_name}  픽률 ${h.pick_rate}%  승률 ${h.win_rate}%  점수 ${h.meta_score}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: '픽률 (%)', color: '#6B7280', font: { size: 11 } },
          ticks: { color: '#6B7280', font: { size: 10 } },
          grid: { color: '#1F2937' },
        },
        y: {
          min: minWin,
          max: maxWin,
          title: { display: true, text: '승률 (%)', color: '#6B7280', font: { size: 11 } },
          ticks: { color: '#6B7280', font: { size: 10 } },
          grid: { color: '#1F2937' },
        },
      },
    },
    plugins: [quadrantPlugin, portraitPlugin],
  });
}

// ── 메인 렌더 함수 ────────────────────────────────────────────────────────────

export async function renderHome(container) {
  container.innerHTML = `
    <div class="max-w-5xl mx-auto space-y-5 pb-10">

      <!-- AI 요약 -->
      <div class="bg-ow-card border border-ow-border rounded-xl p-5">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-base font-semibold text-ow-blue">AI 주간 메타 요약</span>
          <span class="text-xs text-gray-500">Kimi K2</span>
          <span id="ai-data-date" class="text-xs text-gray-600"></span>
        </div>
        <div id="ai-summary" class="text-sm text-gray-300 leading-relaxed space-y-1">
          <div class="flex items-center gap-2 text-gray-500">
            <div class="loading-spinner shrink-0"></div> AI 분석 중...
          </div>
        </div>
      </div>

      <!-- 꿀/똥 영웅 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="bg-ow-card border border-ow-border rounded-xl p-5">
          <div class="text-sm font-semibold text-green-400 mb-3">이번주 꿀 영웅 TOP 3</div>
          <div id="top-rising" class="space-y-2">
            <div class="text-gray-500 text-sm">로딩 중...</div>
          </div>
        </div>
        <div class="bg-ow-card border border-ow-border rounded-xl p-5">
          <div class="text-sm font-semibold text-red-400 mb-3">이번주 똥 영웅 TOP 3</div>
          <div id="top-falling" class="space-y-2">
            <div class="text-gray-500 text-sm">로딩 중...</div>
          </div>
        </div>
      </div>

      <!-- 버블 차트 -->
      <div class="bg-ow-card border border-ow-border rounded-xl p-5">
        <div class="text-sm font-semibold text-gray-300 mb-1">메타 맵 — 픽률 vs 승률</div>
        <div class="text-xs text-gray-500 mb-4">버블 크기 = 메타 점수 · 전체 랭크 기준</div>
        <div style="height: 780px; position: relative;">
          <canvas id="home-bubble-chart"></canvas>
        </div>
      </div>

    </div>`;

  try {
    const [history, patches, portraitIndex] = await Promise.all([
      loadJSON('meta_history'),
      loadJSON('patch').catch(() => null),
      getPortraitIndex(),
    ]);

    const allHistory = history?.['전체'] ?? {};
    const heroes = calcWeeklyDeltas(allHistory);

    if (!heroes.length) {
      container.querySelector('#top-rising').innerHTML = '<p class="text-gray-500 text-sm">데이터 없음</p>';
      container.querySelector('#top-falling').innerHTML = '<p class="text-gray-500 text-sm">데이터 없음</p>';
      container.querySelector('#ai-summary').innerHTML = '<p class="text-gray-500 text-sm">데이터를 불러올 수 없습니다.</p>';
      return;
    }

    // 버블 차트 — meta.json 전체 랭크 데이터 사용
    const meta = await loadJSON('meta').catch(() => null);
    const metaHeroes = meta?.['전체'] ?? meta?.[Object.keys(meta ?? {})[0]] ?? heroes;
    await renderBubbleChart(container, metaHeroes, portraitIndex);

    // TOP3 꿀/똥 영웅 (delta 기준, null 제외)
    const withDelta = heroes.filter(h => h.delta != null);
    const rising = [...withDelta].sort((a, b) => b.delta - a.delta).slice(0, 3);
    const falling = [...withDelta].sort((a, b) => a.delta - b.delta).slice(0, 3);

    container.querySelector('#top-rising').innerHTML =
      rising.length
        ? rising.map((h, i) => heroCard(h, portraitIndex, i + 1)).join('')
        : '<p class="text-gray-500 text-sm">데이터 없음</p>';

    container.querySelector('#top-falling').innerHTML =
      falling.length
        ? falling.map((h, i) => heroCard(h, portraitIndex, i + 1)).join('')
        : '<p class="text-gray-500 text-sm">데이터 없음</p>';

    // AI 요약 (sessionStorage 캐시)
    const dates = Object.keys(allHistory).sort();
    const latestDate = dates[dates.length - 1] ?? 'unknown';

    // 기준일 표시
    if (latestDate !== 'unknown') {
      const [, m, d] = latestDate.split('-');
      container.querySelector('#ai-data-date').textContent = `· ${+m}월 ${+d}일 데이터 기준`;
    }
    const cacheKey = `ow2-summary-${latestDate}`;
    const cached = sessionStorage.getItem(cacheKey);
    const summaryEl = container.querySelector('#ai-summary');

    if (cached) {
      summaryEl.innerHTML = formatSummary(cached);
    } else {
      const context = await buildAISummaryContext(heroes, patches);
      const summary = await fetchAISummary(context).catch(() => null);
      if (summary) {
        sessionStorage.setItem(cacheKey, summary);
        summaryEl.innerHTML = formatSummary(summary);
      } else {
        summaryEl.innerHTML = '<p class="text-gray-500 text-sm">AI 요약을 불러올 수 없습니다.</p>';
      }
    }
  } catch (e) {
    container.querySelector('#ai-summary').innerHTML =
      `<p class="text-red-400 text-sm">오류: ${e.message}</p>`;
  }
}

function formatSummary(text) {
  return text
    .split('\n')
    .filter(l => l.trim())
    .map(l => `<p>${l.trim()}</p>`)
    .join('');
}
