/**
 * Cloudflare Worker - NVIDIA API 프록시 + 요청 제한 (비용 보호)
 *
 * 배포 방법:
 *   1. https://workers.cloudflare.com/ 에서 새 Worker 생성
 *   2. 이 파일 내용을 Worker 에디터에 붙여넣기
 *   3. Settings → Variables → NVIDIA_API_KEY 환경변수 추가
 *   4. 배포 후 Worker URL을 public/app.js 의 WORKER_URL 상수에 설정
 *
 * 요청 제한 (KV 필수 — 미바인딩 시 POST는 503으로 차단됨):
 *   1. Workers & Pages → KV → 네임스페이스 만들기 (이름: OW_CHAT_KV)
 *   2. 해당 Worker → 설정 → 바인딩 → KV 네임스페이스 추가
 *      변수명: CHAT_KV / 네임스페이스: OW_CHAT_KV
 *   3. Worker 저장 후 재배포
 *
 * 선택 환경변수: DAILY_LIMIT (기본 20, 전체), IP_DAILY_LIMIT (기본 5, IP별)
 */

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_DAILY_LIMIT = 20;      // 전체 사용자 합산 일일 한도
const DEFAULT_IP_DAILY_LIMIT = 5;    // IP별 일일 한도
const MAX_TOKENS_CAP = 1024;         // 응답 토큰 서버측 상한
const MAX_INPUT_CHARS = 8000;        // messages 총 문자수 상한 (입력 토큰 비용 보호)

// 허용 origin 외의 브라우저 요청은 차단 (Origin은 위조 가능하므로 IP 제한과 병행)
const ALLOWED_ORIGINS = [
  'https://russel0719.github.io',
  // 'https://<커스텀 도메인>',  // 커스텀 도메인 연결 후 주석 해제
  'http://localhost:8080',        // 로컬 개발용
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'X-Remaining-Count',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }
    const CORS = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const dailyLimit = parseInt(env.DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
    const ipDailyLimit = parseInt(env.IP_DAILY_LIMIT) || DEFAULT_IP_DAILY_LIMIT;
    const today = new Date().toISOString().slice(0, 10);

    // GET: 현재 남은 횟수 조회 (팝업 초기화용)
    if (request.method === 'GET') {
      if (!env.CHAT_KV) {
        return json({ remaining: null }, 200, CORS);
      }
      const current = parseInt(await env.CHAT_KV.get(`ow:chat:${today}`) || '0');
      const remaining = Math.max(0, dailyLimit - current);
      return json({ remaining }, 200, { ...CORS, 'X-Remaining-Count': String(remaining) });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    // fail-closed: 제한 장치 없이는 NVIDIA 키를 태우지 않는다
    if (!env.CHAT_KV) {
      return json({ error: 'rate_limit_unavailable' }, 503, CORS);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: CORS });
    }

    const { messages, temperature = 0.3 } = body;
    if (!messages || !Array.isArray(messages)) {
      return new Response('messages 필드가 필요합니다', { status: 400, headers: CORS });
    }

    // 입력 크기 상한 (입력 토큰 비용 보호)
    const totalChars = messages.reduce(
      (sum, m) => sum + (typeof m?.content === 'string' ? m.content.length : 0), 0
    );
    if (totalChars > MAX_INPUT_CHARS) {
      return json({ error: 'input_too_large' }, 400, CORS);
    }

    // 응답 토큰 서버측 상한 (클라이언트 값은 참고만)
    const maxTokens = Math.min(Math.max(parseInt(body.max_tokens) || 512, 1), MAX_TOKENS_CAP);

    const apiKey = env.NVIDIA_API_KEY;
    if (!apiKey) {
      return new Response('NVIDIA_API_KEY 환경변수가 설정되지 않았습니다', { status: 500, headers: CORS });
    }

    // opt-in 응답 캐시 (body.cache === true인 요청만 — 홈 AI 요약처럼 모든 사용자에게
    // 동일한 요청. 캐시 적중 시 NVIDIA 호출·쿼터 소모 없음. 챗봇 대화는 캐시하지 않음)
    const cacheable = body.cache === true;
    let cacheKey = null;
    if (cacheable) {
      const hash = await sha256(JSON.stringify({ messages, maxTokens, temperature }));
      cacheKey = `ow:cache:${hash}`;
      const cached = await env.CHAT_KV.get(cacheKey);
      if (cached) {
        return json(JSON.parse(cached), 200, CORS);
      }
    }

    // KV 카운터는 eventual consistency라 근사치 — 비용 보호 목적으로는 충분
    // TTL 90000초 (25시간) — 날짜가 넘어가면 자동 만료
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipKey = `ow:chat:ip:${today}:${ip}`;
    const ipCurrent = parseInt(await env.CHAT_KV.get(ipKey) || '0');
    if (ipCurrent >= ipDailyLimit) {
      return json({ error: 'ip_daily_limit_exceeded', remaining: 0 }, 429, CORS);
    }

    const globalKey = `ow:chat:${today}`;
    const current = parseInt(await env.CHAT_KV.get(globalKey) || '0');
    if (current >= dailyLimit) {
      return json({ error: 'daily_limit_exceeded', remaining: 0 }, 429, CORS);
    }

    await env.CHAT_KV.put(ipKey, String(ipCurrent + 1), { expirationTtl: 90000 });
    await env.CHAT_KV.put(globalKey, String(current + 1), { expirationTtl: 90000 });
    const remaining = dailyLimit - current - 1;

    try {
      const resp = await fetch(NVIDIA_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'meta/llama-3.3-70b-instruct',
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      const data = await resp.json();
      if (cacheable && resp.ok) {
        await env.CHAT_KV.put(cacheKey, JSON.stringify(data), { expirationTtl: 90000 });
      }
      return json(data, resp.status, { ...CORS, 'X-Remaining-Count': String(remaining) });
    } catch (e) {
      return json({ error: e.message }, 502, CORS);
    }
  },
};
