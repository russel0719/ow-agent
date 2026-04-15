import logging
import os

import discord
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from discord.ext import commands

logger = logging.getLogger(__name__)

COGS = [
    "bot.cogs.patch",
    "bot.cogs.stadium",
    "bot.cogs.meta",
    "bot.cogs.recommend",
    "bot.cogs.counter",
    "bot.cogs.hero",
]


class OWBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        super().__init__(command_prefix="!", intents=intents)
        self.scheduler = AsyncIOScheduler()

    async def setup_hook(self):
        for cog in COGS:
            try:
                await self.load_extension(cog)
                logger.info(f"Loaded cog: {cog}")
            except Exception as e:
                logger.error(f"Failed to load cog {cog}: {e}")

        guild_id = os.getenv("DISCORD_GUILD_ID")
        if guild_id:
            guild = discord.Object(id=int(guild_id))
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
            logger.info(f"Synced commands to guild {guild_id}")
        else:
            await self.tree.sync()
            logger.info("Synced commands globally")

        self.scheduler.start()

    async def on_ready(self):
        logger.info(f"Logged in as {self.user} (ID: {self.user.id})")
        await self.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.playing,
                name="오버워치 2 | /patch /build /recommend",
            )
        )

    async def on_app_command_error(
        self, interaction: discord.Interaction, error: discord.app_commands.AppCommandError
    ):
        msg = "명령어 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
        logger.error(f"Command error in {interaction.command}: {error}", exc_info=error)
        try:
            if interaction.response.is_done():
                await interaction.followup.send(msg, ephemeral=True)
            else:
                await interaction.response.send_message(msg, ephemeral=True)
        except Exception:
            pass
