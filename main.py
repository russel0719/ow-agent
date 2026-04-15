import asyncio
import logging
import os

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("bot.log", encoding="utf-8"),
    ],
)

from bot.client import OWBot


async def main():
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise RuntimeError(".env 파일에 DISCORD_TOKEN을 설정해주세요.")

    bot = OWBot()
    async with bot:
        await bot.start(token)


if __name__ == "__main__":
    asyncio.run(main())
