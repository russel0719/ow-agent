import discord
from discord import app_commands
from discord.ext import commands

from bot.utils.hero_data import get_hero

ROLE_EMOJI = {"tank": "🛡️", "damage": "⚔️", "support": "💚"}
DIFFICULTY_STAR = {1: "⭐", 2: "⭐⭐", 3: "⭐⭐⭐"}


class HeroCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="hero", description="영웅의 기본 정보와 플레이 팁을 확인합니다.")
    @app_commands.describe(name="영웅 이름 (예: 겐지, 아나, tracer)")
    async def hero(self, interaction: discord.Interaction, name: str):
        hero = get_hero(name)
        if not hero:
            await interaction.response.send_message(
                f"❌ '{name}' 영웅을 찾을 수 없습니다. 영웅 이름을 다시 확인해주세요.",
                ephemeral=True,
            )
            return

        role_emoji = ROLE_EMOJI.get(hero["role"], "")
        role_info = {"tank": "탱커", "damage": "딜러", "support": "지원가"}.get(hero["role"], hero["role"])

        embed = discord.Embed(
            title=f"{role_emoji} {hero['name']}",
            description=hero.get("description", ""),
            color=_role_color(hero["role"]),
        )
        embed.add_field(name="역할", value=role_info, inline=True)
        embed.add_field(name="난이도", value=DIFFICULTY_STAR.get(hero.get("difficulty", 1), "⭐"), inline=True)

        counters = hero.get("counters", [])
        if counters:
            embed.add_field(
                name="⚡ 이 영웅이 카운터하는 영웅",
                value=", ".join(c.replace("_", " ").title() for c in counters),
                inline=False,
            )

        countered_by = hero.get("countered_by", [])
        if countered_by:
            embed.add_field(
                name="⚠️ 이 영웅의 카운터",
                value=", ".join(c.replace("_", " ").title() for c in countered_by),
                inline=False,
            )

        synergies = hero.get("synergies", [])
        if synergies:
            embed.add_field(
                name="🤝 시너지 영웅",
                value=", ".join(s.replace("_", " ").title() for s in synergies),
                inline=False,
            )

        tips = hero.get("tips", [])
        if tips:
            embed.add_field(
                name="💡 플레이 팁",
                value="\n".join(f"• {t}" for t in tips),
                inline=False,
            )

        await interaction.response.send_message(embed=embed)


def _role_color(role: str) -> discord.Color:
    return {"tank": discord.Color.blue(), "damage": discord.Color.red(), "support": discord.Color.green()}.get(
        role, discord.Color.greyple()
    )


async def setup(bot: commands.Bot):
    await bot.add_cog(HeroCog(bot))
