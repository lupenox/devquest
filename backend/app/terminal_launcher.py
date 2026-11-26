from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from . import config

TERMINAL_ORDER: tuple[str, ...] = ("konsole", "kitty", "alacritty", "wezterm", "xterm")
ALLOWED_TERMINALS: set[str] = set(TERMINAL_ORDER)


def _build_terminal_argv(term_name: str, exe_path: str, ws_dir: Path, primary_rel: str) -> list[str]:
    if term_name == "konsole":
        return [exe_path, "--workdir", str(ws_dir), "-e", "nvim", primary_rel]
    if term_name == "kitty":
        return [exe_path, "--directory", str(ws_dir), "nvim", primary_rel]
    if term_name == "alacritty":
        return [exe_path, "--working-directory", str(ws_dir), "-e", "nvim", primary_rel]
    if term_name == "wezterm":
        return [exe_path, "start", "--cwd", str(ws_dir), "--", "nvim", primary_rel]
    if term_name == "xterm":
        return [exe_path, "-e", "nvim", str(ws_dir / primary_rel)]
    raise ValueError(f"Unsupported terminal: {term_name}")


def resolve_terminal() -> tuple[str | None, str | None]:
    """Resolves an allowlisted terminal emulator binary without executing a shell."""
    candidates: list[str] = []
    env_term = os.getenv("DEVQUEST_TERMINAL", "").strip()
    if env_term:
        base = Path(env_term).name
        if base in ALLOWED_TERMINALS:
            candidates.append(env_term)
    for name in TERMINAL_ORDER:
        if name not in candidates:
            candidates.append(name)

    for cand in candidates:
        base = Path(cand).name
        if base not in ALLOWED_TERMINALS:
            continue
        found = shutil.which(cand)
        if found:
            return base, found
    return None, None


def validate_workspace_target(workspace_dir: str | Path, primary_file: str) -> tuple[Path, Path, str]:
    """Ensures workspace_dir stays strictly inside config.WORKSPACES_DIR and primary_file inside workspace_dir."""
    ws_root = config.WORKSPACES_DIR.expanduser().resolve()
    ws_path = Path(workspace_dir).expanduser().resolve()

    if not ws_path.is_relative_to(ws_root) or ws_path == ws_root:
        raise ValueError(f"Workspace path '{ws_path}' is outside WORKSPACES_DIR ('{ws_root}').")
    if not ws_path.exists() or not ws_path.is_dir():
        raise ValueError(f"Workspace directory does not exist: {ws_path}")

    target_candidate = Path(primary_file)
    if target_candidate.is_absolute():
        target_path = target_candidate.resolve()
    else:
        target_path = (ws_path / target_candidate).resolve()

    if not target_path.is_relative_to(ws_path):
        raise ValueError("Primary file escapes workspace directory.")

    primary_rel = target_path.relative_to(ws_path).as_posix()
    if not primary_rel or primary_rel.startswith("-"):
        raise ValueError(f"Invalid primary file name: {primary_rel!r}")

    return ws_path, target_path, primary_rel


def launch_terminal_nvim(
    workspace_dir: str | Path,
    primary_file: str,
    nvim_command: str | None = None,
) -> dict[str, Any]:
    """Safely launches an allowlisted desktop terminal running Neovim inside the validated workspace."""
    ws_path, target_path, primary_rel = validate_workspace_target(workspace_dir, primary_file)
    fallback_cmd = nvim_command or f"cd {ws_path} && nvim {primary_rel}"

    term_name, exe_path = resolve_terminal()
    if not term_name or not exe_path:
        return {
            "launched": False,
            "terminal": None,
            "workspace_dir": str(ws_path),
            "primary_file": str(target_path),
            "nvim_command": fallback_cmd,
            "message": (
                "No supported terminal emulator found (checked $DEVQUEST_TERMINAL, konsole, kitty, "
                "alacritty, wezterm, xterm). Run the nvim command manually."
            ),
        }

    if not (os.getenv("DISPLAY") or os.getenv("WAYLAND_DISPLAY")):
        return {
            "launched": False,
            "terminal": term_name,
            "workspace_dir": str(ws_path),
            "primary_file": str(target_path),
            "nvim_command": fallback_cmd,
            "message": (
                "No graphical session ($DISPLAY or $WAYLAND_DISPLAY) detected. "
                "Copy and run the nvim command in your terminal."
            ),
        }

    argv = _build_terminal_argv(term_name, exe_path, ws_path, primary_rel)
    try:
        subprocess.Popen(
            argv,
            cwd=str(ws_path),
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError as exc:
        return {
            "launched": False,
            "terminal": term_name,
            "workspace_dir": str(ws_path),
            "primary_file": str(target_path),
            "nvim_command": fallback_cmd,
            "message": f"Failed to launch {term_name}: {exc}. Copy and run the nvim command manually.",
        }

    return {
        "launched": True,
        "terminal": term_name,
        "workspace_dir": str(ws_path),
        "primary_file": str(target_path),
        "nvim_command": fallback_cmd,
        "message": f"Opened {primary_rel} in {term_name} + Neovim. Save with :w to auto-grade!",
    }
