/**
 * OW2 AI 전문가 챗봇 - 플로팅 버튼 + 팝업
 *
 * 사용 전: cloudflare-worker/worker.js 를 Cloudflare에 배포 후
 * 아래 WORKER_URL 을 실제 Worker URL로 교체하세요.
 */
import { loadJSON } from '../app.js';

const WORKER_URL = 'https://withered-disk-becf.russel0719.workers.dev/';
const DAILY_LIMIT = 20;

// ── 랭크 감지 ─────────────────────────────────────────────────────────────────

const RANK_KEYWORDS = [
  ['챔피언', '챔피언'],
  ['그랜드마스터', '그랜드마스터'],
  ['그마', '그랜드마스터'],
  ['grandmaster', '그랜드마스터'],
  ['gm', '그랜드마스터'],
  ['마스터', '마스터'],
  ['master', '마스터'],
  ['다이아몬드', '다이아몬드'],
  ['다이아', '다이아몬드'],
  ['diamond', '다이아몬드'],
  ['플래티넘', '플래티넘'],
  ['플래', '플래티넘'],
  ['platinum', '플래티넘'],
  ['골드', '골드'],
  ['gold', '골드'],
  ['실버', '실버'],
  ['silver', '실버'],
  ['브론즈', '브론즈'],
  ['bronze', '브론즈'],
];

function detectRank(q) {
  const lower = q.toLowerCase();
  for (const [kw, rank] of RANK_KEYWORDS) {
    if (lower.includes(kw)) return rank;
  }
  return '전체';
}

// ── 영웅 감지 ─────────────────────────────────────────────────────────────────

function buildAliasIndex(heroesJson) {
  const index = [];
  for (const [id, info] of Object.entries(heroesJson?.heroes ?? {})) {
    for (const alias of info.aliases ?? []) {
      index.push({ alias: alias.toLowerCase(), id });
    }
  }
  // 긴 alias 우선 (오인식 방지)
  index.sort((a, b) => b.alias.length - a.alias.length);
  return index;
}

function detectHero(q, aliasIndex) {
  const lower = q.toLowerCase();
  for (const { alias, id } of aliasIndex) {
    if (lower.includes(alias)) return id;
  }
  return null;
}

// ── 시스템 프롬프트 빌더 ──────────────────────────────────────────────────────

function heroIdToName(heroId, heroesJson) {
  return heroesJson?.heroes?.[heroId]?.name ?? heroId;
}

