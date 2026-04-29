from __future__ import annotations

"""
Kimi Wire Web Bridge - MVP
A WebSocket bridge between browser and `kimi --wire` subprocess.
"""

import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from .handlers import ws_endpoint

app = FastAPI()

app.websocket("/ws")(ws_endpoint)

_static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=_static_dir), name="static")


@app.get("/")
async def root():
    return FileResponse(os.path.join(_static_dir, "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("web.main:app", host="0.0.0.0", port=8765, reload=False)
