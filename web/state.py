from __future__ import annotations

import asyncio

from fastapi import WebSocket

from .config import logger


class WireState:
    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
        self.lock = asyncio.Lock()
        self.pending_requests: dict[str, asyncio.Future] = {}
        self.clients: set[WebSocket] = set()
        self.message_queue: asyncio.Queue[dict] = asyncio.Queue()
        self._read_task: asyncio.Task | None = None
        self._write_task: asyncio.Task | None = None
        self._usage_task: asyncio.Task | None = None
        self._usage_lock = asyncio.Lock()
        self.current_session_id: str | None = None
        self.slash_commands: list[dict] = []


state = WireState()


async def broadcast(msg: dict) -> None:
    """Send a message to all connected WebSocket clients."""
    dead: set[WebSocket] = set()
    for ws in state.clients:
        try:
            await ws.send_json(msg)
        except Exception:
            dead.add(ws)
    for ws in dead:
        state.clients.discard(ws)
