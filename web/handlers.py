from __future__ import annotations

import asyncio
import json
import uuid

from fastapi import WebSocket, WebSocketDisconnect

from .auth import ensure_usage_polling
from .config import logger
from .state import broadcast, state
from .wire import ensure_kimi, send_to_kimi


async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    state.clients.add(ws)
    logger.info("WebSocket client connected (%d total)", len(state.clients))

    try:
        await ensure_kimi()
    except Exception as e:
        await ws.send_json(
            {"kind": "system", "data": {"status": "error", "message": str(e)}}
        )

    await ensure_usage_polling()

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json(
                    {"kind": "error", "data": {"message": "Invalid JSON"}}
                )
                continue

            kind = data.get("kind")
            payload = data.get("data", {})

            if kind == "prompt":
                asyncio.create_task(_handle_prompt(payload))
            elif kind == "cancel":
                asyncio.create_task(_handle_cancel())
            elif kind == "steer":
                asyncio.create_task(_handle_steer(payload))
            elif kind == "response":
                asyncio.create_task(_handle_response(payload))
            elif kind == "set_plan_mode":
                asyncio.create_task(_handle_set_plan_mode(payload))
            else:
                await ws.send_json(
                    {"kind": "error", "data": {"message": f"Unknown kind: {kind}"}}
                )
    except (WebSocketDisconnect, RuntimeError):
        logger.info("WebSocket client disconnected")
    finally:
        state.clients.discard(ws)


async def _handle_prompt(payload: dict) -> None:
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


async def _handle_cancel() -> None:
    msg = {"jsonrpc": "2.0", "method": "cancel", "id": str(uuid.uuid4())}
    try:
        result = await send_to_kimi(msg)
        await broadcast({"kind": "cancel_result", "data": result})
    except Exception as e:
        await broadcast({"kind": "error", "data": {"message": str(e)}})


async def _handle_steer(payload: dict) -> None:
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


async def _handle_response(payload: dict) -> None:
    """Forward a frontend response back to kimi as a JSON-RPC response."""
    msg = {
        "jsonrpc": "2.0",
        "id": payload.get("id"),
        "result": payload.get("result"),
    }
    await state.message_queue.put(msg)


async def _handle_set_plan_mode(payload: dict) -> None:
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
