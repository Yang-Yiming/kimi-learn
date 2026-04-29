from __future__ import annotations

"""
Kimi Wire Web Bridge - MVP
A WebSocket bridge between browser and `kimi --wire` subprocess.
"""

import io
import mimetypes
import os
import uuid
from datetime import datetime

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.staticfiles import StaticFiles
from PIL import Image
from starlette.responses import FileResponse

from .handlers import ws_endpoint

app = FastAPI()

app.websocket("/ws")(ws_endpoint)

_static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=_static_dir), name="static")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(PROJECT_ROOT, "assets")
os.makedirs(ASSETS_DIR, exist_ok=True)
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


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


MAX_IMAGE_SIZE = 1920  # max width/height in pixels
MAX_IMAGE_FILESIZE = 2 * 1024 * 1024  # 2MB
JPEG_QUALITY = 85


def _compress_image(data: bytes, filename: str) -> tuple[bytes, str]:
    """Compress image if it exceeds limits. Returns (data, ext)."""
    try:
        img = Image.open(io.BytesIO(data))
    except Exception:
        return data, os.path.splitext(filename)[1]

    # Resize if too large
    w, h = img.size
    if w > MAX_IMAGE_SIZE or h > MAX_IMAGE_SIZE:
        ratio = min(MAX_IMAGE_SIZE / w, MAX_IMAGE_SIZE / h)
        new_size = (int(w * ratio), int(h * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    # Convert to RGB if necessary (e.g. RGBA -> RGB for JPEG)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    # Save as JPEG if original is large
    ext = os.path.splitext(filename)[1].lower()
    if len(data) > MAX_IMAGE_FILESIZE or ext in (".png", ".bmp", ".tiff"):
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return buf.getvalue(), ".jpg"

    # Otherwise keep original format
    buf = io.BytesIO()
    img.save(buf, format=img.format or "JPEG")
    return buf.getvalue(), ext


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file (image or document) to the assets directory."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    try:
        contents = await file.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")

    mime_type = file.content_type or (mimetypes.guess_type(file.filename)[0] or "application/octet-stream")

    # Auto-compress images
    if mime_type.startswith("image/"):
        contents, new_ext = _compress_image(contents, file.filename)
        # Update filename extension if changed
        name, _ = os.path.splitext(file.filename)
        file.filename = name + new_ext
        mime_type = mimetypes.guess_type(file.filename)[0] or "image/jpeg"

    # Generate a unique filename to avoid collisions
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    unique_id = str(uuid.uuid4())[:8]
    name, ext = os.path.splitext(file.filename)
    safe_name = f"{timestamp}_{unique_id}{ext}"
    file_path = os.path.join(ASSETS_DIR, safe_name)

    try:
        with open(file_path, "wb") as f:
            f.write(contents)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # Return relative path from project root for frontend use
    rel_path = os.path.relpath(file_path, PROJECT_ROOT)

    return {
        "filename": file.filename,
        "saved_as": safe_name,
        "path": rel_path,
        "mime_type": mime_type,
        "size": len(contents),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("web.main:app", host="0.0.0.0", port=8765, reload=False)
