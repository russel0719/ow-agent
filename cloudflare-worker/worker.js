/**
 * Cloudflare Worker - NVIDIA API 프록시 + 전체 일일 요청 제한
 *
 * 배포 방법:
 *   1. https://workers.cloudflare.com/ 에서 새 Worker 생성
 *   2. 이 파일 내용을 Worker 에디터에 붙여넣기
 *   3. Settings → Variables → NVIDIA_API_KEY 환경변수 추가
 *   4. 배포 후 Worker URL을 docs/views/chat.js 의 WORKER_URL 상수에 설정
 *
 * 전체 일일 20회 제한 활성화 방법 (선택):
 *   1. Workers & Pages → KV → 네임스페이스 만들기 (이름: OW_CHAT_KV)
 *   2. 해당 Worker → 설정 → 바인딩 → KV 네임스페이스 추가
 *      변수명: CHAT_KV / 네임스페이스: OW_CHAT_KV
 *   3. Worker 저장 후 재배포
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'X-Remaining-Count',
};

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DAILY_LIMIT = 20;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // GET: 현재 남은 횟수 조회 (팝업 초기화용)
    if (request.method === 'GET') {
      if (!env.CHAT_KV) {
        return new Response(JSON.stringify({ remaining: null }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      const today = new Date().toISOString().slice(0, 10);
      const current = parseInt(await env.CHAT_KV.get(`ow:chat:${today}`) || '0');
      const remaining = Math.max(0, DAILY_LIMIT - current);
      return new Response(JSON.stringify({ remaining }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'X-Remaining-Count': String(remaining) },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const { messages, max_tokens = 512, temperature = 0.3 } = body;
    if (!messages || !Array.isArray(messages)) {
      return new Response('messages 필드가 필요합니다', { status: 400 });
    }

    const apiKey = env.NVIDIA_API_KEY;
    if (!apiKey) {
      return new Response('NVIDIA_API_KEY 환경변수가 설정되지 않았습니다', { status: 500 });
    }

    // KV 기반 전체 일일 제한 (CHAT_KV 바인딩이 설정된 경우에만 동작)
    let remaining = null;
    if (env.CHAT_KV) {
      const today = new Date().toISOString().slice(0, 10);
      const key = `ow:chat:${today}`;
      const current = parseInt(await env.CHAT_KV.get(key) || '0');

      if (current >= DAILY_LIMIT) {
        return new Response(
          JSON.stringify({ error: 'daily_limit_exceeded', remaining: 0 }),
          { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      // TTL 90000초 (25시간) — 날짜가 넘어가면 자동 만료
      await env.CHAT_KV.put(key, String(current + 1), { expirationTtl: 90000 });
      remaining = DAILY_LIMIT - current - 1;
    }

    try {
      const resp = await fetch(NVIDIA_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'moonshotai/kimi-k2-instruct',
          messages,
          temperature,
          max_tokens,
        }),
      });

      const data = await resp.json();
      const responseHeaders = { ...CORS_HEADERS, 'Content-Type': 'application/json' };
      if (remaining !== null) {
        responseHeaders['X-Remaining-Count'] = String(remaining);
      }
      return new Response(JSON.stringify(data), {
        status: resp.status,
        headers: responseHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};
