// 데이터 소스 추상화.
//   - 정적 lookup(heroes/maps): GitHub Pages (repo 유지 파일)
//   - 매일 갱신 데이터: Supabase(ow_agent) — datasets(blob) + 정규화 히스토리
// SUPABASE_URL / SUPABASE_ANON_KEY 는 wrangler 환경변수(env)로 주입한다.

const GITHUB_BASE = 'https://russel0719.github.io/ow-agent/data';
const TTL_SECONDS = 300;
const SCHEMA = 'ow_agent';

// repo(GitHub Pages)에서 서빙하는 정적 데이터. 그 외는 Supabase datasets(blob).
const REPO_DATASETS = new Set(['heroes', 'maps']);

export class UpstreamError extends Error {}

async function fetchGithub(name) {
  const res = await fetch(`${GITHUB_BASE}/${name}.json`, {
    cf: { cacheTtl: TTL_SECONDS, cacheEverything: true },
  });
  if (!res.ok) {
    throw new UpstreamError(`GitHub Pages fetch 실패: ${name}.json (${res.status})`);
  }
  return res.json();
}

function supabaseHeaders(env) {
  const key = env && env.SUPABASE_ANON_KEY;
  if (!env || !env.SUPABASE_URL || !key) {
    throw new UpstreamError('SUPABASE_URL / SUPABASE_ANON_KEY 미설정 (wrangler 환경변수 확인)');
  }
  return { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': SCHEMA };
}

// ow_agent 스키마 테이블 조회 (히스토리 라우트가 정규화 테이블을 직접 쿼리할 때 사용).
export async function supabaseSelect(env, table, search) {
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/rest/v1/${table}?${search}`, {
    headers: supabaseHeaders(env),
    cf: { cacheTtl: TTL_SECONDS, cacheEverything: true },
  });
  if (!res.ok) {
    throw new UpstreamError(`Supabase fetch 실패: ${table} (${res.status})`);
  }
  return res.json();
}

async function fetchSupabaseDataset(name, env) {
  const rows = await supabaseSelect(
    env,
    'datasets',
    `name=eq.${encodeURIComponent(name)}&select=data`,
  );
  if (!rows.length) {
    throw new UpstreamError(`Supabase 데이터 없음: datasets['${name}']`);
  }
  return rows[0].data;
}

export async function getDataset(name, ctx, env) {
  const cache = caches.default;
  const cacheKey = new Request(`${GITHUB_BASE}/${name}.json`);
  let res = await cache.match(cacheKey);

  if (!res) {
    const data = REPO_DATASETS.has(name)
      ? await fetchGithub(name)
      : await fetchSupabaseDataset(name, env);
    res = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${TTL_SECONDS}`,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }

  return res.json();
}
