export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export function ok(data, meta = {}) {
  return json({ success: true, data, meta }, 200);
}

export function badRequest(code, message) {
  return json({ success: false, error: { code, message } }, 400);
}

export function notFound(code, message) {
  return json({ success: false, error: { code, message } }, 404);
}

export function methodNotAllowed() {
  return json({ success: false, error: { code: 'method_not_allowed', message: 'GET만 지원합니다.' } }, 405);
}

export function upstreamError(message) {
  return json({ success: false, error: { code: 'upstream_unavailable', message } }, 502);
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
