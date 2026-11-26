from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = BASE_DIR / "backend"
FRONTEND_DIR = BASE_DIR / "frontend"
CURRICULUM_DIR = BASE_DIR / "curriculum"

DATA_DIR = Path(os.getenv("DEVQUEST_DATA_DIR", str(Path.home() / ".local/share/devquest")))
DB_PATH = Path(os.getenv("DEVQUEST_DB_PATH", str(DATA_DIR / "devquest.db")))
WORKSPACES_DIR = Path(
    os.getenv("DEVQUEST_WORKSPACES_DIR", str(Path.home() / "Projects/devquest-workspaces"))
)
OLLAMA_URL = os.getenv("DEVQUEST_OLLAMA_URL", "http://127.0.0.1:11434")
API_HOST = os.getenv("DEVQUEST_HOST", "127.0.0.1")
API_PORT = int(os.getenv("DEVQUEST_PORT", "8765"))
