# 챗봇 / Cloudflare Worker

## 구조

```
[브라우저 chat.js]
    │
    ├─ GET (팝업 열 때) → 현재 남은 횟수 조회
    │
    └─ POST (질문 + 시스템 프롬프트)
        ▼
Cloudflare Worker (worker.js)
    ├── Origin 검증: ALLOWED_ORIGINS 외 → 403
    ├── GET 핸들러: KV에서 오늘 카운트 읽어 remaining 반환
    ├── POST 핸들러:
    │   ├── KV 미바인딩 → 503 (fail-closed, 비용 보호)
    │   ├── 입력 검증: messages 총 8000자 초과 → 400 / max_tokens 상한 1024
    │   ├── body.cache === true → KV 응답 캐시 조회 (적중 시 쿼터 미소모 즉시 반환)
    │   ├── KV: IP별 일일 횟수 확인 (기본 5회) → 초과 시 429
    │   ├── KV: 전체 일일 횟수 확인 (기본 20회) → 초과 시 429
    │   └── NVIDIA API → Llama 3.3 70B Instruct
    │       응답 + X-Remaining-Count 헤더 (cache 요청은 KV에 25시간 저장)
    ▼
[브라우저: 남은 횟수 UI 업데이트]
```

## Cloudflare Worker 배포

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → 새 Worker 생성
2. `cloudflare-worker/worker.js` 내용 붙여넣기 후 배포
3. **Settings → Variables** → `NVIDIA_API_KEY` 추가
4. `public/app.js`의 `WORKER_URL` 상수를 배포된 Worker URL로 변경 (`chat.js`와 `home.js`가 공유)

## KV 기반 일일 제한 설정

**KV 바인딩은 필수** — 미바인딩 시 POST가 503으로 차단된다 (fail-closed, NVIDIA 키 비용 보호).

1. **Workers & Pages → KV** → 네임스페이스 만들기 (이름: `OW_CHAT_KV`)
2. 해당 Worker → **설정 → 바인딩** → KV 네임스페이스 추가
   - 변수명: `CHAT_KV`
   - 네임스페이스: `OW_CHAT_KV`
3. Worker 저장 후 재배포

KV 키 형식 (TTL 90000초 = 25시간, 자정 이후 자동 만료):
- 전체 카운터: `ow:chat:YYYY-MM-DD` (기본 20회/일)
- IP별 카운터: `ow:chat:ip:YYYY-MM-DD:<ip>` (기본 5회/일, `CF-Connecting-IP` 기준)
- 응답 캐시: `ow:cache:<요청 body의 SHA-256>` — `body.cache === true`인 요청만
  (홈 AI 요약: 모든 사용자에게 동일한 요청이라 하루 1회만 NVIDIA 호출.
  챗봇 대화는 캐시하지 않으므로 서버에 대화가 저장되지 않음)

허용 origin은 `worker.js` 상단 `ALLOWED_ORIGINS` 상수로 관리 — 커스텀 도메인 연결 시 추가 후 재배포.

## 환경변수 / 바인딩

| 항목 | 종류 | 설명 |
|------|------|------|
| `NVIDIA_API_KEY` | Variables | NVIDIA API 키 (필수) |
| `CHAT_KV` | KV 바인딩 | 일일 횟수 카운터 (필수 — 없으면 챗봇 비활성) |
| `DAILY_LIMIT` | Variables | 전체 일일 한도 (선택, 기본 20) |
| `IP_DAILY_LIMIT` | Variables | IP별 일일 한도 (선택, 기본 5) |

## API 엔드포인트

### GET / — 남은 횟수 조회

```json
// KV 활성화 시
{ "remaining": 17 }

// KV 미설정 시
{ "remaining": null }
```

팝업을 열 때 `fetchRemainingCount()`가 호출하며, `remaining !== null`이면 헤더에 표시.

### POST / — 챗봇 질문

요청:
```json
{
  "messages": [{ "role": "system", "content": "..." }, { "role": "user", "content": "질문" }],
  "temperature": 0.3,
  "max_tokens": 600
}
```

응답 헤더:
| 헤더 | 설명 |
|------|------|
| `X-Remaining-Count` | 이번 요청 후 남은 횟수 (KV 활성화 시) |
| `Access-Control-Expose-Headers` | `X-Remaining-Count` 포함 (브라우저에서 읽기 가능) |

## 오류 응답

| 상태 | body | 프론트엔드 메시지 |
|------|------|------------------|
| 429 | `{ "error": "ip_daily_limit_exceeded", "remaining": 0 }` | "오늘 이 네트워크에서 사용할 수 있는 AI 질문 횟수를 모두 사용했습니다..." |
| 429 | `{ "error": "daily_limit_exceeded", "remaining": 0 }` | "오늘 AI 질문 횟수(20회)가 모두 소진되었습니다..." |
| 503 | `{ "error": "rate_limit_unavailable" }` | "AI 챗봇이 일시적으로 비활성화되어 있습니다..." (KV 미바인딩) |
| 403 | `Forbidden` | 허용되지 않은 origin |
| 400 | `{ "error": "input_too_large" }` | messages 총 8000자 초과 |

## 시스템 프롬프트 구성 (`chat.js` `buildSystemPrompt()`)

질문 분석:
- `detectRank(q)` — 랭크 키워드 감지 (챔피언, 그마, 다이아 등)
- `detectHero(q, aliasIndex)` — `heroes.json`의 aliases 기반 영웅 감지

주입 컨텍스트 (질문 내용에 따라 조합):
- 본게임 메타 테이블 (상위 15영웅, 랭크별)
- 영웅 상세 (카운터, 시너지, 팁)
- 최근 2개 패치 변경사항
- 스타디움 빌드 목록
