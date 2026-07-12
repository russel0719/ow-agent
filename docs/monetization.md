# 수익화 가이드

이 문서는 사이트 수익화(AdSense·AdFit·GA4·Search Console)를 위해 **사용자가 직접 해야 할 외부 작업**과,
각 단계에서 코드/설정 측에서 해야 할 일을 정리한다.

모든 코드 측 전환은 [`data/site_config.json`](../data/site_config.json) 값을 채우고
`uv run python scripts/generate_pages.py` 를 실행(또는 다음 자동 갱신을 대기)하는 것으로 끝난다.
코드 수정은 필요 없다.

## site_config.json 필드

| 필드 | 채우는 시점 | 효과 |
|------|------------|------|
| `site_url` | (기본값) | canonical/OG/sitemap 기준 URL |
| `custom_domain` | 도메인 구매·연결 후 | canonical/OG/sitemap/robots가 새 도메인으로 일괄 전환 |
| `ga4_id` | GA4 속성 생성 후 (`G-XXXXXXXXXX`) | gtag.js 스니펫 활성화 |
| `google_site_verification` | Search Console URL 접두어 속성 등록 시 | 소유권 확인 메타 태그 출력 |
| `adsense_pub_id` | AdSense 가입 후 (`pub-XXXXXXXXXXXXXXXX`) | ads.txt 생성 |
| `adsense_auto_ads` | AdSense 사이트 추가·심사 신청 시 `true` | 자동광고 스크립트 삽입 (심사에 코드 필요) |
| `adfit_units.footer_banner` | AdFit 유닛 생성 후 | 푸터 위 320×100 배너 활성화 |

## 외부 작업 체크리스트 (순서대로)

### 0단계 — 지금 바로 가능 (github.io 상태)

- [ ] **Search Console 등록 (URL 접두어 속성)**: https://search.google.com/search-console 에서
      `https://russel0719.github.io/ow-agent/` 를 URL 접두어 속성으로 추가
      → 소유권 확인 방법 중 "HTML 태그" 선택 → `content="..."` 값을
      `site_config.json`의 `google_site_verification`에 입력 → 생성기 실행·커밋·배포 → "확인" 클릭
- [ ] Search Console에 `sitemap.xml` 제출
- [ ] **GA4 속성 생성**: https://analytics.google.com → 관리 → 속성 만들기 → 웹 스트림 추가
      → 측정 ID(`G-...`)를 `ga4_id`에 입력 → 생성기 실행·커밋

### 1단계 — 커스텀 도메인

- [ ] 도메인 구매 (연 1~2만원)
- [ ] DNS 설정: apex는 GitHub Pages IP 4개(A 레코드), `www`는 `russel0719.github.io` CNAME
      — https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site
- [ ] GitHub 저장소 Settings → Pages → Custom domain 입력 + **Enforce HTTPS**
- [ ] GitHub 계정 Settings → Pages → **Verified domains**에 도메인 추가 (서브도메인 탈취 방지)
- [ ] `public/CNAME` 파일 추가 (도메인 한 줄) — Actions 배포 아티팩트에 포함되어야 유지됨
- [ ] `site_config.json`의 `custom_domain` 채움 → 생성기 실행·커밋
- [ ] **Search Console 도메인 속성 재등록**: DNS TXT 레코드 방식 — http/https·모든 서브도메인 포괄.
      기존 URL 접두어 속성(메타 태그)은 병행 유지 가능. sitemap 재제출
- [ ] GA4 ↔ Search Console 연결 (GA4 관리 → Search Console 링크) — 검색 유입 쿼리를 GA4에서 조회

### 2단계 — 광고 심사

- [ ] **AdSense**: https://adsense.google.com 가입 → `adsense_pub_id` 채움(ads.txt 생성)
      → 사이트 추가 → `adsense_auto_ads: true`로 심사 코드 삽입 → 생성기 실행·커밋 → 심사 신청
      → 승인 후 AdSense 대시보드에서 자동광고 형식(앵커/전면/인페이지) 조정
      - ads.txt는 **루트 도메인에서만 유효** — 커스텀 도메인 연결(1단계) 후에 신청할 것
      - 심사 기간 수일~수주. 거절 시 흔한 사유: 콘텐츠 부족(정적 콘텐츠·meta.html이 대응),
        개인정보처리방침 부재(privacy.html이 대응)
- [ ] **카카오 AdFit**: https://adfit.kakao.com 가입 → 매체(웹사이트) 등록 → 배너 유닛(320×100) 생성
      → `adfit_units.footer_banner`에 유닛 ID 입력 → 생성기 실행·커밋 → 심사
      - AdFit은 ads.txt 불필요, github.io 도메인으로도 신청 가능
- [ ] 광고 활성화 후 Lighthouse로 CLS(레이아웃 이동) 재측정

### 3단계 — 선택

- [ ] 후원 링크 (Buy Me a Coffee / 토스 익명송금) — 푸터에 추가
- [ ] 쿠팡 파트너스 — 제휴 링크 게재 시 "파트너스 활동으로 수수료를 받을 수 있음" 고지 필수

## 법적 리스크 정리 (수익화 전 확인)

수익화는 아래 리스크의 수위를 높인다. 인지하고 진행할 것.

1. **Blizzard 저작물·상표**
   - 본 사이트는 Blizzard의 통계 데이터, 영웅명, 초상화 이미지(CDN 핫링크), 패치노트 번역문을 사용한다.
   - Blizzard 팬 콘텐츠 정책상 팬 사이트의 **소극적 광고 게재는 통상 용인되는 범위**이나,
     공식 허가는 아니다. 푸터의 "비공식 팬 사이트" 면책 문구와 출처 표기를 항상 유지할 것.
   - 통계는 공개 페이지가 쓰는 비공개 JSON 엔드포인트를 브라우저 UA로 크롤링 중 —
     ToS 위반 소지가 있으며, 차단·경고 시 즉시 대응(크롤링 중단 또는 공식 문의)할 것.
2. **stadiumbuilds.io** (스타디움 빌드 데이터)
   - 서드파티 사이트의 백엔드를 공개 anon 키로 직접 조회해 유저 제작 콘텐츠를 번역·재배포 중.
   - **수익화 전에 운영자에게 허가를 요청할 것을 강력 권고.**
     거절 또는 무응답 시: 스타디움 탭의 출처 표기를 강화하고 광고 노출 페이지에서 제외하거나 탭 자체를 내리는 것을 검토.
   - 이 리스크 때문에 스타디움 데이터는 **정적 SEO 페이지로 생성하지 않는다** (`generate_pages.py`에서 의도적으로 제외).
3. **패치노트 번역 게재**: 원문 링크·출처 표기를 유지할 것 (patch.json의 `url` 필드가 원문 링크).

## 비용 보호 현황

- 공개 REST API(`cloudflare-worker-api/`): 정적 공개 데이터의 프록시라 인증 없음(의도된 정책,
  [api.md](api.md) 참고). Cloudflare Free 일 10만 요청 한도 내 운용.
- 번역·요약(Cerebras)은 현재 무료 티어 — 과금 전환 시 이 문서에 기록할 것.
- AI 챗봇·홈 AI 요약 기능은 NVIDIA 무료 티어 불안정으로 제거됨 (런타임 LLM 의존 없음).
