# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Engineering Dashboard — a full-stack team performance tracker with gamification. Engineers earn XP points across three work streams based on weekly metrics. Features a public leaderboard, individual profile pages, admin panel, and AI token usage tracking.

## Stack

- **Frontend**: React 18 + Vite, React Router v6, Recharts — served on port 3000
- **Backend**: Python FastAPI + SQLite (no ORM, raw `sqlite3`) — served on port 8000
- **Auth**: query param `?password=` on protected endpoints; `ADMIN_PASSWORD` global loaded from `config` table at startup

## Running Locally

```bash
# Backend
cd backend && python -m uvicorn main:app --port 8000 --reload

# Frontend
cd frontend && npm run dev
```

## Deployment

- **GitHub**: https://github.com/maico15/dashbord
- **Frontend (Render.com)**: https://dashbord-frontend-hb0m.onrender.com
- **Backend (Render.com)**: https://dashbord-5u0i.onrender.com
- Build scripts use `node node_modules/vite/bin/vite.js` (not `npx vite`) to avoid Render symlink permission errors
- `frontend/public/_redirects` contains `/*  /index.html  200` for SPA routing on Render
- `VITE_API_URL` env var must be set on Render frontend service to point at the backend URL

## Architecture

### Backend (`backend/main.py`)

Single-file FastAPI app. Key patterns:

- `init_db()` + `seed_data()` + `_load_password()` called in lifespan on startup
- `parse_streams(val)` — parses `stream` field which can be a plain string `"dev"` (legacy) or JSON array `'["dev","support"]'` (new multi-stream)
- Score calculation: `calc_dev()`, `calc_support()`, `calc_docs()` read rules from `score_rules` table dynamically
- `ADMIN_PASSWORD` global is mutated at runtime by `POST /api/admin/change-password` and persisted to `config` table

**SQLite tables**: `team_members`, `dev_metrics`, `support_metrics`, `docs_metrics`, `score_rules`, `config`, `ai_usage_cache`, `weekly_tasks`

**Key endpoints**:
- `GET /api/leaderboard` — 8-week XP totals with breakdown and badges
- `GET /api/metrics/{dev|support|docs}` — stream tab data
- `GET/POST /api/engineers/{id}/profile` and `/tasks`
- `GET /api/ai-usage` — Anthropic Admin API data with 1h SQLite cache; falls back to mock
- `GET/POST/PUT/DELETE /api/team` — team member CRUD (admin)
- `PUT /api/admin/metrics/{stream}/{week}/{member_id}` — metric entry (admin)

### Frontend (`frontend/src/`)

- `api/client.js` — all API calls; uses `VITE_API_URL` env var in production, Vite proxy (`/api → localhost:8000`) in dev
- `pages/Dashboard.jsx` — 4 tabs: Development, Support, Documentation, AI Usage
- `pages/Admin.jsx` — 5 sections: Configuration, Team, Metrics, Rules, Security
- `pages/EngineerProfile.jsx` — profile + 8-week XP chart + weekly task log
- `components/Leaderboard.jsx` — clickable rows → `/engineer/:id`

## Work Streams & Scoring

Three streams: **Development** (`dev`), **Support** (`support`), **Documentation** (`docs`). Engineers can belong to multiple streams (stored as JSON array in `team_members.stream`). Points per action are configurable in admin → Rules.

**Badges**: MVP (top scorer), Streak (3 rising weeks), Shield (support, zero SLA breaches in 4w), Scribe (docs, 3+ docs created this week)

## Admin Panel

Route `/admin`, default password `admin123`. Password is persisted in `config` table and survives restarts. Change via admin → Security section.

## Team Members (DO NOT CHANGE THESE NAMES)

- Andrey Brunetkin (stream: dev, initials: AB)
- Andrey Pogrebnyak (stream: support, initials: AP)
- Evgeniy Vinogradov (stream: docs, initials: EV)

These are the real team members. Never replace them with fake/mock names. If the database already contains old seed data, delete `backend/dashboard.db` to force a reseed with these names.

## Known Issues / Planned Work

- **Slack integration**: daily task sync from a Slack channel (not yet implemented)
- **Password change**: implemented but backend error messages recently migrated to English — verify end-to-end
- **Multi-stream tags**: implemented; existing DB rows with plain `stream='dev'` strings are handled by `parse_streams()` transparently
