import logging
import os

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands

from bot.utils import cache
from bot.utils.scrapers.patch_scraper import PatchNote, fetch_latest_patch, filter_by_hero

logger = logging.getLogger(__name__)

CACHE_KEY = "patch_latest"
CACHE_TTL = 3600  # 1시간


class PatchCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="patch", description="오버워치 최신 패치노트를 확인합니다.")
    @app_commands.describe(hero="특정 영웅의 변경 사항만 보려면 영웅 이름을 입력하세요 (선택)")
    async def patch(self, interaction: discord.Interaction, hero: str | None = None):
        await interaction.response.defer()

        patch = await self._get_patch()
        if patch is None:
            await interaction.followup.send("패치노트를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.")
            return

        if hero:
            await self._send_hero_patch(interaction, patch, hero)
        else:
            await self._send_full_patch(interaction, patch)

    async def _get_patch(self) -> PatchNote | None:
        cached = cache.get(CACHE_KEY)
        if cached:
            return PatchNote(**cached)

        async with aiohttp.ClientSession() as session:
            patch = await fetch_latest_patch(session)

        if patch:
            cache.set(CACHE_KEY, patch.__dict__, CACHE_TTL)
        else:
            # 만료된 캐시라도 반환
            stale = cache.get_stale(CACHE_KEY)
            if stale:
                return PatchNote(**stale)

        return patch

    async def _send_full_patch(self, interaction: discord.Interaction, patch: PatchNote):
        embed = discord.Embed(
            title=f"📋 {patch.title}",
            url=patch.url,
            color=discord.Color.orange(),
            description=f"**날짜:** {patch.date}" if patch.date else None,
        )

        if patch.hero_changes:
            # 최대 10명 표시 (embed 필드 제한)
            for hc in patch.hero_changes[:10]:
                changes_text = "\n".join(f"• {c}" for c in hc.changes[:5])
                if len(hc.changes) > 5:
                    changes_text += f"\n• ... 외 {len(hc.changes) - 5}개"
                embed.add_field(name=hc.hero, value=changes_text or "변경 없음", inline=False)

            if len(patch.hero_changes) > 10:
                embed.set_footer(text=f"외 {len(patch.hero_changes) - 10}명의 영웅 변경 사항이 있습니다. 공식 사이트를 확인하세요.")
        elif patch.general_changes:
            text = "\n".join(f"• {c}" for c in patch.general_changes[:15])
            embed.add_field(name="변경 사항", value=text, inline=False)
        else:
            embed.description = (embed.description or "") + "\n\n변경 사항을 파싱하지 못했습니다. 공식 사이트를 확인해주세요."

        embed.add_field(name="🔗 전체 패치노트", value=f"[Blizzard 공식 사이트]({patch.url})", inline=False)
        await interaction.followup.send(embed=embed)

    async def _send_hero_patch(self, interaction: discord.Interaction, patch: PatchNote, hero: str):
        matches = filter_by_hero(patch, hero)

        if not matches:
            embed = discord.Embed(
                title=f"🔍 '{hero}' 관련 패치 없음",
                description=f"**{patch.title}** 에서 '{hero}' 관련 변경 사항을 찾지 못했습니다.",
                color=discord.Color.greyple(),
            )
            embed.add_field(name="🔗 전체 패치노트", value=f"[Blizzard 공식 사이트]({patch.url})", inline=False)
            await interaction.followup.send(embed=embed)
            return

        embed = discord.Embed(
            title=f"📋 {patch.title} — {hero}",
            url=patch.url,
            color=discord.Color.orange(),
        )
        for hc in matches:
            changes_text = "\n".join(f"• {c}" for c in hc.changes)
            embed.add_field(name=hc.hero, value=changes_text or "변경 없음", inline=False)

        await interaction.followup.send(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(PatchCog(bot))
