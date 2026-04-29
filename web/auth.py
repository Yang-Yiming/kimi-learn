from __future__ import annotations

import asyncio
import json
import time

import httpx

from .config import CREDENTIALS_FILE, POLL_INTERVAL, TOKEN_API, USAGE_API, logger
from .state import broadcast, state

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
    return _client


async def _read_creds_file() -> dict:
    loop = asyncio.get_running_loop()

    def _read() -> dict:
        with open(CREDENTIALS_FILE) as f:
            return json.load(f)

    return await loop.run_in_executor(None, _read)


async def _write_creds_file(creds: dict) -> None:
    loop = asyncio.get_running_loop()

    def _write() -> None:
        with open(CREDENTIALS_FILE, "w") as f:
            json.dump(creds, f, indent=2)

    await loop.run_in_executor(None, _write)


async def read_token() -> str | None:
    """Read current access token from kimi credentials file."""
    try:
        creds = await _read_creds_file()
        return creds.get("access_token")
    except Exception as e:
        logger.warning("Failed to read token: %s", e)
        return None


async def refresh_token() -> bool:
    """Refresh OAuth token using refresh_token from credentials file."""
    try:
        creds = await _read_creds_file()
    except Exception as e:
        logger.warning("Failed to read credentials for refresh: %s", e)
        return False

    refresh = creds.get("refresh_token")
    if not refresh:
        return False

    try:
        resp = await _get_client().post(
            TOKEN_API,
            json={
                "grant_type": "refresh_token",
                "refresh_token": refresh,
                "scope": "kimi-code",
            },
        )
    except Exception as e:
        logger.warning("Token refresh request failed: %s", e)
        return False

    if resp.status_code != 200:
        logger.warning("Token refresh failed: %d %s", resp.status_code, resp.text[:200])
        return False

    try:
        new_data = resp.json()
    except Exception:
        logger.warning("Token refresh response invalid JSON")
        return False

    creds["access_token"] = new_data.get("access_token")
    creds["expires_at"] = time.time() + new_data.get("expires_in", 900)
    try:
        await _write_creds_file(creds)
    except Exception as e:
        logger.warning("Failed to write refreshed credentials: %s", e)
        return False

    logger.info("Token refreshed successfully")
    return True


async def _do_fetch(token: str) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    try:
        resp = await _get_client().get(USAGE_API, headers=headers)
    except Exception as e:
        logger.warning("Usage API request failed: %s", e)
        return

    if resp.status_code == 401:
        logger.warning("Token expired, trying refresh...")
        if await refresh_token():
            token = await read_token()
            if token:
                try:
                    resp = await _get_client().get(
                        USAGE_API, headers={"Authorization": f"Bearer {token}"}
                    )
                except Exception as e:
                    logger.warning("Usage API retry failed: %s", e)
                    return
        else:
            return

    if resp.status_code != 200:
        logger.warning("Usage API returned %d: %s", resp.status_code, resp.text[:200])
        return

    try:
        data = resp.json()
    except Exception:
        logger.warning("Usage API returned invalid JSON")
        return

    await broadcast({"kind": "usage", "data": data})


async def fetch_usage() -> None:
    """Fetch usage/quota data from kimi API and broadcast to clients."""
    async with state._usage_lock:
        token = await read_token()
        if not token:
            return
        await _do_fetch(token)


async def _usage_loop() -> None:
    while True:
        await fetch_usage()
        await asyncio.sleep(POLL_INTERVAL)


async def ensure_usage_polling() -> None:
    """Start usage polling if not already running."""
    if state._usage_task is None or state._usage_task.done():
        state._usage_task = asyncio.create_task(_usage_loop())
        asyncio.create_task(fetch_usage())
