from __future__ import annotations

"""
Kimi Wire Web Bridge - MVP
A WebSocket bridge between browser and `kimi --wire` subprocess.
"""

import mimetypes
import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from .handlers import ws_endpoint

app = FastAPI()

app.websocket("/ws")(ws_endpoint)

_static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=_static_dir), name="static")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@app.get("/")
async def root():
    return FileResponse(os.path.join(_static_dir, "index.html"))


WHITELIST_DIRS = {"custom", "practice", "reports", "review"}
DISPLAY_NAMES = {
    "custom": "📋 学习档案",
    "practice": "✏️ 练习题",
    "reports": "📊 学习报告",
    "review": "📚 复习计划",
}


@app.get("/api/files")
async def list_files(path: str = Query(""), show_all: bool = Query(False)):
    target = os.path.abspath(os.path.join(PROJECT_ROOT, path))
    if not target.startswith(PROJECT_ROOT):
        raise HTTPException(status_code=403, detail="Access denied")
    if not os.path.exists(target):
        raise HTTPException(status_code=404, detail="Not found")
    if not os.path.isdir(target):
        raise HTTPException(status_code=400, detail="Not a directory")

    items = []
    try:
        for name in sorted(os.listdir(target)):
            if not show_all and name.startswith("."):
                continue
            # In root dir, filter to whitelist unless show_all
            if not show_all and not path and name not in WHITELIST_DIRS:
                continue
            full = os.path.join(target, name)
            rel = os.path.relpath(full, PROJECT_ROOT)
            item = {
                "name": name,
                "path": rel,
                "is_dir": os.path.isdir(full),
            }
            if not show_all and name in DISPLAY_NAMES:
                item["display_name"] = DISPLAY_NAMES[name]
            items.append(item)
    except OSError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"items": items, "current_path": path}


@app.get("/api/file")
async def read_file(path: str = Query(...)):
    target = os.path.abspath(os.path.join(PROJECT_ROOT, path))
    if not target.startswith(PROJECT_ROOT):
        raise HTTPException(status_code=403, detail="Access denied")
    if not os.path.exists(target):
        raise HTTPException(status_code=404, detail="Not found")
    if os.path.isdir(target):
        raise HTTPException(status_code=400, detail="Is a directory")

    mime, _ = mimetypes.guess_type(target)
    try:
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"content": content, "mime": mime or "text/plain", "path": path}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("web.main:app", host="0.0.0.0", port=8765, reload=False)
