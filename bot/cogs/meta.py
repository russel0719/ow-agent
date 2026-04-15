import logging

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands

from bot.utils import cache
from bot.utils.scrapers.meta_scraper import (
    HeroMeta,
    RANK_PARAM,
    fetch_meta,
    load_fallback,
    meta_dict,
)

logger = logging.getLogger(__name__)

CACHE_TTL = 21600  # 6시간
TIER_EMOJI = {"S": "🔴", "A": "🟠", "B": "🟡", "C": "🟢", "D": "⚪"}
ROLE_EMOJI = {"tank": "🛡️", "damage": "⚔️", "support": "💚"}
ROLE_KO = {"tank": "탱커", "damage": "딜러", "support": "지원가"}
RANK_CHOICES = [app_commands.Choice(name=k, value=k) for k in RANK_PARAM]


class MetaCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="meta", description="현재 경쟁전 메타 영웅 통계와 티어를 확인합니다.")
    @app_commands.describe(
        rank="확인할 랭크 구간 (기본: 전체)",
        role="역할군 필터 (선택)",
    )
    @app_commands.choices(rank=RANK_CHOICES)
    @app_commands.choices(role=[
        app_commands.Choice(name="탱커", value="tank"),
        app_commands.Choice(name="딜러", value="damage"),
        app_commands.Choice(name="지원가", value="support"),
    ])
    async def meta(
        self,
        interaction: discord.Interaction,
        rank: str = "전체",
        role: str | None = None,
    ):
        await interaction.response.defer()

        heroes = await self._get_meta(rank)

        if role:
            heroes = [h for h in heroes if h.role == role]

        if not heroes:
            await interaction.followup.send("메타 데이터를 불러오지 못했습니다.")
            return

        embeds = _build_embeds(heroes, rank, role)
        await interaction.followup.send(embeds=embeds[:4])  # Discord 최대 4개

    async def _get_meta(self, rank: str) -> list[HeroMeta]:
        cache_key = f"meta_{rank}"
        cached = cache.get(cache_key)
        if cached:
            return [HeroMeta(**d) for d in cached]

        async with aiohttp.ClientSession() as session:
            heroes = await fetch_meta(session, rank)

        if heroes:
            cache.set(cache_key, [_hero_to_dict(h) for h in heroes], CACHE_TTL)
        else:
            stale = cache.get_stale(cache_key)
            if stale:
                return [HeroMeta(**d) for d in stale]
            logger.info(f"overbuff 실패, fallback 사용: rank={rank}")
            heroes = load_fallback(rank)
            if heroes:
                cache.set(cache_key, [_hero_to_dict(h) for h in heroes], CACHE_TTL)

        return heroes or []


def _build_embeds(heroes: list[HeroMeta], rank: str, role: str | None) -> list[discord.Embed]:
    """티어별로 영웅을 그룹화해 embed 생성."""
    from collections import defaultdict
    by_tier: dict[str, list[HeroMeta]] = defaultdict(list)
    for h in heroes:
        by_tier[h.tier].append(h)

    role_label = f" — {ROLE_KO.get(role, '')}" if role else ""
    embeds: list[discord.Embed] = []

    for tier in ["S", "A", "B", "C", "D"]:
        tier_heroes = by_tier.get(tier, [])
        if not tier_heroes:
            continue

        embed = discord.Embed(
            title=f"{TIER_EMOJI[tier]} {tier} 티어{role_label} ({rank})",
            color=_tier_color(tier),
        )

        lines = []
        for h in tier_heroes:
            role_e = ROLE_EMOJI.get(h.role, "")
            ban_str = f"밴 {h.ban_rate:.1f}%" if h.ban_rate > 0 else "밴 -"
            lines.append(
                f"{role_e} **{h.hero_name}** "
                f"| 픽 {h.pick_rate:.1f}% | 승 {h.win_rate:.1f}% | {ban_str} "
                f"| 점수 `{h.meta_score:.0f}`"
            )

        embed.description = "\n".join(lines)
        embeds.append(embed)

    if not embeds:
        embed = discord.Embed(
            title="메타 데이터 없음",
            description="선택한 조건에 해당하는 영웅 데이터가 없습니다.",
            color=discord.Color.greyple(),
        )
        embeds.append(embed)

    embeds[-1].set_footer(
        text="출처: overbuff.com (경쟁전) | 픽률·승률·밴률 기반 메타 점수"
    )
    return embeds


def _tier_color(tier: str) -> discord.Color:
    return {
        "S": discord.Color.red(),
        "A": discord.Color.orange(),
        "B": discord.Color.yellow(),
        "C": discord.Color.green(),
        "D": discord.Color.greyple(),
    }.get(tier, discord.Color.default())


def _hero_to_dict(h: HeroMeta) -> dict:
    return {
        "hero_id": h.hero_id,
        "hero_name": h.hero_name,
        "role": h.role,
        "pick_rate": h.pick_rate,
        "win_rate": h.win_rate,
        "ban_rate": h.ban_rate,
        "meta_score": h.meta_score,
        "tier": h.tier,
    }


async def setup(bot: commands.Bot):
    await bot.add_cog(MetaCog(bot))