function buildSystemPrompt(question, { meta, heroes, patches, stadium }) {
  const rank = detectRank(question);
  const aliasIndex = buildAliasIndex(heroes);
  const heroId = detectHero(question, aliasIndex);
  const isPatch = /패치|버프|너프|변경|업데이트/.test(question);
  const isStadium = /스타디움|stadium/i.test(question);
  const isBuild = isStadium || /빌드|장비|아이템/.test(question);

  // 본게임 메타 테이블 (스타디움 질문이면 생략)
  let metaSection = '';
  if (!isStadium) {
    const metaHeroes = (meta?.[rank] ?? meta?.['전체'] ?? []).slice(0, 15);
    const metaTable = metaHeroes.length
      ? metaHeroes.map(h =>
          `${h.hero_name}|${h.role === 'tank' ? '탱커' : h.role === 'damage' ? '딜러' : '지원가'}|${h.tier}티어|픽률${h.pick_rate?.toFixed(1)}%|승률${h.win_rate?.toFixed(1)}%|메타${h.meta_score?.toFixed(1)}`
        ).join('\n')
      : '데이터 없음';
    metaSection = `\n\n## 본게임 경쟁전 메타 — ${rank} 기준 (스타디움 모드와 무관)\n영웅|역할|티어|픽률|승률|메타점수\n${metaTable}`;
  }

  // 영웅 상세 (본게임 카운터·시너지 — 스타디움 질문이면 생략)
  let heroSection = '';
  if (heroId && !isStadium) {
    const h = heroes?.heroes?.[heroId];
    if (h) {
      const resolve = ids => ids.map(id => heroes?.heroes?.[id]?.aliases?.[0] ?? id).join(', ');
      heroSection = `\n\n## 영웅 상세 (본게임 기준) — ${h.aliases?.[0] ?? heroId}
역할: ${h.role === 'tank' ? '탱커' : h.role === 'damage' ? '딜러' : '지원가'}
카운터(이 영웅이 이기는 상대): ${resolve(h.counters ?? [])}
카운터당함(이 영웅이 지는 상대): ${resolve(h.countered_by ?? [])}
시너지(함께 쓰면 좋은 영웅): ${resolve(h.synergies ?? [])}
팁: ${(h.tips ?? []).slice(0, 3).join(' / ')}`;
    }
  }

  // 패치 섹션 (스타디움 패치 여부 구분)
  let patchSection = '';
  if (isPatch && patches?.length) {
    const recent = patches.slice(0, 2);
    patchSection = '\n\n## 최근 패치 변경사항\n' + recent.map(p => {
      const heroChanges = (p.hero_changes ?? [])
        .filter(hc => {
          if (heroId && hc.hero !== heroes?.heroes?.[heroId]?.aliases?.[0]) return false;
          if (isStadium) return hc.is_stadium === true;
          return true;
        })
        .slice(0, 5)
        .map(hc => `[${hc.hero}${hc.is_stadium ? ' · 스타디움' : ' · 본게임'}] ${hc.changes?.slice(0, 2).join(' / ')}`)
        .join('\n');
      return `${p.date ?? p.title}\n${heroChanges || '해당 변경사항 없음'}`;
    }).join('\n---\n');
  }

  // 스타디움 빌드 섹션
  let buildSection = '';
  if (isBuild) {
    if (heroId) {
      const enName = heroIdToName(heroId, heroes);
      const builds = (stadium?.[enName] ?? []).slice(0, 3);
      if (builds.length) {
        buildSection = `\n\n## 스타디움 인기 빌드 — ${heroes?.heroes?.[heroId]?.aliases?.[0] ?? heroId}\n` +
          builds.map((b, i) =>
            `${i + 1}. ${b.name} (코드: ${b.code}) | ${b.playstyle ?? ''} | 추천${b.upvotes}개`
          ).join('\n');
      }
    } else if (isStadium) {
      // 영웅 미지정 스타디움 질문: 빌드 많은 상위 5개 영웅 소개
      const topHeroes = Object.entries(stadium ?? {})
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .map(([hero, builds]) => `${hero}: 빌드 ${builds.length}개 (인기순위 ${builds[0]?.upvotes ?? 0}추천)`);
      if (topHeroes.length) {
        buildSection = `\n\n## 스타디움 빌드 현황 (빌드 수 기준 상위 영웅)\n${topHeroes.join('\n')}`;
      }
    }
  }

  const modeNote = isStadium
    ? '⚠ 스타디움 모드는 본게임과 밸런스가 완전히 다릅니다. 본게임 픽률·승률·메타점수는 스타디움에 적용되지 않습니다.'
    : '⚠ 아래 메타 데이터는 본게임 경쟁전 기준입니다. 스타디움 모드에는 적용되지 않습니다.';

  return `당신은 오버워치 2 전문가 AI입니다. 본게임(경쟁전)과 스타디움 모드는 밸런스가 완전히 다른 별개의 게임 모드입니다.

## 핵심 구분
• 본게임(경쟁전): 픽률, 승률, 메타점수, 카운터, 시너지가 중요
• 스타디움 모드: 라운드 사이 아이템 구매, 영웅 강화, 빌드 코드로 공유 — 본게임 메타와 무관

## 답변 원칙
• ${modeNote}
• 제공된 수치를 직접 인용해 근거 있게 답변하세요
• 3~5문장으로 핵심만 간결하게 답하세요
• 영웅명·스킬명은 한국어 공식 표기 사용
• 데이터에 없는 내용은 일반 지식으로 보충하되 "참고로" 라고 명시하세요${metaSection}${heroSection}${patchSection}${buildSection}`;
}

// ── API 호출 ──────────────────────────────────────────────────────────────────

function updateLimitDisplay(remaining) {
  const el = document.getElementById('ow-chat-limit');
  if (!el) return;
  el.style.display = 'inline';
  el.textContent = `남은 질문 ${remaining}/${DAILY_LIMIT}회`;
  el.style.color = remaining <= 5 ? '#f87171' : '#9ca3af';
}

async function fetchRemainingCount() {
  try {
    const resp = await fetch(WORKER_URL, { method: 'GET' });
    const data = await resp.json();
    if (data.remaining !== null && data.remaining !== undefined) {
      updateLimitDisplay(data.remaining);
    }
  } catch { /* 무시 */ }
}

async function askAI(question, contextData) {
  const systemPrompt = buildSystemPrompt(question, contextData);
  const resp = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      temperature: 0.3,
      max_tokens: 600,
    }),
  });

  // 남은 횟수 헤더가 있으면 UI 업데이트 (KV 제한 활성화 시)
  const remainingHeader = resp.headers.get('X-Remaining-Count');
  if (remainingHeader !== null) {
    updateLimitDisplay(parseInt(remainingHeader));
  }

  if (resp.status === 429) {
    const errData = await resp.json().catch(() => ({}));
    if (errData.error === 'daily_limit_exceeded') {
      throw new Error('오늘 AI 질문 횟수(20회)가 모두 소진되었습니다. 내일 다시 이용해주세요.');
    }
    throw new Error(`API 오류: ${resp.status}`);
  }

  if (!resp.ok) throw new Error(`API 오류: ${resp.status}`);
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('응답 파싱 실패');
  return content;
}

