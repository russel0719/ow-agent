# 외부 공개 API (Cloudflare Worker)

`public/data/*.json`은 GitHub Pages로 이미 공개되어 있지만 통짜 파일 다운로드일 뿐 쿼리·필터링·문서화된 엔드포인트가 없다. `cloudflare-worker-api/`는 그 위에 조회 가능한 REST 레이어를 추가하는, 챗봇 프록시(`cloudflare-worker/`)와는 완전히 분리된 별도 Worker다.

## 구조

```
[외부 소비자]
    │ GET /v1/...
    ▼
Cloudflare Worker (ow-agent-api)
    ├── 계층 1 캐시: GitHub Pages 원본 JSON 통째로 (Cache API, 5분)
    ├── 계층 2 캐시: 조합된 응답 자체 (요청 URL 기준, Cache API, 5분)
    └── pathname 라우터 → public/data/*.json 필터링/재구성
            │
            ▼
GitHub Pages (public/data/*.json, 매일 15:00 KST 갱신)
```

프론트엔드(`public/views/*.js`)는 이 API를 쓰지 않고 GitHub Pages의 JSON을 그대로 직접 fetch한다 — 이 API는 제3자 외부 소비자 전용이다.

**배포 URL**: `https://ow-agent-api.russel0719.workers.dev`

## 배포 (자동)

`cloudflare-worker-api/**` 경로에 변경이 생겨 `main`에 push되면 `.github/workflows/deploy-api-worker.yml`이 자동으로 `wrangler deploy`를 실행한다 (`cloudflare/wrangler-action@v3`). 수동 트리거도 가능(Actions 탭 → **Deploy API Worker** → **Run workflow**).

사전 설정(최초 1회 필요): GitHub 저장소 **Settings → Secrets and variables → Actions**에 `CLOUDFLARE_API_TOKEN` 등록 (Cloudflare 대시보드 → My Profile → API Tokens → "Edit Cloudflare Workers" 템플릿으로 생성, 이 계정/이 Worker에 한정된 토큰 사용 권장). `account_id`는 `wrangler.toml`에 고정값으로 명시되어 있어 별도 시크릿 불필요.

## 배포 (로컬/수동)

```bash
cd cloudflare-worker-api
npm install
npx wrangler login   # 최초 1회, 챗봇 워커와 동일한 Cloudflare 계정
npm run deploy         # → https://ow-agent-api.russel0719.workers.dev
```

로컬 개발: `npm run dev` (wrangler dev, `http://localhost:8787`). 로컬에서도 실제 GitHub Pages로 fetch가 나가므로 별도 mock 없이 실데이터로 검증된다.

## 공통 응답 규약

```json
// 성공
{ "success": true, "data": ..., "meta": { "rank": "...", "count": 3 } }

// 실패
{ "success": false, "error": { "code": "hero_not_found", "message": "..." } }
```

| 상태 코드 | 의미 |
|---|---|
| 200 | 정상 |
| 400 | 쿼리 파라미터 오류 (`invalid_role`, `invalid_limit`, `invalid_date_range`) |
| 404 | 경로상 리소스 없음 (`hero_not_found`, `rank_not_found`, `map_not_found`, `not_found`) |
| 405 | GET/OPTIONS 이외 메서드 (`method_not_allowed`) |
| 502 | GitHub Pages 원본 fetch 실패 (`upstream_unavailable`) |

CORS: `Access-Control-Allow-Origin: *` 완전 오픈 (챗봇 워커와 동일).

## 랭크 / 역할 값

- `rank`: `all`(기본값) `bronze` `silver` `gold` `platinum` `diamond` `master` `grandmaster` `champion` — 또는 한국어 원문(`전체`, `다이아몬드` 등)도 그대로 허용.
- `role`: `tank` `damage` `support`

## 엔드포인트 레퍼런스

### `GET /v1/health`
데이터 최신성 확인용.
```bash
curl "https://ow-agent-api.russel0719.workers.dev/v1/health"
```
```json
{ "success": true, "data": { "status": "ok", "worker": "ow-agent-api", "version": "v1",
  "data_last_updated": "2026-05-31T08:36:20Z", "sources": {"meta":"live", ...}, "has_ban_rate": true } }
```

### `GET /v1/heroes?role=`
영웅 목록 (`heroes.json` 기반). `role` 필터 선택.
```bash
curl "https://ow-agent-api.russel0719.workers.dev/v1/heroes?role=support"
```

### `GET /v1/heroes/:heroId`
영웅 상세 (카운터/시너지/팁 포함). 404: `hero_not_found`.

### `GET /v1/roles`
역할군별 설명 + 소속 영웅 id 목록 (`heroes.json.roles` 그대로).

### `GET /v1/meta?rank=&role=`
해당 랭크의 영웅별 픽률·승률·밴률·통합 메타 점수·티어·존재감·밴 효율 배열.
```bash
curl "https://ow-agent-api.russel0719.workers.dev/v1/meta?rank=diamond&role=tank"
```

### `GET /v1/meta/:heroId?rank=`
특정 영웅의 해당 랭크 메타 지표 단건.
```bash
curl "https://ow-agent-api.russel0719.workers.dev/v1/meta/ana?rank=grandmaster"
```

### `GET /v1/meta/history/:heroId?rank=&from=&to=`
영웅의 90일 rolling 시계열(`meta_history.json`). `from`/`to`는 `YYYY-MM-DD`. `champion` 랭크는 히스토리에 없음(그랜드마스터와 동일해 미저장) → `rank_not_found`.
```bash
curl "https://ow-agent-api.russel0719.workers.dev/v1/meta/history/ana?rank=all&from=2026-04-01&to=2026-05-01"
```

### `GET /v1/patch?limit=`
패치노트 목록(최신순). `limit`은 양의 정수.

### `GET /v1/patch/latest`
가장 최근 패치노트 1건.

### `GET /v1/stadium`
영웅별 스타디움 빌드 개수 요약 (`hero_id` 기준으로 정규화 — 원본 `stadium.json`의 키는 영문 표시명이라 `heroes.json`으로 역매핑).

### `GET /v1/stadium/:heroId?limit=`
특정 영웅의 스타디움 빌드 목록, 추천수(upvotes) 내림차순. `limit`으로 상위 N개만.

### `GET /v1/maps`
맵 목록과 각 맵의 메타 점수 상위 3영웅 요약.

### `GET /v1/maps/:mapId?role=`
특정 맵의 영웅별 메타 배열 (`map_meta.json`). `map_id`는 `public/data/map_meta.json`의 키(예: `busan`, `antarctic-peninsula`).

### `GET /v1/maps/:mapId/history?from=&to=`
맵의 14일 히스토리 (`map_meta_history.json`).

## 캐싱 정책

원본 데이터는 하루 1회(15:00 KST)만 갱신되지만, 배포 직후 디버깅 편의를 위해 TTL은 **5분**으로 설정했다. 즉 API 응답은 원본 대비 최대 5분 지연될 수 있다.

## 레이트리밋 / 인증

인증 없음, 코드 레벨 레이트리밋도 없음 — 데이터가 이미 전량 공개된 정적 파일이라 접근 제어 실익이 없고, Cache API가 원본 요청 대부분을 흡수하며 Cloudflare Workers Free 플랜(일 100,000 요청)과 기본 DDoS 완화로 충분하다고 판단했다. 향후 남용 징후가 보이면 챗봇 워커(`cloudflare-worker/worker.js`)의 `CHAT_KV` 카운터 패턴(IP 기준 KV 카운터)을 재사용해 확장할 수 있다.
