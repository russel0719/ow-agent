#!/usr/bin/env python3
"""정적 페이지 생성기 — SEO 메타·정적 콘텐츠·sitemap 등을 데이터로부터 생성.

scripts/generate_data.py 가 public/data/*.json 을 갱신한 뒤 실행한다.
data/site_config.json 의 값(도메인, GA4 ID, AdSense pub ID, AdFit 유닛)이
비어 있으면 해당 스니펫은 출력하지 않는다 — 값을 채우고 재실행하면 활성화된다.

산출물:
  public/index.html   (마커 블록 내부만 치환: ==SEO== / ==STATIC== / ==ADFIT==)
  public/meta.html    (전체 생성)
  public/sitemap.xml
  public/robots.txt
  public/ads.txt

사용법: uv run python scripts/generate_pages.py
"""

import html
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
DATA = PUBLIC / "data"
CONFIG_PATH = ROOT / "data" / "site_config.json"

SITE_NAME = "OW2 메타 대시보드"
SITE_DESC = (
    "오버워치 2 영웅 픽률·승률·밴률 메타 통계 대시보드. "
    "랭크별 티어표, 히스토리 차트, 밴 효율 분석 제공."
)
KEYWORDS = (
    "오버워치2, 오버워치 2 메타, 오버워치 티어, 영웅 픽률, 승률, 밴률, "
    "경쟁전 통계, 패치노트, 스타디움 빌드, Overwatch 2 meta"
)

ROLE_LABEL = {"tank": "돌격", "damage": "공격", "support": "지원"}
ROLE_ORDER = ["tank", "damage", "support"]
RANK_ORDER = [
    "전체", "챔피언", "그랜드마스터", "마스터", "다이아몬드",
    "플래티넘", "골드", "실버", "브론즈",
]
STATIC_TIERS = ["S", "A", "B"]

DISCLAIMER = (
    "본 사이트는 Blizzard Entertainment와 무관한 비공식 팬 사이트입니다. "
    "Overwatch는 Blizzard Entertainment, Inc.의 상표 또는 등록상표입니다."
)


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def site_base(config: dict) -> str:
    """canonical/sitemap에 쓸 기준 URL. custom_domain이 설정되면 그쪽을 우선."""
    domain = config.get("custom_domain", "").strip()
    if domain:
        domain = domain.removeprefix("https://").removeprefix("http://").strip("/")
        return f"https://{domain}"
    return config.get("site_url", "").rstrip("/")


def normalize_pub_id(raw: str) -> str:
    """'pub-123' / 'ca-pub-123' / '123' → '123'"""
    return raw.strip().removeprefix("ca-").removeprefix("pub-")


# ── 마커 치환 ─────────────────────────────────────────────────────────────────

def replace_block(text: str, name: str, content: str, indent: str = "  ") -> str:
    begin = f"<!-- =={name}:BEGIN== -->"
    end = f"<!-- =={name}:END== -->"
    pattern = re.compile(re.escape(begin) + r".*?" + re.escape(end), re.DOTALL)
    if not pattern.search(text):
        raise RuntimeError(f"index.html에서 {begin} 마커를 찾을 수 없습니다")
    block = begin + ("\n" + content if content else "") + "\n" + indent + end
    return pattern.sub(lambda _: block, text, count=1)


# ── head 스니펫 ───────────────────────────────────────────────────────────────

def build_ga4_snippet(config: dict) -> str:
    ga4_id = config.get("ga4_id", "").strip()
    if not ga4_id:
        return "  <!-- GA4: data/site_config.json의 ga4_id 설정 시 활성화 -->"
    return f"""  <script async src="https://www.googletagmanager.com/gtag/js?id={ga4_id}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){{dataLayer.push(arguments);}}
    gtag('js', new Date());
    gtag('config', '{ga4_id}');
  </script>"""


def build_adsense_snippet(config: dict) -> str:
    pub_id = normalize_pub_id(config.get("adsense_pub_id", ""))
    if not (pub_id and config.get("adsense_auto_ads")):
        return "  <!-- AdSense: adsense_pub_id + adsense_auto_ads 설정 시 활성화 -->"
    return (
        f'  <script async src="https://pagead2.googlesyndication.com/pagead/js/'
        f'adsbygoogle.js?client=ca-pub-{pub_id}" crossorigin="anonymous"></script>'
    )


