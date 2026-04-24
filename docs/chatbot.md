# 챗봇 / Cloudflare Worker

## 구조

```
[브라우저 chat.js]
    │ POST (질문 + 시스템 프롬프트)
    ▼
Cloudflare Worker (worker.js)
    ├── KV: 오늘 전체 사용 횟수 확인
    │   ├── 20회 초과 → 429 반환
    │   └── 미만 → 카운터 증가
    └── NVIDIA API → Kimi K2 Instruct
        │ 응답 + X-Remaining-Count 헤더
        ▼
[브라우저: 남은 횟수 표시 업데이트]
```

## Cloudflare Worker 배포

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → 새 Worker 생성
2. `cloudflare-worker/worker.js` 내용 붙여넣기 후 배포
3. **Settings → Variables** → `NVIDIA_API_KEY` 추가
4. `public/views/chat.js` 상단의 `WORKER_URL` 상수를 배포된 Worker URL로 변경

## KV 기반 일일 20회 제한 설정

KV 바인딩 없으면 제한 없이 동작. 제한 활성화:

1. **Workers & Pages → KV** → 네임스페이스 만들기 (이름: `OW_CHAT_KV`)
2. 해당 Worker → **설정 → 바인딩** → KV 네임스페이스 추가
   - 변수명: `CHAT_KV`
   - 네임스페이스: `OW_CHAT_KV`
3. Worker 저장 후 재배포

KV 키 형식: `ow:chat:YYYY-MM-DD` / TTL: 90000초(25시간)

## 환경변수

| 변수 | 위치 | 설명 |
|------|------|------|
| `NVIDIA_API_KEY` | Worker → Settings → Variables | Kimi K2 API 키 |
| `CHAT_KV` | Worker → Settings → 바인딩 | KV 네임스페이스 (선택) |

## 시스템 프롬프트 구성 (`chat.js` `buildSystemPrompt()`)

질문 분석:
- `detectRank(q)` — 랭크 키워드 감지 (챔피언, 그마, 다이아 등)
- `detectHero(q, aliasIndex)` — `heroes.json`의 aliases 기반 영웅 감지

주입 컨텍스트 (질문 내용에 따라 조합):
- 본게임 메타 테이블 (상위 15영웅, 랭크별)
- 영웅 상세 (카운터, 시너지, 팁)
- 최근 2개 패치 변경사항
- 스타디움 빌드 목록

## API 응답 헤더

| 헤더 | 설명 |
|------|------|
| `X-Remaining-Count` | 오늘 남은 질문 횟수 (KV 활성화 시) |

## 제한 초과 응답 (429)

```json
{ "error": "daily_limit_exceeded", "remaining": 0 }
```

프론트엔드에서 "오늘 AI 질문 횟수(20회)가 모두 소진되었습니다." 메시지 표시.
