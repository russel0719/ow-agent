# 프론트엔드

## 구조

```
public/
├── index.html       # 진입점 (Tailwind CDN, Chart.js CDN)
├── app.js           # SPA 라우터 + loadJSON 유틸
├── style.css        # 다크 테마 커스텀 CSS
└── views/
    ├── meta.js      # 메타 통계 + 90일 히스토리 차트 + 패치 세로선
    ├── stadium.js   # 스타디움 빌드 카드
    ├── patch.js     # 패치노트 뷰
    └── chat.js      # AI 챗봇 (플로팅 FAB + 팝업)
```

## 라우팅 (`public/app.js`)

Hash 기반 SPA 라우터. URL 해시(`#meta`, `#stadium`, `#patch`)에 따라 뷰 마운트.

```javascript
// 데이터 로드 (캐시 포함)
const data = await loadJSON('meta');   // public/data/meta.json

// 뷰 전환
navigateTo('#stadium');
```

`loadJSON(name)`:
- `public/data/{name}.json` fetch
- 모듈 내 메모리 캐시 (`cache` 객체)로 중복 요청 방지
- `?v=Date.now()` 쿼리로 브라우저 캐시 무력화

## 뷰 컴포넌트

### `views/meta.js`
- 랭크별 영웅 픽률·승률·티어 테이블
- Chart.js로 90일 히스토리 라인차트 렌더링
- 티어 필터, 역할군 필터 (탱커/딜러/지원가)
- **패치 날짜 세로선**: `patch.json` 로드 후 `makePatchLinePlugin(dates)`로 Chart.js 커스텀 플러그인 생성
  - 패치 날짜와 다음 날 사이 중간에 주황 점선 + "PATCH" 레이블 표시
  - 랭크별·영웅별·맵별 차트 4종 모두 적용

### `views/stadium.js`
- 역할군별 영웅 카드 레이아웃
- 빌드 코드 클릭 → 클립보드 복사
- 스탯 바 시각화 (기술 위력, 무기 공격력 등)

### `views/patch.js`
- 영웅별·공통 변경사항 아코디언
- 스타디움/본게임 뱃지 구분
- `translation_source` 필드는 UI에 별도 표시 없음 (내부 관리용)

### `views/chat.js`
- 플로팅 버튼(FAB) + 팝업 챗봇 UI
- `buildSystemPrompt()` — 질문에서 랭크·영웅 감지 후 컨텍스트 주입
- `askAI()` — Cloudflare Worker로 POST, `X-Remaining-Count` 헤더 읽어 횟수 UI 업데이트
- `fetchRemainingCount()` — 팝업 열 때 Worker GET으로 현재 남은 횟수 즉시 조회
- `updateLimitDisplay(remaining)` — 헤더에 "남은 질문 N/20회" 표시 (5회 이하 시 빨간색)

## 로컬 개발

```bash
python -m http.server 8080 --directory public
# http://localhost:8080
```

ES Modules(`import/export`) 사용으로 반드시 HTTP 서버 필요 (파일 직접 열기 불가).

챗봇은 실제 Cloudflare Worker URL(`WORKER_URL`)을 사용하므로 로컬에서도 그대로 동작.
KV 제한은 Worker에 바인딩 설정 전까지 비활성화 상태로 동작.

## 색상 팔레트 (다크 테마)

| 용도 | 색상 |
|------|------|
| 배경 | `#0D1117` |
| 카드 | `#161B22` |
| 테두리 | `#30363D` |
| 강조 (주황) | `#F5A623` |
| 텍스트 | `#E5E7EB` |
| 위험 (빨강) | `#f87171` |
