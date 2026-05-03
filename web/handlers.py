from __future__ import annotations

import asyncio
import json
import os
import uuid

from fastapi import WebSocket, WebSocketDisconnect

from .auth import ensure_usage_polling
from .config import logger
from .state import broadcast, state
from .wire import ensure_kimi, send_to_kimi, shutdown_kimi


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
            elif kind == "switch_session":
                asyncio.create_task(_handle_switch_session(payload))
            elif kind == "new_session":
                asyncio.create_task(_handle_new_session())
            else:
                await ws.send_json(
                    {"kind": "error", "data": {"message": f"Unknown kind: {kind}"}}
                )
    except (WebSocketDisconnect, RuntimeError):
        logger.info("WebSocket client disconnected")
    finally:
        state.clients.discard(ws)


async def _handle_prompt(payload: dict) -> None:
    user_input = payload.get("user_input", "")
    attachments = payload.get("attachments", [])

    # Append file references to user_input so Kimi can read them
    if attachments:
        refs = []
        for att in attachments:
            path = att.get("path", "")
            name = att.get("name", path)
            mime = att.get("mime_type", "")
            if mime.startswith("image/"):
                refs.append(f"![{name}]({path})")
            else:
                refs.append(f"- {name}: {path}")
        attachment_block = "\n\n" + "\n".join(refs)
        user_input = user_input + attachment_block if user_input else attachment_block

    msg = {
        "jsonrpc": "2.0",
        "method": "prompt",
        "id": str(uuid.uuid4()),
        "params": {"user_input": user_input},
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


def _find_session_title(session_id: str) -> str:
    """Look up a session's title from its state.json."""
    SESSIONS_DIR = os.path.expanduser("~/.kimi/sessions")
    try:
        for user_dir in os.listdir(SESSIONS_DIR):
            state_file = os.path.join(SESSIONS_DIR, user_dir, session_id, "state.json")
            if os.path.isfile(state_file):
                with open(state_file, "r", encoding="utf-8") as f:
                    st = json.load(f)
                return st.get("custom_title") or "未命名会话"
    except (OSError, json.JSONDecodeError):
        pass
    return ""


async def _handle_switch_session(payload: dict) -> None:
    """Switch to a different session by restarting kimi with --session."""
    session_id = payload.get("session_id", "")
    if not session_id:
        await broadcast({"kind": "error", "data": {"message": "Missing session_id"}})
        return
    if session_id == state.current_session_id:
        logger.debug("Already on session %s, ignoring switch", session_id)
        return
    logger.info("Switching to session: %s", session_id)
    await broadcast(
        {"kind": "system", "data": {"status": "switching", "message": "切换会话中..."}}
    )
    try:
        await ensure_kimi(force_session_id=session_id)
        title = _find_session_title(session_id)
        await broadcast(
            {
                "kind": "session_switched",
                "data": {"session_id": session_id, "title": title or "未命名会话"},
            }
        )
    except Exception as e:
        await broadcast({"kind": "error", "data": {"message": f"切换会话失败: {e}"}})


async def _handle_new_session() -> None:
    """Create a new session by restarting kimi without --session or --continue."""
    logger.info("Creating new session")
    await broadcast(
        {"kind": "system", "data": {"status": "switching", "message": "创建新会话..."}}
    )
    try:
        from .wire import _start_kimi

        async with state.lock:
            if state.process is not None:
                await shutdown_kimi()
            state.message_queue = asyncio.Queue()
            await _start_kimi(force_session_id=None)
        await broadcast({"kind": "session_switched", "data": {"session_id": state.current_session_id, "title": "新会话"}})
    except Exception as e:
        await broadcast({"kind": "error", "data": {"message": f"创建新会话失败: {e}"}})
