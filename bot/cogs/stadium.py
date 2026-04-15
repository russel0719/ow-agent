import logging

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands

from bot.utils import cache
from bot.utils.scrapers.stadium_scraper import StadiumBuild, fetch_builds

logger = logging.getLogger(__name__)

CACHE_TTL = 21600  # 6시간


class StadiumCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="build", description="스타디움 모드 영웅 빌드와 빌드 코드를 추천합니다.")
    @app_commands.describe(hero="영웅 이름 (예: 겐지, 아나, 트레이서)")
    async def build(self, interaction: discord.Interaction, hero: str):
        await interaction.response.defer()

        cache_key = f"stadium_{hero.lower()}"
        cached = cache.get(cache_key)

        if cached:
            builds = [StadiumBuild(**b) for b in cached]
        else:
            async with aiohttp.ClientSession() as session:
                builds = await fetch_builds(session, hero)
            if builds:
                cache.set(cache_key, [b.__dict__ for b in builds], CACHE_TTL)
            else:
                stale = cache.get_stale(cache_key)
                if stale:
                    builds = [StadiumBuild(**b) for b in stale]

        if not builds:
            embed = discord.Embed(
                title=f"🔍 '{hero}' 빌드를 찾지 못했습니다",
                description=(
                    "스타디움 빌드 데이터가 없습니다.\n"
                    "영웅 이름을 다시 확인하거나, 커뮤니티에서 직접 검색해보세요."
                ),
                color=discord.Color.greyple(),
            )
            await interaction.followup.send(embed=embed)
            return

        # 여러 빌드를 순서대로 embed로 전송
        embeds = [_build_embed(b, i + 1, len(builds)) for i, b in enumerate(builds)]
        await interaction.followup.send(embeds=embeds[:5])  # Discord 최대 5개


def _build_embed(build: StadiumBuild, idx: int, total: int) -> discord.Embed:
    embed = discord.Embed(
        title=f"🏟️ [{idx}/{total}] {build.hero.title()} — {build.name}",
        color=discord.Color.blue(),
    )
    embed.add_field(name="📋 빌드 코드", value=f"```{build.code}```", inline=False)
    embed.add_field(name="🎮 플레이 스타일", value=build.playstyle, inline=True)
    if build.upvotes:
        embed.add_field(name="👍 추천수", value=str(build.upvotes), inline=True)
    embed.add_field(name="📝 설명", value=build.description, inline=False)
    embed.set_footer(text=f"출처: {build.source}")
    return embed


async def setup(bot: commands.Bot):
    await bot.add_cog(StadiumCog(bot))
