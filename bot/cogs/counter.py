import discord
from discord import app_commands
from discord.ext import commands

from bot.utils.hero_data import all_heroes, get_hero

ROLE_EMOJI = {"tank": "🛡️", "damage": "⚔️", "support": "💚"}


class CounterCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="counter", description="특정 영웅의 카운터 픽을 확인합니다.")
    @app_commands.describe(hero="카운터를 찾을 영웅 이름 (예: 리퍼, 윈스턴)")
    async def counter(self, interaction: discord.Interaction, hero: str):
        target = get_hero(hero)
        if not target:
            await interaction.response.send_message(
                f"❌ '{hero}' 영웅을 찾을 수 없습니다.", ephemeral=True
            )
            return

        countered_by_ids = target.get("countered_by", [])
        counter_heroes = [get_hero(c) for c in countered_by_ids if get_hero(c)]

        # 역방향으로도 탐색: 다른 영웅의 counters 목록에 target이 있으면 추가
        target_id = target["id"]
        extra = [
            h for h in all_heroes()
            if target_id in h.get("counters", []) and h["id"] not in countered_by_ids
        ]
        all_counters = counter_heroes + extra[:3]

        embed = discord.Embed(
            title=f"🎯 {target['name']} 카운터 픽",
            description=f"**{target['name']}**을 상대할 때 유리한 영웅입니다.",
            color=discord.Color.red(),
        )

        if not all_counters:
            embed.description += "\n\n카운터 데이터가 없습니다."
        else:
            for h in all_counters[:6]:
                role_emoji = ROLE_EMOJI.get(h["role"], "")
                tips = h.get("tips", [])
                reason = tips[0] if tips else "포지션 우위"
                embed.add_field(
                    name=f"{role_emoji} {h['name']}",
                    value=reason,
                    inline=False,
                )

        await interaction.response.send_message(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(CounterCog(bot))
