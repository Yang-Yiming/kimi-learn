from __future__ import annotations

import asyncio
import json
import os
import uuid

from .auth import fetch_usage
from .config import logger
from .state import broadcast, state


async def _read_stdout() -> None:
    """Read JSON-RPC lines from kimi stdout and route them."""
    if state.process is None or state.process.stdout is None:
        return
    while True:
        try:
            line = await state.process.stdout.readline()
        except Exception as e:
            logger.error("stdout read error: %s", e)
            break
        if not line:
            break
        text = line.decode("utf-8", errors="replace").strip()
        if not text:
            continue
        logger.debug("<-- %s", text)
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("Invalid JSON from kimi: %s", text)
            continue

        msg_id = msg.get("id")
        if msg_id and msg_id in state.pending_requests:
            future = state.pending_requests.pop(msg_id)
            if not future.done():
                future.set_result(msg)
            continue

        await broadcast({"kind": "wire", "data": msg})

        if msg.get("method") == "event" and msg.get("params", {}).get("type") == "TurnEnd":
            asyncio.create_task(fetch_usage())

    logger.info("kimi stdout closed")
    await broadcast({"kind": "system", "data": {"status": "disconnected"}})


async def _read_stderr() -> None:
    """Read stderr from kimi and log it."""
    if state.process is None or state.process.stderr is None:
        return
    while True:
        try:
            line = await state.process.stderr.readline()
        except Exception as e:
            logger.error("stderr read error: %s", e)
            break
        if not line:
            break
        text = line.decode("utf-8", errors="replace").rstrip()
        if text:
            logger.warning("[kimi stderr] %s", text)


async def _write_stdin() -> None:
    """Write JSON-RPC lines to kimi stdin from the queue."""
    if state.process is None or state.process.stdin is None:
        return
    while True:
        msg = await state.message_queue.get()
        if msg is None:
            break
        line = json.dumps(msg, ensure_ascii=False)
        logger.debug("--> %s", line)
        try:
            state.process.stdin.write((line + "\n").encode("utf-8"))
            await state.process.stdin.drain()
        except Exception as e:
            logger.error("stdin write error: %s", e)
            break


async def ensure_kimi() -> None:
    """Start kimi --wire if not already running."""
    async with state.lock:
        if state.process is not None and state.process.returncode is None:
            return

        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cmd = ["kimi", "--wire", "--work-dir", project_root]
        logger.info("Starting kimi: %s", " ".join(cmd))
        state.process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        state._read_task = asyncio.create_task(_read_stdout())
        state._write_task = asyncio.create_task(_write_stdin())
        asyncio.create_task(_read_stderr())

        init_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        state.pending_requests[init_id] = future
        await state.message_queue.put(
            {
                "jsonrpc": "2.0",
                "method": "initialize",
                "id": init_id,
                "params": {
                    "protocol_version": "1.7",
                    "client": {"name": "kimi-wire-web", "version": "0.1.0"},
                    "capabilities": {"supports_question": True, "supports_plan_mode": True},
                },
            }
        )
        try:
            result = await asyncio.wait_for(future, timeout=10)
            logger.info("initialize response: %s", result)
            await broadcast(
                {
                    "kind": "system",
                    "data": {"status": "connected", "init": result.get("result")},
                }
            )
        except asyncio.TimeoutError:
            logger.error("initialize timeout")
            await broadcast(
                {"kind": "system", "data": {"status": "error", "message": "initialize timeout"}}
            )


async def send_to_kimi(msg: dict) -> dict:
    """Send a JSON-RPC request to kimi and await the response."""
    await ensure_kimi()
    msg_id = msg.get("id") or str(uuid.uuid4())
    msg["id"] = msg_id
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    state.pending_requests[msg_id] = future
    await state.message_queue.put(msg)
    try:
        return await asyncio.wait_for(future, timeout=300)
    except asyncio.TimeoutError:
        state.pending_requests.pop(msg_id, None)
        raise
