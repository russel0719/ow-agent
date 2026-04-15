"""
/recommend 커맨드 — 아군/적군 조합 기반 영웅 추천.

알고리즘:
1. 아군 역할 부족 분석 (탱커/딜러/서포터 비율)
2. 적군에 대한 카운터 점수 계산
3. 아군 시너지 점수 계산
4. 메타 점수 보너스 (픽률·승률·밴률 기반)
5. 종합 점수 상위 5명 추천
"""
from collections import Counter

import discord
from discord import app_commands
from discord.ext import commands

from bot.utils import cache
from bot.utils.hero_data import all_heroes, get_hero
from bot.utils.scrapers.meta_scraper import load_fallback, meta_dict

ROLE_EMOJI = {"tank": "🛡️", "damage": "⚔️", "support": "💚"}
IDEAL_COMP = {"tank": 1, "damage": 2, "support": 2}  # 표준 1-2-2 조합


class RecommendCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="recommend", description="아군/적군 조합을 분석해 추천 영웅을 제안합니다.")
    @app_commands.describe(
        my_team="아군 영웅 이름 (띄어쓰기로 구분, 예: 아나 메르시 겐지)",
        enemy_team="적군 영웅 이름 (선택, 띄어쓰기로 구분, 예: 리퍼 윈스턴)",
    )
    async def recommend(
        self,
        interaction: discord.Interaction,
        my_team: str,
        enemy_team: str | None = None,
    ):
        my_names = my_team.split()
        enemy_names = enemy_team.split() if enemy_team else []

        my_heroes = [get_hero(n) for n in my_names]
        my_heroes = [h for h in my_heroes if h]

        enemy_heroes = [get_hero(n) for n in enemy_names]
        enemy_heroes = [h for h in enemy_heroes if h]

        not_found = [
            n for n, h in zip(my_names, [get_hero(n) for n in my_names]) if not h
        ]
        if not_found:
            await interaction.response.send_message(
                f"❌ 찾을 수 없는 영웅: {', '.join(not_found)}", ephemeral=True
            )
            return

        meta = _get_cached_meta()
        scores = _score_heroes(my_heroes, enemy_heroes, meta)
        top5 = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:5]

        embed = discord.Embed(
            title="🎯 영웅 추천",
            color=discord.Color.gold(),
        )

        # 아군 조합 요약
        if my_heroes:
            my_names_display = ", ".join(h["name"] for h in my_heroes)
            role_count = Counter(h["role"] for h in my_heroes)
            role_summary = " | ".join(
                f"{ROLE_EMOJI[r]} {role_count[r]}" for r in ["tank", "damage", "support"] if role_count[r]
            )
            embed.add_field(name="👥 아군 조합", value=f"{my_names_display}\n{role_summary}", inline=False)

        if enemy_heroes:
            enemy_display = ", ".join(h["name"] for h in enemy_heroes)
            embed.add_field(name="⚔️ 적군 조합", value=enemy_display, inline=False)

        # 추천 영웅
        rec_lines = []
        for hero_id, score in top5:
            h = get_hero(hero_id)
            if not h:
                continue
            role_emoji = ROLE_EMOJI.get(h["role"], "")
            meta_info = meta.get(hero_id)
            tier_str = f" [{meta_info['tier']}티어]" if meta_info else ""
            rec_lines.append(f"{role_emoji} **{h['name']}**{tier_str} (점수: {score})")

        embed.add_field(
            name="✨ 추천 영웅 TOP 5",
            value="\n".join(rec_lines) if rec_lines else "추천 결과 없음",
            inline=False,
        )

        # 역할 부족 경고 + 메타 데이터 출처 표시
        role_count = Counter(h["role"] for h in my_heroes)
        missing = []
        for role, ideal in IDEAL_COMP.items():
            if role_count.get(role, 0) < ideal:
                missing.append({"tank": "탱커", "damage": "딜러", "support": "서포터"}[role])

        footer_parts = []
        if missing:
            footer_parts.append(f"⚠️ 부족한 역할: {', '.join(missing)}")
        footer_parts.append("메타 점수 포함 (픽률·승률·밴률 반영)")
        embed.set_footer(text=" | ".join(footer_parts))

        await interaction.response.send_message(embed=embed)


def _get_cached_meta() -> dict[str, dict]:
    """캐시된 메타 데이터 반환. 없으면 fallback 사용."""
    for rank in ("전체", "그랜드마스터"):
        cached = cache.get(f"meta_{rank}") or cache.get_stale(f"meta_{rank}")
        if cached:
            return {d["hero_id"]: d for d in cached}
    # 캐시가 전혀 없으면 fallback 즉시 로드
    heroes = load_fallback("전체")
    return meta_dict(heroes)


def _score_heroes(
    my_team: list[dict],
    enemy_team: list[dict],
    meta: dict[str, dict],
) -> dict[str, int]:
    """영웅별 추천 점수 계산.

    점수 구성:
    - 역할 부족 보너스:  +20점 × 부족 수  (조합 완성도)
    - 카운터 점수:       +15점 / 적군 1명  (픽 우위)
    - 역카운터 패널티:   -10점 / 적군 1명  (픽 열세)
    - 시너지 점수:       +10점 / 아군 1명  (팀 궁합)
    - 메타 점수 보너스:  0~25점            (픽률·승률·밴률 반영)
    """
    my_ids = {h["id"] for h in my_team}
    enemy_ids = {h["id"] for h in enemy_team}
    role_count = Counter(h["role"] for h in my_team)

    scores: dict[str, int] = {}

    for candidate in all_heroes():
        cid = candidate["id"]
        if cid in my_ids:
            continue

        score = 0

        # 역할 부족 보너스 (1-2-2 기준)
        role = candidate["role"]
        current = role_count.get(role, 0)
        ideal = IDEAL_COMP.get(role, 0)
        if current < ideal:
            score += (ideal - current) * 20

        # 카운터 점수
        for eid in enemy_ids:
            if eid in candidate.get("counters", []):
                score += 15

        # 역카운터 패널티
        for eid in enemy_ids:
            enemy = next((h for h in enemy_team if h["id"] == eid), None)
            if enemy and cid in enemy.get("counters", []):
                score -= 10

        # 시너지 점수
        for mid in my_ids:
            if mid in candidate.get("synergies", []):
                score += 10

        # 메타 점수 보너스 (0~25점)
        # meta_score는 0~100 범위 → 0~25점으로 스케일 다운
        if cid in meta:
            meta_bonus = int(meta[cid]["meta_score"] * 0.25)
            score += meta_bonus

        scores[cid] = score

    return scores


async def setup(bot: commands.Bot):
    await bot.add_cog(RecommendCog(bot))
