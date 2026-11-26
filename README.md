# DevQuest — Neovim-First zyBooks & RPG Programming Mastery OS

A **$0/month**, local-first gamified programming platform built specifically for mastering **Neovim** alongside **Python, FastAPI, Bash, TypeScript, JavaScript, C++, JSON, XML, HTML, CSS, SQL, Git, React, Playwright, and Regex**—all in one place.

## Quick Start

```bash
# 1. Start the unified local web UI + FastAPI grading backend (http://127.0.0.1:8765)
devquest up

# 2. In another terminal, jump straight into your next Neovim challenge!
devquest next          # next recommended lab
devquest next python   # or filter by any of the 16 technologies
devquest stats         # view all 16 ASCII mastery bars in terminal
```

Inside Neovim (`~/.config/nvim`):
- `:w` automatically grades your DevQuest workspace and updates your browser mastery bars live via WebSocket!
- `<leader>qt` — re-grade now | `<leader>qo` — test output | `<leader>qh` — hints | `<leader>qs` — 16 mastery bars in Neovim
- `<leader>pb` — `:VimBeGood` | `<leader>ph` — toggle `hardtime.nvim` | `<leader>pp` — toggle `precognition.nvim` | `<leader>pl` — `:Leet` (`leetcode.nvim`)

## Optional Arch / EndeavourOS AUR Extras

```bash
yay -S --needed exercism-bin pacvim-git oh-my-git-git
```

## Running Automated Tests

```bash
# Backend + all 16 local graders
cd ~/Projects/devquest/backend && uv run pytest -v

# Frontend unit tests
cd ~/Projects/devquest/frontend && npm test

# Playwright E2E (against running server)
cd ~/Projects/devquest/frontend && npx playwright test
```
