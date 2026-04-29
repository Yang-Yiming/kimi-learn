from __future__ import annotations

import logging
import os

CREDENTIALS_FILE = os.path.expanduser("~/.kimi/credentials/kimi-code.json")
USAGE_API = "https://api.kimi.com/coding/v1/usages"
TOKEN_API = "https://auth.kimi.com/api/oauth/token"
KIMI_CODE_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098"
POLL_INTERVAL = 300  # seconds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("kimi-wire-web")