def build_seo_block(
    config: dict, *, title: str, description: str, path: str, asset_prefix: str = ""
) -> str:
    """<head>에 들어갈 SEO/분석/광고 블록.

    path는 ''(홈) 또는 'meta.html'·'hero/tracer.html' 등 base 기준 상대 경로.
    asset_prefix는 파비콘 등 상대 경로 리소스의 접두사(하위 폴더 페이지는 '../').
    """
    base = site_base(config)
    url = f"{base}/{path}" if path else f"{base}/"
    og_image = f"{base}/og-image.png"
    esc_title = html.escape(title, quote=True)
    esc_desc = html.escape(description, quote=True)

    lines = [
        f"  <title>{esc_title}</title>",
        f'  <meta name="description" content="{esc_desc}">',
        f'  <meta name="keywords" content="{KEYWORDS}">',
        f'  <link rel="canonical" href="{url}">',
        f'  <meta property="og:title" content="{esc_title}">',
        f'  <meta property="og:description" content="{esc_desc}">',
        '  <meta property="og:type" content="website">',
        f'  <meta property="og:url" content="{url}">',
        f'  <meta property="og:image" content="{og_image}">',
        '  <meta property="og:locale" content="ko_KR">',
        f'  <meta property="og:site_name" content="{html.escape(SITE_NAME, quote=True)}">',
        '  <meta name="twitter:card" content="summary_large_image">',
        f'  <meta name="twitter:title" content="{esc_title}">',
        f'  <meta name="twitter:description" content="{esc_desc}">',
        f'  <meta name="twitter:image" content="{og_image}">',
        f'  <link rel="apple-touch-icon" href="{asset_prefix}apple-touch-icon.png">',
        f'  <link rel="icon" type="image/png" sizes="192x192" '
        f'href="{asset_prefix}favicon-192.png">',
    ]

    verification = config.get("google_site_verification", "").strip()
    if verification:
        esc_ver = html.escape(verification, quote=True)
        lines.append(f'  <meta name="google-site-verification" content="{esc_ver}">')

    json_ld = json.dumps(
        {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": SITE_NAME,
            "url": f"{base}/",
            "description": SITE_DESC,
            "inLanguage": "ko",
        },
        ensure_ascii=False,
    )
    lines.append(f'  <script type="application/ld+json">{json_ld}</script>')
    lines.append(build_ga4_snippet(config))
    lines.append(build_adsense_snippet(config))
    return "\n".join(lines)


# ── 정적 콘텐츠 (크롤러 가시성) ────────────────────────────────────────────────

def fmt_pct(v) -> str:
    return f"{v}%" if v is not None else "–"


def tier_table(heroes: list[dict], *, tiers: list[str] | None = None) -> str:
    """영웅 목록 → 시맨틱 HTML 테이블. tiers 지정 시 해당 티어만."""
    rows = [h for h in heroes if tiers is None or h.get("tier") in tiers]
    rows.sort(key=lambda h: h.get("meta_score") or 0, reverse=True)
    if not rows:
        return "<p>데이터 없음</p>"
    out = [
        "<table>",
        "<thead><tr><th>티어</th><th>영웅</th><th>역할</th><th>픽률</th>"
        "<th>승률</th><th>밴률</th><th>메타 점수</th></tr></thead>",
        "<tbody>",
    ]
    for h in rows:
        name = html.escape(str(h.get("hero_name", "")))
        role = ROLE_LABEL.get(h.get("role"), h.get("role", ""))
        out.append(
            f"<tr><td>{html.escape(str(h.get('tier', '')))}</td>"
            f"<td>{name}</td><td>{role}</td>"
            f"<td>{fmt_pct(h.get('pick_rate'))}</td>"
            f"<td>{fmt_pct(h.get('win_rate'))}</td>"
            f"<td>{fmt_pct(h.get('ban_rate'))}</td>"
            f"<td>{h.get('meta_score', '–')}</td></tr>"
        )
    out.append("</tbody></table>")
    return "\n".join(out)


