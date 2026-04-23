/**
 * Cloudflare Worker - NVIDIA API 프록시
 *
 * 배포 방법:
 *   1. https://workers.cloudflare.com/ 에서 새 Worker 생성
 *   2. 이 파일 내용을 Worker 에디터에 붙여넣기
 *   3. Settings → Variables → NVIDIA_API_KEY 환경변수 추가
 *   4. 배포 후 Worker URL을 docs/views/chat.js 의 WORKER_URL 상수에 설정
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
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
      return new Response(JSON.stringify(data), {
        status: resp.status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};