// ── 데이터 로드 ───────────────────────────────────────────────────────────────

let _contextData = null;

async function getContextData() {
  if (_contextData) return _contextData;
  const [meta, heroes, patches, stadium] = await Promise.all([
    loadJSON('meta').catch(() => null),
    loadJSON('heroes').catch(() => null),
    loadJSON('patch').catch(() => null),
    loadJSON('stadium').catch(() => null),
  ]);
  _contextData = { meta, heroes, patches, stadium };
  return _contextData;
}

// ── UI ────────────────────────────────────────────────────────────────────────

let popupOpen = false;

export function mountChat() {
  // 중복 마운트 방지
  if (document.getElementById('ow-chat-root')) return;

  const root = document.createElement('div');
  root.id = 'ow-chat-root';
  root.innerHTML = `
    <button id="ow-chat-fab" aria-label="AI 전문가 챗봇 열기" title="OW2 AI 전문가">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>

    <div id="ow-chat-popup" class="ow-chat-popup hidden" role="dialog" aria-label="OW2 AI 전문가 챗봇">
      <div class="ow-chat-header">
        <span class="ow-chat-title">
          <span class="ow-chat-dot"></span>
          OW2 AI 전문가
        </span>
        <span id="ow-chat-limit" class="ow-chat-limit"></span>
        <button id="ow-chat-close" aria-label="닫기">✕</button>
      </div>
      <div id="ow-chat-messages" class="ow-chat-messages">
        <div class="ow-chat-bubble ow-chat-bubble-ai">
          안녕하세요! 오버워치 2 전문가 AI입니다.<br>
          랭크별 메타, 영웅 카운터, 스타디움 빌드, 패치 변경사항 등을 물어보세요.
          <div class="ow-chat-bubble-hint">예: "플래티넘에서 좋은 탱커 추천해줘"</div>
        </div>
      </div>
      <div class="ow-chat-input-row">
        <textarea id="ow-chat-input" class="ow-chat-input" placeholder="질문을 입력하세요..." rows="1" maxlength="400"></textarea>
        <button id="ow-chat-send" class="ow-chat-send" aria-label="전송">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const fab    = root.querySelector('#ow-chat-fab');
  const popup  = root.querySelector('#ow-chat-popup');
  const close  = root.querySelector('#ow-chat-close');
  const input  = root.querySelector('#ow-chat-input');
  const send   = root.querySelector('#ow-chat-send');
  const msgs   = root.querySelector('#ow-chat-messages');

  // 팝업 토글
  function openPopup() {
    popupOpen = true;
    popup.classList.remove('hidden');
    fab.classList.add('active');
    input.focus();
    msgs.scrollTop = msgs.scrollHeight;
    fetchRemainingCount();
  }
  function closePopup() {
    popupOpen = false;
    popup.classList.add('hidden');
    fab.classList.remove('active');
  }

  fab.addEventListener('click', () => popupOpen ? closePopup() : openPopup());
  close.addEventListener('click', closePopup);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && popupOpen) closePopup(); });

  // 텍스트에어리아 자동 높이
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });

  // 전송
  async function handleSend() {
    const q = input.value.trim();
    if (!q || send.disabled) return;

    // 사용자 말풍선
    appendBubble(msgs, 'user', escHtml(q));
    input.value = '';
    input.style.height = 'auto';
    send.disabled = true;
    send.classList.add('loading');

    // 로딩 말풍선
    const loadingEl = appendBubble(msgs, 'ai', '<span class="ow-chat-typing">⋯</span>');

    try {
      const contextData = await getContextData();
      const answer = await askAI(q, contextData);
      loadingEl.innerHTML = escHtml(answer).replace(/\n/g, '<br>');
    } catch (e) {
      loadingEl.innerHTML = `<span style="color:#f87171">오류가 발생했습니다: ${escHtml(e.message)}</span>`;
    } finally {
      send.disabled = false;
      send.classList.remove('loading');
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  send.addEventListener('click', handleSend);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // WORKER_URL 미설정 경고
  if (WORKER_URL.includes('YOUR_WORKER')) {
    setTimeout(() => {
      if (!document.querySelector('.ow-chat-worker-warn')) {
        const warn = document.createElement('div');
        warn.className = 'ow-chat-worker-warn';
        warn.textContent = '⚠ cloudflare-worker/worker.js를 배포하고 chat.js의 WORKER_URL을 설정해주세요.';
        root.appendChild(warn);
      }
    }, 500);
  }
}

function appendBubble(container, type, html) {
  const el = document.createElement('div');
  el.className = `ow-chat-bubble ow-chat-bubble-${type}`;
  el.innerHTML = html;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