def build_static_block(meta: dict, patch: list, last_updated: dict) -> str:
    updated = ""
    ts = last_updated.get("timestamp")
    if ts:
        updated = datetime.fromisoformat(ts).strftime("%Y-%m-%d")

    patch_line = ""
    if patch:
        p = patch[0]
        patch_line = (
            f'<p>최신 패치: <a href="#patch">{html.escape(p.get("title", ""))}</a>'
            f' ({html.escape(p.get("date", ""))})</p>'
        )

    heroes = meta.get("전체", [])
    sections = []
    for role in ROLE_ORDER:
        role_heroes = [h for h in heroes if h.get("role") == role]
        if not role_heroes:
            continue
        sections.append(f"<h3>{ROLE_LABEL[role]} 영웅 티어 (S~B)</h3>")
        sections.append(tier_table(role_heroes, tiers=STATIC_TIERS))

    intro = (
        "오버워치 2 경쟁전의 영웅 픽률·승률·밴률을 Blizzard 공식 통계에서 매일 자동 수집해 "
        "랭크별 티어표와 메타 변화 추이를 제공하는 비공식 팬 사이트입니다. "
        "메타 통계, 메타 분석, 스타디움 빌드, 한국어 번역 패치 노트를 확인할 수 있습니다."
    )

    static_css = "\n".join(
        [
            "    <style>",
            "      #static-content h1 { font-size: 1.5rem; font-weight: 700; margin: 0.5rem 0; }",
            "      #static-content h2 {",
            "        font-size: 1.2rem; font-weight: 600; margin: 1.25rem 0 0.25rem;",
            "      }",
            "      #static-content h3 {",
            "        font-size: 1rem; font-weight: 600; margin: 1rem 0 0.25rem;",
            "      }",
            "      #static-content p { margin: 0.4rem 0; color: #9ca3af; }",
            "      #static-content a { color: #4FC3F7; }",
            "      #static-content table {",
            "        border-collapse: collapse; width: 100%; margin: 0.5rem 0 1rem;",
            "      }",
            "      #static-content th, #static-content td {",
            "        border: 1px solid #30363D; padding: 0.35rem 0.6rem;",
            "        text-align: left; font-size: 0.85rem;",
            "      }",
            "      #static-content th { color: #F5A623; }",
            "    </style>",
        ]
    )

    body = "\n".join(
        [
            '  <section id="static-content">',
            static_css,
            f"    <h1>{SITE_NAME} — 오버워치 2 영웅 티어·픽률·승률 통계</h1>",
            f"    <p>{intro}</p>",
            f"    <p>마지막 업데이트: {updated}</p>" if updated else "",
            f"    {patch_line}" if patch_line else "",
            "    <h2>전체 랭크 영웅 티어 요약</h2>",
            "\n".join(sections),
            '    <p><a href="meta.html">랭크별 전체 티어표 보기</a> · '
            '<a href="#meta">메타 통계 대시보드</a> · '
            '<a href="#patch">패치 노트</a></p>',
            "  </section>",
        ]
    )
    return "\n".join(line for line in body.split("\n") if line != "")


# ── AdFit 배너 ────────────────────────────────────────────────────────────────

def build_adfit_block(config: dict) -> str:
    unit = config.get("adfit_units", {}).get("footer_banner", "").strip()
    if not unit:
        return "  <!-- AdFit: data/site_config.json의 adfit_units.footer_banner 설정 시 활성화 -->"
    return f"""  <div class="max-w-7xl mx-auto px-4 py-3 flex justify-center">
    <ins class="kakao_ad_area" style="display:none;"
      data-ad-unit="{html.escape(unit, quote=True)}"
      data-ad-width="320"
      data-ad-height="100"></ins>
    <script type="text/javascript" src="//t1.daumcdn.net/kas/static/ba.min.js" async></script>
  </div>"""


# ── meta.html (랭크별 전체 티어표 정적 페이지) ─────────────────────────────────

