# 📖 StudySnap — AI Study Helper

StudySnap turns a student's notes, PDFs, DOCX files, lecture transcripts or pasted text into a complete study workspace: **AI summary, key concepts, flashcards, practice quizzes, an AI tutor and personal notes** — with real accounts, real persistence, real progress tracking and full data isolation between users.

This is a **fully functional full-stack application**, not a UI prototype. Every route is backed by Express + SQLite; every button calls a real API.

---

## Quick start

```bash
npm install
cp .env.example .env        # then edit .env
npm start                   # → http://localhost:3000
```

A demo account is seeded automatically: **demo@studysnap.app / studysnap123**

Run the automated end-to-end test (49 checks covering the complete 20-step user flow, ownership isolation, scoring math, persistence and more):

```bash
npm run test:e2e            # server must be running on :3000
```

---

## 1. Configure the AI (required for real AI output)

StudySnap talks to **any OpenAI-compatible Chat Completions endpoint** — OpenAI, Groq, Together, OpenRouter, local Ollama, etc.

Set in `.env` (server-side only, never exposed to the browser):

```
AI_API_KEY=sk-...                # your key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

**If no key is configured** (or the AI service fails / daily free limit is hit), the app does NOT fake AI output. It falls back to a clearly-labelled local heuristic extractor (`generatedBy: "heuristic"`, badge "⚡ Offline extraction" in the UI) so the product keeps working, and the difference is always visible to the user. The E2E suite passes in this mode; with a key set, the same pipeline sends real requests and validates the structured JSON before saving.

---

## 2. Architecture

```
studysnap/
├── server.js                  Express app, security headers, rate limit, SPA fallback
├── server/
│   ├── db.js                  SQLite schema (WAL, FKs) + demo seed
│   ├── middleware.js          JWT auth (httpOnly cookie), ownership helpers
│   ├── pipeline.js            Processing pipeline: validate → clean → analyse → persist
│   ├── ai.js                  AI service (OpenAI-compatible, structured JSON, server-only)
│   ├── fallback.js            Offline heuristic generator (clearly labelled, never fake "AI")
│   └── routes/
│       ├── auth.js            register/login/logout/reset/settings/export/delete account
│       ├── sets.js            study sets CRUD, search/filter/sort, regenerate, stats
│       ├── flashcards.js      decks + cards CRUD, Known / Need Review status
│       ├── quizzes.js         quiz generation, submission grading, attempts
│       ├── tutor.js           AI tutor with study-set context + 5 modes
│       └── progress.js        progress dashboard, prioritised review queue, notes
├── public/
│   ├── index.html             SPA shell
│   ├── css/styles.css         Design system (coral/teal/cream, serif headings — per reference UI)
│   └── js/app.js              Hash-router SPA: landing, auth, dashboard, library, workspace,
│                              flashcards, quizzes, tutor, notes, review, progress, settings
└── tests/e2e.js               49-check end-to-end suite
```

### Database entities
`users`, `study_sets`, `summaries`, `concepts`, `decks`, `flashcards`, `quizzes`, `quiz_questions`, `quiz_attempts`, `notes`, `activity`, `usage_log` — all foreign-keyed with cascade deletes.

### Security
- bcrypt (cost 10) password hashing, JWT in **httpOnly** SameSite cookie (7-day session)
- Every set/deck/card/quiz/note query verifies ownership → 403 otherwise (verified by E2E)
- Zod validation on auth input; AI output validated before saving; quiz correct answers **never sent to the client before submission**
- Upload limits: 10 MB, PDF/TXT/DOCX/MD only (configurable via env)
- Security headers, per-IP rate limiting, no stack traces in responses

---

## 3. Features checklist

| Area | What works |
|---|---|
| Auth | Register, login, logout, password reset, persistent sessions, account deletion, JSON data export |
| Study set creation | Paste text, upload PDF/TXT/DOCX (drag-and-drop), progress pipeline screen, validation of empty/short/oversized/unsupported input |
| Summaries | 4 styles (Quick / Standard / Detailed / Exam-focused), regenerate, copy, download, inline edit |
| Key concepts | Concept → simple explanation → details → example |
| Flashcards | Flip, Known / Need Review marking, prev/next, shuffle, restart, multi-deck create/rename/delete, add/edit/delete own cards, "12 / 30 cards" progress |
| Quizzes | MC / True-False / Short answer, difficulty & count selection, real grading (incl. AI-graded short answers when key set), score/percentage/explanations/topics needing improvement, answers hidden until submit |
| AI Tutor | 5 modes (Explain Simply / Detail / Example / Quiz Me / Help Me Understand), Current-Study-Set vs General scope, refuses to invent facts beyond material |
| Notes | Per set, auto-save, persisted |
| Dashboard | Real greeting, recent sets, stats (sets, reviews, attempts, avg score, topics mastered/needing review) — all from actual activity |
| Review | Prioritised queue: Need Review → frequently missed → stale cards |
| Progress | Activity heat strip (14 days), card status, topic mastery |
| Settings | Profile, password, study preferences, appearance, data export/delete |
| Free tier | 25 AI generations/day, 5 study sets, unlimited notes — paid plans labelled "coming soon" |
| Responsive | Mobile bottom navigation, thumb-friendly study controls, no horizontal scrolling |
| Accessibility | Semantic HTML, labels, focus states, keyboard-operable flashcards, aria-live regions, reduced-motion support |

---

## 4. Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Server port |
| `JWT_SECRET` | dev fallback | **Set a long random string in production** |
| `AI_API_KEY` | — | Enables real AI generation |
| `AI_BASE_URL` | https://api.openai.com/v1 | Any OpenAI-compatible endpoint |
| `AI_MODEL` | gpt-4o-mini | Model name |
| `FREE_DAILY_AI_CALLS` | 25 | Daily generation limit per user |
| `FREE_MAX_STUDY_SETS` | 5 | Study set cap on free plan |
| `MAX_UPLOAD_MB` | 10 | Upload size limit |
| `NODE_ENV` | development | `production` enables Secure cookies |

---

## 5. Honest verification notes

- The E2E suite (49 checks) passes end-to-end, covering the full 20-step requirement list **in the offline-extraction mode**, because this build environment has no usable LLM API key (the provided sandbox key is not OpenAI-compatible and cannot reach an OpenAI-compatible endpoint).
- The real-AI code path is implemented and exercised at the interface level (structured JSON request/response + zod-style validation + failure fallback), but **no live AI call was executed in this environment** — set `AI_API_KEY` to activate it.
- What remains unverified live: actual model quality of generated summaries/cards/quizzes, and AI-graded short answers.
