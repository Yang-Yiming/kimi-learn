"""
Kimi Wire Web Bridge - MVP
A WebSocket bridge between browser and `kimi --wire` subprocess.
"""

import asyncio
import json
import logging
import os
import sys
import uuid
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("kimi-wire-web")

app = FastAPI()

# Global state
class WireState:
    def __init__(self):
        self.process: asyncio.subprocess.Process | None = None
        self.lock = asyncio.Lock()
        self.pending_requests: dict[str, asyncio.Future] = {}
        self.clients: set[WebSocket] = set()
        self.message_queue: asyncio.Queue[dict] = asyncio.Queue()
        self._read_task: asyncio.Task | None = None
        self._write_task: asyncio.Task | None = None

state = WireState()


async def broadcast(msg: dict):
    """Send a message to all connected WebSocket clients."""
    dead = set()
    for ws in state.clients:
        try:
            await ws.send_json(msg)
        except Exception:
            dead.add(ws)
    for ws in dead:
        state.clients.discard(ws)


async def _read_stdout():
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

        # If it has an 'id' and matches a pending request, resolve it
        msg_id = msg.get("id")
        if msg_id and msg_id in state.pending_requests:
            future = state.pending_requests.pop(msg_id)
            if not future.done():
                future.set_result(msg)
            continue

        # Otherwise broadcast to frontend (events/requests)
        await broadcast({"kind": "wire", "data": msg})

    logger.info("kimi stdout closed")
    await broadcast({"kind": "system", "data": {"status": "disconnected"}})


async def _read_stderr():
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


async def _write_stdin():
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


async def ensure_kimi():
    """Start kimi --wire if not already running."""
    async with state.lock:
        if state.process is not None and state.process.returncode is None:
            return

        # Determine working directory: project root (parent of web/)
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

        # Send initialize
        init_id = str(uuid.uuid4())
        future = asyncio.get_event_loop().create_future()
        state.pending_requests[init_id] = future
        await state.message_queue.put({
            "jsonrpc": "2.0",
            "method": "initialize",
            "id": init_id,
            "params": {
                "protocol_version": "1.7",
                "client": {"name": "kimi-wire-web", "version": "0.1.0"},
                "capabilities": {"supports_question": True, "supports_plan_mode": True},
            },
        })
        try:
            result = await asyncio.wait_for(future, timeout=10)
            logger.info("initialize response: %s", result)
            await broadcast({"kind": "system", "data": {"status": "connected", "init": result.get("result")}})
        except asyncio.TimeoutError:
            logger.error("initialize timeout")
            await broadcast({"kind": "system", "data": {"status": "error", "message": "initialize timeout"}})


async def send_to_kimi(msg: dict) -> dict:
    """Send a JSON-RPC request to kimi and await the response."""
    await ensure_kimi()
    msg_id = msg.get("id")
    if msg_id is None:
        msg_id = str(uuid.uuid4())
        msg["id"] = msg_id
    future = asyncio.get_event_loop().create_future()
    state.pending_requests[msg_id] = future
    await state.message_queue.put(msg)
    try:
        return await asyncio.wait_for(future, timeout=300)
    except asyncio.TimeoutError:
        state.pending_requests.pop(msg_id, None)
        raise


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    state.clients.add(ws)
    logger.info("WebSocket client connected (%d total)", len(state.clients))

    # Ensure kimi is running
    try:
        await ensure_kimi()
    except Exception as e:
        await ws.send_json({"kind": "system", "data": {"status": "error", "message": str(e)}})

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"kind": "error", "data": {"message": "Invalid JSON"}})
                continue

            kind = data.get("kind")
            payload = data.get("data", {})

            if kind == "prompt":
                # Fire-and-forget prompt; response comes via events
                asyncio.create_task(_handle_prompt(payload))
            elif kind == "cancel":
                asyncio.create_task(_handle_cancel())
            elif kind == "steer":
                asyncio.create_task(_handle_steer(payload))
            elif kind == "response":
                # Frontend responding to an ApprovalRequest / QuestionRequest / ToolCallRequest
                asyncio.create_task(_handle_response(payload))
            elif kind == "set_plan_mode":
                asyncio.create_task(_handle_set_plan_mode(payload))
            else:
                await ws.send_json({"kind": "error", "data": {"message": f"Unknown kind: {kind}"}})
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    finally:
        state.clients.discard(ws)


async def _handle_prompt(payload: dict):
    msg = {
        "jsonrpc": "2.0",
        "method": "prompt",
        "id": str(uuid.uuid4()),
        "params": {"user_input": payload.get("user_input", "")},
    }
    try:
        result = await send_to_kimi(msg)
        await broadcast({"kind": "prompt_result", "data": result})
    except Exception as e:
        await broadcast({"kind": "error", "data": {"message": str(e)}})


async def _handle_cancel():
    msg = {
        "jsonrpc": "2.0",
        "method": "cancel",
        "id": str(uuid.uuid4()),
    }
    try:
        result = await send_to_kimi(msg)
        await broadcast({"kind": "cancel_result", "data": result})
    except Exception as e:
        await broadcast({"kind": "error", "data": {"message": str(e)}})


async def _handle_steer(payload: dict):
    msg = {
        "jsonrpc": "2.0",
        "method": "steer",
        "id": str(uuid.uuid4()),
        "params": {"user_input": payload.get("user_input", "")},
    }
    try:
        result = await send_to_kimi(msg)
        await broadcast({"kind": "steer_result", "data": result})
    except Exception as e:
        await broadcast({"kind": "error", "data": {"message": str(e)}})


async def _handle_response(payload: dict):
    """Forward a frontend response back to kimi as a JSON-RPC response."""
    msg = {
        "jsonrpc": "2.0",
        "id": payload.get("id"),
        "result": payload.get("result"),
    }
    await state.message_queue.put(msg)


async def _handle_set_plan_mode(payload: dict):
    msg = {
        "jsonrpc": "2.0",
        "method": "set_plan_mode",
        "id": str(uuid.uuid4()),
        "params": {"enabled": payload.get("enabled", False)},
    }
    try:
        result = await send_to_kimi(msg)
        await broadcast({"kind": "plan_mode_result", "data": result})
    except Exception as e:
        await broadcast({"kind": "error", "data": {"message": str(e)}})


# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8765, reload=False)