def build_meta_page(config: dict, meta: dict, last_updated: dict) -> str:
    updated = ""
    ts = last_updated.get("timestamp")
    if ts:
        updated = datetime.fromisoformat(ts).strftime("%Y-%m-%d")

    meta_desc = (
        "오버워치 2 브론즈부터 챔피언까지 랭크별 전체 영웅 티어표. "
        "픽률·승률·밴률·메타 점수 기준 매일 갱신."
    )
    seo = build_seo_block(
        config,
        title=f"랭크별 영웅 티어표 전체 | {SITE_NAME}",
        description=meta_desc,
        path="meta.html",
    )

    sections = []
    ranks = [r for r in RANK_ORDER if r in meta] + [r for r in meta if r not in RANK_ORDER]
    for rank in ranks:
        esc_rank = html.escape(rank)
        sections.append(f'<section>\n<h2 id="{esc_rank}">{esc_rank}</h2>')
        deep_link = f"index.html#meta?rank={esc_rank}"
        sections.append(
            f'<p><a href="{deep_link}">대시보드에서 {esc_rank} 통계 보기</a></p>'
        )
        sections.append(tier_table(meta[rank]))
        sections.append("</section>")

    toc = " · ".join(
        f'<a href="#{html.escape(r)}">{html.escape(r)}</a>' for r in ranks
    )
    updated_note = f" 마지막 업데이트: {updated}" if updated else ""

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#161B22">
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
{seo}
  <style>
    body {{
      background: #0D1117; color: #e5e7eb;
      font-family: system-ui, sans-serif; margin: 0;
    }}
    main {{ max-width: 72rem; margin: 0 auto; padding: 1.5rem 1rem; }}
    h1 {{ font-size: 1.5rem; color: #F5A623; }}
    h2 {{ font-size: 1.2rem; margin: 2rem 0 0.25rem; color: #F5A623; }}
    a {{ color: #4FC3F7; }}
    p {{ color: #9ca3af; }}
    table {{ border-collapse: collapse; width: 100%; margin: 0.5rem 0 1rem; }}
    th, td {{
      border: 1px solid #30363D; padding: 0.35rem 0.6rem;
      text-align: left; font-size: 0.85rem;
    }}
    th {{ color: #F5A623; background: #161B22; }}
    footer {{
      max-width: 72rem; margin: 0 auto; padding: 1.5rem 1rem;
      border-top: 1px solid #30363D; font-size: 0.75rem; color: #6b7280;
    }}
  </style>
</head>
<body>
  <main>
    <p><a href="index.html">← {SITE_NAME} 홈으로</a></p>
    <h1>오버워치 2 랭크별 영웅 티어표</h1>
    <p>Blizzard 공식 통계 기반, 매일 자동 갱신됩니다.{updated_note}</p>
    <p>{toc}</p>
{chr(10).join(sections)}
  </main>
  <footer>
    <p>{DISCLAIMER}</p>
    <p>데이터 출처:
      <a href="https://overwatch.blizzard.com/ko-kr/rates/" rel="noopener">Blizzard 공식 통계</a>
    </p>
    <p><a href="privacy.html">개인정보처리방침</a> ·
      <a href="https://github.com/russel0719/ow-agent" rel="noopener">GitHub</a>
    </p>
  </footer>
</body>
</html>
"""


# ── 영웅별 정적 페이지 (SEO 롱테일) ────────────────────────────────────────────

def _hero_index(meta: dict) -> dict:
    """hero_id → {name, role, portrait, ranks:{rank:stat}} (전체 랭크 통합)."""
    idx: dict = {}
    for rank, heroes in meta.items():
        for h in heroes:
            hid = h.get("hero_id")
            if not hid:
                continue
            entry = idx.setdefault(
                hid,
                {
                    "name": h.get("hero_name", hid),
                    "role": h.get("role", ""),
                    "portrait": h.get("portrait_url", ""),
                    "ranks": {},
                },
            )
            if not entry["portrait"] and h.get("portrait_url"):
                entry["portrait"] = h["portrait_url"]
            entry["ranks"][rank] = h
    return idx


def _hero_link(hid: str, index: dict, idset: set) -> str:
    name = index[hid]["name"] if hid in index else hid
    if hid in idset:
        return f'<a href="{html.escape(hid)}.html">{html.escape(name)}</a>'
    return html.escape(name)


def _matchup_section(title: str, ids: list, index: dict, idset: set) -> str:
    if not ids:
        return ""
    links = ", ".join(_hero_link(i, index, idset) for i in ids)
    return f"<h2>{title}</h2>\n<p>{links}</p>"


def _render_hero_page(
    config: dict, hid: str, index: dict, db: dict | None, updated: str, idset: set
) -> str:
    info = index[hid]
    name = info["name"]
    role = ROLE_LABEL.get(info["role"], info["role"])
    esc_name = html.escape(name)

    seo = build_seo_block(
        config,
        title=f"{name} 카운터·승률·티어 | {SITE_NAME}",
        description=(
            f"오버워치 2 {name}의 랭크별 픽률·승률·밴률·메타 점수와 카운터·시너지·플레이 팁. "
            "Blizzard 공식 통계 기반 매일 갱신."
        ),
        path=f"hero/{hid}.html",
        asset_prefix="../",
    )

    # 랭크별 통계 표
    ranks = [r for r in RANK_ORDER if r in info["ranks"]]
    rank_rows = []
    for rank in ranks:
        h = info["ranks"][rank]
        rank_rows.append(
            f"<tr><td>{html.escape(rank)}</td>"
            f"<td>{fmt_pct(h.get('pick_rate'))}</td>"
            f"<td>{fmt_pct(h.get('win_rate'))}</td>"
            f"<td>{fmt_pct(h.get('ban_rate'))}</td>"
            f"<td>{h.get('meta_score', '–')}</td>"
            f"<td>{html.escape(str(h.get('tier', '')))}</td></tr>"
        )
    stat_table = (
        "<table><thead><tr><th>랭크</th><th>픽률</th><th>승률</th>"
        "<th>밴률</th><th>메타 점수</th><th>티어</th></tr></thead><tbody>"
        + "".join(rank_rows)
        + "</tbody></table>"
    )

    portrait = ""
    if info["portrait"]:
        portrait = (
            f'<img src="{html.escape(info["portrait"])}" alt="{esc_name}" '
            'width="64" height="64" '
            'style="border-radius:50%;border:2px solid #30363D;vertical-align:middle;'
            'margin-right:0.6rem">'
        )

    desc = ""
    matchups = ""
    tips_html = ""
    if db:
        if db.get("description"):
            desc = f'<p>{html.escape(db["description"])}</p>'
        matchups = "\n".join(
            s
            for s in [
                _matchup_section(f"{name}의 약점 (카운터당하는 상대)",
                                 db.get("countered_by", []), index, idset),
                _matchup_section(f"{name}(으)로 잡기 좋은 상대",
                                 db.get("counters", []), index, idset),
                _matchup_section(f"{name} 시너지 조합", db.get("synergies", []), index, idset),
            ]
            if s
        )
        tips = db.get("tips", [])
        if tips:
            items = "".join(f"<li>{html.escape(t)}</li>" for t in tips)
            tips_html = f"<h2>플레이 팁</h2>\n<ul>{items}</ul>"

    updated_note = f" · 마지막 업데이트 {updated}" if updated else ""

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#161B22">
  <link rel="icon" type="image/svg+xml" href="../favicon.svg">
{seo}
  <style>
    body {{ background:#0D1117; color:#e5e7eb; font-family:system-ui,sans-serif; margin:0; }}
    main {{ max-width:56rem; margin:0 auto; padding:1.5rem 1rem; }}
    h1 {{ font-size:1.5rem; color:#F5A623; }}
    h2 {{ font-size:1.15rem; margin:1.75rem 0 0.25rem; color:#F5A623; }}
    a {{ color:#4FC3F7; }}
    p {{ color:#9ca3af; }}
    ul {{ color:#c9d1d9; }}
    table {{ border-collapse:collapse; width:100%; margin:0.5rem 0 1rem; }}
    th, td {{
      border:1px solid #30363D; padding:0.35rem 0.6rem;
      text-align:left; font-size:0.85rem;
    }}
    th {{ color:#F5A623; background:#161B22; }}
    footer {{
      margin-top:2rem; padding-top:1rem; border-top:1px solid #30363D;
      font-size:0.75rem; color:#6b7280;
    }}
  </style>
</head>
<body>
  <main>
    <p><a href="../index.html">← {SITE_NAME}</a> · <a href="../meta.html">전체 티어표</a></p>
    <h1>{portrait}{esc_name} — 오버워치 2 메타 통계</h1>
    <p>역할: {html.escape(role)}{updated_note}</p>
    {desc}
    <h2>랭크별 통계</h2>
    {stat_table}
    <p><a href="../index.html#meta?hero={html.escape(hid)}">대시보드에서 {esc_name} 보기</a></p>
    {matchups}
    {tips_html}
  </main>
  <footer>
    <p>{DISCLAIMER}</p>
    <p>데이터 출처:
      <a href="https://overwatch.blizzard.com/ko-kr/rates/" rel="noopener">Blizzard 공식 통계</a> ·
      <a href="../privacy.html">개인정보처리방침</a>
    </p>
  </footer>
</body>
</html>
"""


def build_hero_pages(config: dict, meta: dict, heroes_db: dict, updated: str) -> list[str]:
    """public/hero/<id>.html 생성. 생성된 hero_id 목록 반환."""
    index = _hero_index(meta)
    ids = sorted(index.keys())
    idset = set(ids)

    hero_dir = PUBLIC / "hero"
    hero_dir.mkdir(exist_ok=True)
    # 더 이상 존재하지 않는 영웅 페이지 정리
    for old in hero_dir.glob("*.html"):
        if old.stem not in idset:
            old.unlink()

    for hid in ids:
        page = _render_hero_page(config, hid, index, heroes_db.get(hid), updated, idset)
        (hero_dir / f"{hid}.html").write_text(page, encoding="utf-8")
    return ids


# ── sitemap / robots / ads.txt ────────────────────────────────────────────────

def build_sitemap(config: dict, lastmod: str, extra_paths: list[str] | None = None) -> str:
    base = site_base(config)
    entries = []
    for path in ["", "meta.html", "privacy.html", *(extra_paths or [])]:
        url = f"{base}/{path}" if path else f"{base}/"
        entries.append(
            f"  <url>\n    <loc>{url}</loc>\n    <lastmod>{lastmod}</lastmod>\n  </url>"
        )
    body = "\n".join(entries)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n</urlset>\n"
    )


def build_robots(config: dict) -> str:
    return f"User-agent: *\nAllow: /\n\nSitemap: {site_base(config)}/sitemap.xml\n"


def build_ads_txt(config: dict) -> str:
    pub_id = normalize_pub_id(config.get("adsense_pub_id", ""))
    if not pub_id:
        return "# site_config.json의 adsense_pub_id 설정 시 자동 생성됩니다.\n"
    return f"google.com, pub-{pub_id}, DIRECT, f08c47fec0942fa0\n"


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    config = load_json(CONFIG_PATH)
    meta = load_json(DATA / "meta.json")
    patch = load_json(DATA / "patch.json")
    last_updated = load_json(DATA / "last_updated.json")

    lastmod = datetime.fromisoformat(last_updated["timestamp"]).strftime("%Y-%m-%d")

    # index.html — 마커 블록만 치환
    index_path = PUBLIC / "index.html"
    text = index_path.read_text(encoding="utf-8")
    text = replace_block(
        text, "SEO",
        build_seo_block(config, title=SITE_NAME + " — 오버워치 2 티어·픽률·승률 통계",
                        description=SITE_DESC, path=""),
    )
    text = replace_block(text, "STATIC", build_static_block(meta, patch, last_updated))
    text = replace_block(text, "ADFIT", build_adfit_block(config))
    index_path.write_text(text, encoding="utf-8")
    print("✓ public/index.html (SEO/STATIC/ADFIT 블록)")

    (PUBLIC / "meta.html").write_text(
        build_meta_page(config, meta, last_updated), encoding="utf-8"
    )
    print("✓ public/meta.html")

    # 영웅별 SEO 페이지
    heroes_raw = load_json(DATA / "heroes.json")
    heroes_db = heroes_raw.get("heroes", heroes_raw) if isinstance(heroes_raw, dict) else {}
    hero_ids = build_hero_pages(config, meta, heroes_db, updated=lastmod)
    print(f"✓ public/hero/*.html ({len(hero_ids)}개)")

    hero_paths = [f"hero/{hid}.html" for hid in hero_ids]
    (PUBLIC / "sitemap.xml").write_text(
        build_sitemap(config, lastmod, extra_paths=hero_paths), encoding="utf-8"
    )
    (PUBLIC / "robots.txt").write_text(build_robots(config), encoding="utf-8")
    (PUBLIC / "ads.txt").write_text(build_ads_txt(config), encoding="utf-8")
    print("✓ public/sitemap.xml, robots.txt, ads.txt")

    base = site_base(config)
    print(f"기준 URL: {base}/")
    for key in ["ga4_id", "google_site_verification", "adsense_pub_id"]:
        if not config.get(key, "").strip():
            print(f"  - {key} 미설정 (비활성)")
    if not config.get("adfit_units", {}).get("footer_banner", "").strip():
        print("  - adfit_units.footer_banner 미설정 (비활성)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
