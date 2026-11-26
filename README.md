# DevQuest — Neovim-First zyBooks, Interview Prep & RPG Programming Mastery OS

> **Built with AI:** This project was made by prompting **AGY (Google Antigravity)** using **Gemini 4 Neon on `xhigh`**.

A **$0/month**, local-first gamified programming platform built for mastering **Neovim** alongside **Python, FastAPI, Bash, TypeScript, JavaScript, C++, JSON, XML, HTML, CSS, SQL, Git, React, Playwright, Regex, and Debugging (`pdb`, `gdb`, `set -x`, Playwright traces)**—all in one place.

---

## Core Features

- **17-Technology RPG Mastery Matrix**: Individual levels, XP curves, freshness badges, daily streaks, 14-day heatmap, and SM-2 spaced-repetition refresh queues.
- **zyBooks-Style Interactive Learning**: Active-reading concept cards, step-by-step interactive **Code Tracing**, **Parsons** line-ordering puzzles, and inline **Fill-in-the-Blank** drills—great for 5-minute bursts.
- **Real Neovim Auto-Graded Labs**: Every coding lab opens directly in real Neovim (`devquest next [tech]`). Saving (`:w`) runs real local graders (`pytest`, FastAPI `TestClient`, `g++ -std=c++20`, `sqlite3`, Node 26 TS, Bash sandboxes, live Git repos, Playwright headless Chromium, and `pdb` debugging labs) and awards **Vim Par Bonus XP** via live WebSocket updates.
- **GitHub Connector & Repo-to-Interview Mastery**: Connects seamlessly to your GitHub account (via local `gh` CLI auth or PAT), browses your public & private repositories, inspects actual architecture, routes, classes, and functions, and generates interactive **Interview Defense Study Packs** (optionally enriched with Staff-Engineer grill questions via local Ollama!) so you can explain any repository thoroughly in technical interviews.
- **Debugging Tools Track**: Dedicated modules & Neovim bug-hunt labs teaching the **Python debugger (`pdb` & `breakpoint()`)**, `pytest -s --pdb`, Bash `set -x`, `g++ -g` + `gdb`, and Playwright `--debug`.
- **External Free API Sync & Local Ollama Forge**: Sync XP from **GitHub**, **LeetCode GraphQL** (`leetcode.nvim`), **Codewars API v1**, and local **Exercism** workspaces—plus forge new zyBooks lessons locally for $0 using Ollama.

---

## Quick Start

```bash
# 1. Install backend & frontend dependencies
cd backend && uv sync
cd ../frontend && npm install && npm run build

# 2. Launch DevQuest (or use ./launch.sh / Desktop launcher)
./cli/devquest up
# Open http://127.0.0.1:8765

# 3. Jump straight into a Neovim lab in another terminal
./cli/devquest next             # next recommended lab
./cli/devquest next debugging   # practice Python pdb / Bash debugging
./cli/devquest stats            # print all 17 ASCII mastery progress bars
```

### Optional Arch / EndeavourOS AUR Practice Extras

```bash
yay -S --needed exercism-bin pacvim-git oh-my-git-git
```

## Running Automated Tests

```bash
# Backend + all 17 local graders + GitHub Repo Interview engine
cd backend && uv run pytest -v

# Frontend Vitest unit tests
cd frontend && npm test

# Playwright E2E tests (against running server)
cd frontend && npx playwright test
```

---

## Future Roadmap

- **Mobile App**: *In the future, I would like to turn DevQuest into a mobile app* so zyBooks micro-lessons, spaced-repetition mastery refreshes, and GitHub Repo Interview defense quizzes can be practiced anywhere on the go.

## License

Released under the [MIT License](LICENSE). In the future, I would like to turn DevQuest into a mobile app.
