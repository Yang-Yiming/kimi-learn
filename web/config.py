from __future__ import annotations

import logging
import os

CREDENTIALS_FILE = os.path.expanduser("~/.kimi/credentials/kimi-code.json")
USAGE_API = "https://api.kimi.com/coding/v1/usages"
TOKEN_API = "https://api.kimi.com/coding/v1/oauth/token"
POLL_INTERVAL = 300  # seconds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("kimi-wire-web")
