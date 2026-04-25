# 프론트엔드

## 구조

```
public/
├── index.html       # 진입점 (Tailwind CDN, Chart.js CDN)
├── app.js           # SPA 라우터 + loadJSON + WORKER_URL export
├── style.css        # 다크 테마 커스텀 CSS
└── views/
    ├── home.js      # 홈 대시보드 (AI 요약, 꿀/똥 영웅 TOP3, 초상화 버블 차트)
    ├── meta.js      # 메타 통계 + 90일 히스토리 차트 + 패치 세로선
    ├── stadium.js   # 스타디움 빌드 카드
    ├── patch.js     # 패치노트 뷰
    └── chat.js      # AI 챗봇 (플로팅 FAB + 팝업)
```

## 라우팅 (`public/app.js`)

Hash 기반 SPA 라우터. URL 해시(`#home`, `#meta`, `#stadium`, `#patch`)에 따라 뷰 마운트. 기본 진입점은 `#home`.

```javascript
// 데이터 로드 (캐시 포함)
const data = await loadJSON('meta');   // public/data/meta.json
```

`loadJSON(name)`:
- `public/data/{name}.json` fetch
- 모듈 내 메모리 캐시 (`cache` 객체)로 중복 요청 방지
- `?v=Date.now()` 쿼리로 브라우저 캐시 무력화

`WORKER_URL` (export):
- Cloudflare Worker URL을 `app.js`에서 export하여 `home.js`·`chat.js`가 공유
- `import { WORKER_URL } from '../app.js'`

`getPortraitIndex()` (export):
- `meta.json`에서 `hero_id → portrait_url` 인덱스 빌드 (최초 1회, 이후 캐시)
- `stadium.js`, `patch.js`, `home.js`에서 초상화 표시에 재사용

## 뷰 컴포넌트

### `views/home.js`
진입 시 첫 화면. 세 섹션으로 구성:

**AI 주간 메타 요약**
- 상승·하락 TOP5, 현재 S/A 티어, 최근 패치 요약을 컨텍스트로 구성해 Cloudflare Worker(Kimi K2)에 요청
- 결과를 `sessionStorage['ow2-summary-{latestDate}']`에 캐시 → 같은 탭 재방문 시 재호출 없음
- 헤더에 "N월 D일 데이터 기준" 표시

**이번주 꿀/똥 영웅 TOP3**
- `meta_history.json['전체']` 기준 7일 델타 계산
- 상승 TOP3 / 하락 TOP3 카드 (초상화 + 역할 테두리 + 티어 배지 + delta 색상)

**메타 맵 — 초상화 버블 차트**
- X축: 픽률, Y축: 승률, 버블 크기: 메타 점수
- 기본 버블 대신 **영웅 초상화**를 원형으로 잘라 표시 (`preloadPortraits()` 비동기 선로드)
- 역할별 테두리 색상 (탱커=파랑, 딜러=빨강, 지원가=초록)
- S/A 티어 영웅 우상단에 배지 (S=노란, A=주황)
- 기준선: 승률 50% 수평선 + 평균 픽률 수직선 + 사분면 레이블

### `views/meta.js`
- 랭크별·맵별 영웅 픽률·승률·티어 카드/테이블
- Chart.js로 90일 히스토리 라인차트 렌더링
- 티어 필터, 역할군 필터 (탱커/딜러/지원가)
- 영웅 클릭 → 패치 이력 상세 패널 (스타디움 빌드 섹션 제거됨)
- **패치 날짜 세로선**: `patch.json` 로드 후 `makePatchLinePlugin(dates)`로 Chart.js 커스텀 플러그인 생성

### `views/stadium.js`
- 역할군별 영웅 카드 레이아웃
- 빌드 코드 클릭 → 클립보드 복사
- 스탯 바 시각화 (최대 체력은 `+N HP` 단위 표시)

### `views/patch.js`
- 영웅별·공통 변경사항 아코디언 (최신 패치 기본 펼침)
- 티어 배지: 전체 랭크 기준 현재 티어 표시
- 날짜 옆 경과일 표시 ("N일 전" / "오늘")
- 스타디움/본게임 뱃지 구분

### `views/chat.js`
- 플로팅 버튼(FAB) + 팝업 챗봇 UI
- `WORKER_URL` — `app.js`에서 import (별도 상수 선언 없음)
- `buildSystemPrompt()` — 질문에서 랭크·영웅 감지 후 컨텍스트 주입
- `askAI()` — Cloudflare Worker로 POST, `X-Remaining-Count` 헤더 읽어 횟수 UI 업데이트
- `fetchRemainingCount()` — 팝업 열 때 Worker GET으로 현재 남은 횟수 즉시 조회
- `updateLimitDisplay(remaining)` — 헤더에 프로그레스 바 + 잔여 횟수 표시 (10+회=초록, 5~9=노란, 4이하=빨강)

## 로컬 개발

```bash
python -m http.server 8080 --directory public
# http://localhost:8080
```

ES Modules(`import/export`) 사용으로 반드시 HTTP 서버 필요 (파일 직접 열기 불가).

챗봇·AI 요약은 실제 Cloudflare Worker URL(`WORKER_URL`)을 사용하므로 로컬에서도 그대로 동작.
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
