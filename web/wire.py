from __future__ import annotations

import asyncio
import json
import os
import uuid

from .auth import fetch_usage
from .config import logger
from .state import broadcast, state

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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


async def shutdown_kimi() -> None:
    """Terminate the kimi process and clean up I/O tasks. Caller must hold state.lock."""
    if state.process is None:
        return
    logger.info("Shutting down kimi process")
    try:
        state.process.terminate()
        try:
            await asyncio.wait_for(state.process.wait(), timeout=5)
        except asyncio.TimeoutError:
            logger.warning("kimi process did not terminate gracefully; killing")
            state.process.kill()
            await state.process.wait()
    except ProcessLookupError:
        pass
    if state._read_task and not state._read_task.done():
        state._read_task.cancel()
    if state._write_task and not state._write_task.done():
        state._write_task.cancel()
    for fid, fut in list(state.pending_requests.items()):
        if not fut.done():
            fut.cancel()
    state.pending_requests.clear()
    state.process = None
    state._read_task = None
    state._write_task = None
    state.slash_commands = []
    logger.info("kimi process shut down")


async def _restart_kimi(force_session_id: str) -> None:
    """Shut down current process, then start with a new session."""
    await shutdown_kimi()
    state.message_queue = asyncio.Queue()
    await _start_kimi(force_session_id=force_session_id)


async def _start_kimi(force_session_id: str | None = None) -> None:
    """Internal: spawn kimi --wire and initialize."""
    cmd = ["kimi", "--wire", "--work-dir", PROJECT_ROOT]
    if force_session_id:
        cmd.extend(["--session", force_session_id])

    state.current_session_id = force_session_id
    logger.info("Starting kimi: %s", " ".join(cmd))
    state.process = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        limit=5 * 1024 * 1024,
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
        init_result = result.get("result", {})
        state.slash_commands = init_result.get("slash_commands", [])
        await broadcast(
            {
                "kind": "system",
                "data": {
                    "status": "connected",
                    "init": init_result,
                    "session_id": state.current_session_id,
                    "slash_commands": state.slash_commands,
                },
            }
        )
    except asyncio.TimeoutError:
        logger.error("initialize timeout")
        await broadcast(
            {"kind": "system", "data": {"status": "error", "message": "initialize timeout"}}
        )


async def ensure_kimi(force_session_id: str | None = None) -> None:
    """Start kimi --wire if not already running.

    If force_session_id is given, resumes that specific session.
    Otherwise uses --continue to pick up the last session for the working dir.
    """
    async with state.lock:
        if state.process is not None and state.process.returncode is None:
            if force_session_id is None or force_session_id == state.current_session_id:
                return
            await _restart_kimi(force_session_id)
            return

        await _start_kimi(force_session_id=force_session_id)


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
