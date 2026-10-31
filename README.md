# Why The Code Is Like This (TraceWhy)

*HackFront India · PS T1.1*

TraceWhy explains **why code exists**: which historical decisions caused it, who made them, what evidence supports them, and whether they still hold. It imports a public GitHub repository into a **Neo4j knowledge graph** of commits, pull requests, review comments, issues, timeline events, docs, ADRs, files, functions and configuration keys. It extracts **decision records**, determines whether each one is **active, superseded, disputed or unknown**, and answers questions by **walking graph relationships to the evidence**. Every claim is cited, labelled **fact** or **inference**, and can be opened at its source.

When the evidence doesn't say why, TraceWhy says so instead of guessing.

```bash
npm run install:all      # install everything (Windows, macOS, Linux)
npm run demo             # local demo: synthetic data, no credentials needed → http://localhost:5173
npm test                 # backend + frontend tests
```

---

## 1. Quick start on Windows + VS Code

Requirements: **Node.js 20 or newer** (`node -v`), **Git**, **VS Code**.

1. Open the project folder in VS Code and open a terminal with ``Ctrl+` ``.
2. Install everything:
   ```powershell
   npm run install:all
   ```
3. **Try it without any accounts** (synthetic data):
   ```powershell
   npm run demo
   ```
   Open http://localhost:5173. A banner reads "Local demo mode", and the repository is labelled "Synthetic demonstration data".
4. **Use real repositories.** First configure your credentials (§3):
   ```powershell
   Copy-Item backend\.env.example backend\.env
   notepad backend\.env          # fill in Neo4j, GitHub token, optional OpenAI key
   npm run db:init               # create constraints + indexes in Neo4j
   npm run dev                   # backend + frontend → http://localhost:5173
   ```
   Paste a public GitHub URL into **Import repository**.

VS Code alternative: **Terminal → Run Task → "TraceWhy: run app"** (or "TraceWhy: tests").

## 2. Commands

| Command (run in the project root) | What it does |
|---|---|
| `npm run install:all` | Install root, backend and frontend dependencies |
| `npm run demo` | **Local demo**: in-memory graph seeded with the synthetic repository. Needs no credentials. |
| `npm run dev` | Backend (uses `backend/.env`) and frontend together |
| `npm run dev:backend` / `npm run dev:frontend` | Start each one on its own (ports 4000 / 5173) |
| `npm run db:init` | Create Neo4j constraints and indexes (idempotent) |
| `npm run seed:demo` | Load the **synthetic** demo repository into Neo4j (clearly labelled; idempotent) |
| `npm run db:clear --prefix backend -- owner/repo` | Safely remove one repository's data |
| `npm test` | All backend tests (node:test) + frontend tests (Vitest) |
| `npm run test:e2e` | Browser end-to-end tests in demo mode (first time only: `npx playwright install chromium`) |
| `npm run build` | Production build of the frontend (`frontend/dist`) |

## 3. Credentials and Neo4j AuraDB setup

All secrets live only in `backend/.env`, which is git-ignored. The browser talks to `/api` through the Vite proxy and only ever sees **booleans** saying which credentials are present. On startup, the backend validates the configuration and reports missing, placeholder or malformed values, without printing them.

| Variable | Required | Notes |
|---|---|---|
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` | yes (except demo) | From Aura. URI looks like `neo4j+s://xxxx.databases.neo4j.io` |
| `GITHUB_TOKEN` | recommended | Fine-grained token, "Public repositories (read-only)". Without it GitHub allows 60 requests/hour |
| `SARVAM_API_KEY`, `SARVAM_MODEL` | optional | **Sarvam AI** explains the retrieved evidence. Default model `sarvam-105b`. Get a key at <https://dashboard.sarvam.ai> |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | optional | Alternative LLM. Default model `gpt-4o-mini` |
| `LLM_PROVIDER` | optional | `sarvam`, `openai` or `none`. If empty: Sarvam if its key is set, else OpenAI, else none (extractive answers that only quote evidence) |
| `OPENAI_REFINE_DECISIONS` | optional | `true` lets the LLM *reject* weak decision candidates during import. It can never rewrite them |
| `IMPORT_MAX_*` | optional | Limits per import, to keep imports quick and within rate limits |

**Neo4j AuraDB:**
1. Go to <https://console.neo4j.io>, then **Create instance → AuraDB Free**.
2. Copy the credentials shown **once**: the connection URI, username `neo4j` and the password. Put them in `backend/.env`.
3. Run `npm run db:init`. It prints every constraint and index it creates.
4. Optional: run `npm run seed:demo` to load the synthetic repository into Aura as well.
5. Free instances **pause when idle**. If the header says "Graph not ready", resume the instance in the Aura console.

## 4. Architecture

```
GitHub REST API ─► snapshot (plain JSON) ─► buildGraph() (pure) ──────────► Neo4j AuraDB
 commits + changed files   resilient fetch:      • code entities (regex, provenance)    MERGE on stable ids
 PRs + reviews + comments  pagination, retries,  • explicit references (#N, sha, paths)  constraints + indexes
 issues + timeline         rate limits, timeouts • decision extraction (verbatim)        full-text index
 tree + file contents      skip-and-count        • entity resolution (exact, renames)
                                                 • MOTIVATED_BY, supersession, status, confidence

Question ─► parse (identifiers, #refs, keywords, intent)
         ─► SEEDS: exact code entities, #PR/#issue, sha, full-text index      (Cypher)
         ─► EXPAND: bounded multi-hop traversal over typed relationships      (Cypher)
         ─► RANK: score spreads from seeds × reliability of each edge × hop decay
         ─► evidence pack [E1..En] ─► sufficiency gate ("does a record state a reason?")
         ─► extractive composer or LLM: Sarvam AI / OpenAI (JSON with citations) ─► citation validation
         ─► answer: fact/inference claims · reasoning chain · conflicts · unknowns · confidence
```

**Why the graph matters:** evidence is ranked by *how it is connected* to what you asked about, not by word overlap. An incident report that never mentions `MAX_RETRIES` is still found, because the path runs config key → file → commit → PR → *fixes* → issue. The test "GRAPH MATTERS" removes those relationships and shows that the same question then misses it.

## 5. Knowledge-graph schema

| Node | Stable id | Notes |
|---|---|---|
| Repository | `repo:owner/name` | `synthetic: true` for the demo dataset |
| File | `file:repo:path` | `existsAtHead`, language |
| Module | `module:repo:dir` | also labelled `:CodeEntity` |
| Function | `fn:repo:path#name` | function or class; also `:CodeEntity` |
| Configuration | `cfg:repo:path#key` | config keys and UPPER_SNAKE constants; also `:CodeEntity`; values from `.env*` files are never stored |
| Commit / PullRequest / Issue | `commit:repo:sha`, `pr:repo:N`, `issue:repo:N` | url, date, author, merged, labels |
| Evidence | `evidence:<hash>` | the citable unit: commit message, PR description, review comment, issue comment, doc section, ADR. Stores url + `urlStatus` |
| Decision | `decision:<hash>` | statement, rationale, alternatives (**verbatim**), status + reason, confidence score + basis |
| Incident | `incident:repo:…` | from incident / outage / regression / sev labels or titles, or post-mortem docs |
| Person | `person:gh:login` | commit authors without a GitHub account are kept as repo-scoped *unlinked* names; synthetic people are scoped to the demo repo |

Every node also has `nodeType`, `repo`, `importedAt` and a shared `:TW` label. There is a unique constraint on `TW.id` and one per label, plus indexes on `repo` and `(repo, nodeType)` and a full-text index (`npm run db:init`).

| Relationship | Meaning |
|---|---|
| `CONTAINS` | repository → module → file → function/config; record → evidence |
| `CHANGED_BY` | file → commit that modified it (the brief's `MODIFIED_IN`), with status and line counts |
| `RENAMED_FROM` | file → its previous path (GitHub rename status) |
| `DISCUSSED_IN` | commit → pull request |
| `INTRODUCED_BY` | decision → the record it was extracted from |
| `SUPPORTED_BY` | decision → evidence that states it |
| `MOTIVATED_BY` | decision → issue/incident that its PR or commit explicitly resolves |
| `AFFECTS` | decision/incident → file, function or config key |
| `AUTHORED_BY` | record / evidence / decision → person |
| `RELATED_TO` | explicit references (`Fixes #N`, `#N`, SHA, identifier mentions, timeline cross-references, possible conflicts) |
| `SUPERSEDES` | newer decision → older decision (explicit evidence only) |
| `REPORTED_IN` | incident → issue or post-mortem document |

**Every relationship stores `origin` and `method`.** `confirmed` means it came from GitHub's structured data (PR commit lists, changed files, renames, authors, timeline events). `inferred` means it was parsed from text, and the evidence id and method are recorded. **No relationship is created just because two records share a keyword.** Name resolution uses exact matches only. If a name matches 2–3 entities, the link is marked `ambiguous`. If it matches more than 3, no link is made.

## 6. Decisions, temporal reasoning and confidence

* **Extraction** (`services/extraction/decisions.js`) finds sentences with decision language ("we decided", "switch to", "instead of", "limit X to 3", "deprecate"…) and keeps them **verbatim**. It also keeps a verbatim rationale ("because…", "to avoid…") and alternatives ("instead of…") when present. ADRs are parsed into Context / Decision / Status. Text addressed to an AI ("ignore previous instructions…") is never extracted.
* **Supersession** (`services/temporal/supersession.js`). A newer record **never** supersedes an older decision just because it is newer. `SUPERSEDES` requires one of:
  * a git revert (`This reverts commit <sha>`)
  * an ADR status line (`Supersedes ADR-1` / `Superseded by ADR-2`)
  * change language **plus** an explicit `#N` or SHA reference to the older decision's source.
  
  If a later decision changes the same config key or function but never references the earlier one, both are marked **disputed**, and the reason is explained. If the replacing change was itself reverted, the original becomes active again.
* **Status:**
  * `active`: nothing replaces it, and the affected code still exists (or an ADR is Accepted)
  * `superseded`
  * `disputed`
  * `unknown`: unmerged PR, no linked code, or the code was deleted
  
  Each status comes with a human-readable reason.
* **Per-decision confidence (0–100, ordinal points, *not a probability*):**
  * +30 if the rationale is stated verbatim
  * +20 / +12 / +8 for source quality (ADR or PR description / review, commit or doc / comments)
  * +10 for each additional supporting record (max +20)
  * +10 if motivated by a linked issue or incident
  * +10 if the affected code is linked by a confirmed edge (+5 if only by an inferred one)
  * status: active +10, superseded 0, unknown −5, disputed −15
  
  The level is **high** at ≥70, **medium** at ≥45, otherwise **low**. The breakdown is stored as `confidenceBasis` and shown in the UI.
* **Answer confidence:** High / Medium / Low / Insufficient, explained by five factors: directness, corroboration, relationship reliability (share of confirmed edges), evidence quality and temporal consistency.

## 7. Question answering and honesty guarantees

Supported question shapes include: why a function was introduced, why a dependency was selected, which issue or PR motivated a change, who proposed it, what evidence supports it, whether it was superseded, what changed afterwards, which code is affected, and what is known vs uncertain.

Each answer contains:
* **claims**, each with `E#` citations and a **fact** / **inference** label
* a **reasoning chain** from code entity to decision to evidence
* **conflicting evidence**, explained rather than resolved by date
* **unknowns** (missing rationale, alternatives, links or authors)
* a **graph path** on every evidence card
* the supporting subgraph

The guarantees:
* For "why" questions, an answer is only marked established if a retrieved record **states** a reason. Otherwise the headline is *"The imported repository history does not establish the reason."* Related records are shown only as context.
* LLM output must be JSON with `E#` citations. Any claim citing an unknown id is dropped, and the headline is overridden when retrieval found no stated reason.
* Repository text is **untrusted data**:
  * evidence containing instructions aimed at an AI is flagged, never used as a rationale, and not sent to the LLM
  * the system prompt tells the model to ignore instructions found inside evidence
* Source links are kept only if they are `https://github.com/...` or point to TraceWhy's synthetic-record viewer. Other links are dropped and shown as **"link unavailable"**. People, dates, issue numbers and commits are never invented. Missing authors appear as "author not established".
* "Who introduced X?" uses file-level history and follows renames. The answer says that this is not line-level blame.
* Ambiguous questions are flagged: vague questions are asked to be more specific, and identifiers defined in several files are listed.

## 8. Demo mode and the synthetic dataset

`backend/demo/syntheticRepo.js` is a **clearly labelled, fictional, deterministic** repository history (`demo/synthetic-checkout`). It is **separate from the test fixtures** and covers every scenario in the brief:

| Scenario | Try asking |
|---|---|
| Feature introduced to solve a documented issue | *Why was the Idempotency-Key added to createPayment?* |
| Dependency selected for a stated reason | *Why was ioredis selected?* |
| Bug fixed after a production incident | *Why is MAX_RETRIES 3?* |
| Decision superseded by a newer, evidenced decision | *Has the SESSION_TTL_MINUTES decision been superseded?* (and ADR 1 → ADR 2) |
| Disputed decision with conflicting evidence | *Why is GATEWAY_TIMEOUT_MS 12000?* |
| Question with no available evidence | *Why was legacyCsvExport not migrated?* |
| File with incomplete history | `src/legacy/csvExport.js` (its commit has no change details) |
| Prompt-injection text in an issue comment | shown on Issue #7, flagged and ignored |
| Renamed file / unlinked author | *Who introduced createPayment?* |

How it is kept honest:
* Every synthetic node has `synthetic: true` and lives under its own repository id. That id cannot be imported from GitHub, and synthetic people are scoped to it.
* Synthetic "source" links open TraceWhy's own viewer (`/api/demo/records/...`), which carries a **"SYNTHETIC DEMO RECORD"** banner. They never point to github.com.
* The UI shows a "Synthetic demonstration data" banner and badges. In demo mode, a "Local demo mode" banner lists which integrations are **not** active.

## 9. Tests

`npm test` runs **78 backend tests** (77 pass offline; 1 is skipped unless Neo4j is configured) and **10 frontend tests**. `npm run test:e2e` runs **8 browser tests** (desktop + mobile) against the app in demo mode. See [`docs/TESTING.md`](docs/TESTING.md) for how each scenario in the brief maps to a named test.

* **Unit:** parsing, code and config extraction, decision and ADR extraction, supersession rules, GitHub client (pagination, retries, rate limits, timeouts, 404/401), LLM citation validation, confidence, log redaction.
* **Integration:** the full pipeline, the import job against a simulated GitHub API (empty repository, partial failure, duplicates), question answering on the synthetic dataset, graph integrity, API validation and security.
* **Frontend (Vitest + Testing Library):** import flow and failure, asking, insufficient evidence, loading and error states, superseded decisions, empty states, demo labelling, link sanitising.
* **End-to-end (Playwright):** the real app in demo mode: overview, asking, opening an evidence link, the graph inspector, superseded decisions, import errors, responsive layout.
* **Real Neo4j:** `$env:TEST_NEO4J=1; npm test --prefix backend` (PowerShell) runs the supersession and refusal scenarios against your Aura instance, then cleans up.

External services are mocked **only in tests**. The app itself never fakes a database, GitHub or OpenAI response.

## 10. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Credential presence (booleans), config errors/warnings, demo mode, graph connectivity |
| POST | `/api/repos/import` `{url, mode}` | Start an import job (202). `mode`: `incremental` (default) or `full` |
| GET | `/api/jobs/:id` | Stage, progress, and fetched / processed / skipped counts |
| GET | `/api/repos` | Imported repositories (synthetic ones flagged) |
| GET | `/api/repos/:owner/:name/stats` · `/decisions` · `/timeline` · `/graph[?node=]` · `/nodes?id=` | Dashboard, decisions, timeline, graph, node details |
| POST | `/api/repos/:owner/:name/ask` `{question, model?, useLlm?}` | Evidence-grounded answer |
| DELETE | `/api/repos/:owner/:name` `{confirm: "owner/name"}` | Remove one repository's data |
| GET | `/api/demo/records/...` | Read-only viewer for synthetic records |

Errors are always `{error: {code, message}}`, and internal details are never exposed. Requests are rate-limited per IP (imports 6/min, questions 30/min).

## 11. Folder structure

```
├─ backend/                     Node.js + Express API
│  ├─ src/config/               env loading + validation (never prints secrets)
│  ├─ src/middleware/           structured errors + log redaction, validation, rate limiting
│  ├─ src/routes/               REST API, synthetic-record viewer
│  ├─ src/services/github/      REST client (timeouts, retries, rate limits, pagination) + resilient fetcher
│  ├─ src/services/parse/       code-entity + explicit-reference extraction
│  ├─ src/services/extraction/  decisions + ADRs, prompt-injection filter, optional LLM filter
│  ├─ src/services/resolution/  entity resolution (symbols, renames, people)
│  ├─ src/services/temporal/    supersession + status
│  ├─ src/services/graph/       schema, buildGraph (pure), Neo4j store (Cypher), memory store
│  ├─ src/services/retrieval/   question parsing, graph ranking
│  ├─ src/services/answer/      answer pipeline, confidence, OpenAI wrapper
│  ├─ src/services/importer.js  jobs, progress, counts, incremental cache, sweep
│  ├─ demo/                     SYNTHETIC demo dataset + seeding (not test data)
│  ├─ scripts/                  db:init, seed:demo, db:clear, demo launcher
│  └─ tests/                    unit/, integration/, fixtures/ (test-only), helpers/
├─ frontend/                    React + Vite (components, Vitest tests in src/test/)
├─ e2e/                         Playwright end-to-end tests
├─ docs/DEMO.md, docs/TESTING.md
├─ scripts/run.js               cross-platform launcher for `npm run demo` / `npm run dev`
└─ .vscode/tasks.json
```

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| Header says **backend offline** | Start the backend (`npm run dev` or `npm run demo`). Check that port 4000 is free: `netstat -ano \| findstr :4000` |
| **Graph not ready / Cannot reach Neo4j** | Check `NEO4J_URI` (`neo4j+s://…`) and the password. Resume a paused Aura instance. Corporate Wi-Fi may block port 7687, so try a phone hotspot |
| **Neo4j rejected the credentials** | Re-copy the password from the Aura credentials file. Reset it in Aura if lost |
| **GitHub rate limit reached** | Add `GITHUB_TOKEN`, or wait until the reset time shown. Lower `IMPORT_MAX_*` |
| **Repository not found** | Only public repositories are supported. Check the owner/name spelling |
| Import finished but **skipped > 0** | Some comments, timelines or files failed or hit a limit. The rest was imported. The job lists samples |
| Answers are "extractive" | No LLM key is set (`SARVAM_API_KEY` / `OPENAI_API_KEY`), or the LLM call failed. Answers stay evidence-only. Check the header's LLM pill and the backend log |
| `npm run test:e2e` says the browser is missing | Run `npx playwright install chromium` once |
| PowerShell blocks npm scripts | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Ports in use | Set `PORT` in `backend/.env`; run Vite with `npm run dev --prefix frontend -- --port 5174` |

## 13. Limitations and design decisions

* **Regex code entities.** These are explainable and cover many languages, but they are not a full parser. Their provenance is recorded as `regex_symbol_extraction`. Where entities can't be extracted reliably (unsupported languages, generated files), none are created.
* **No line-level blame.** "Who introduced" answers are file-level and follow renames, and they say so.
* **Decision extraction depends on written reasoning.** Teams that don't write down why get "not established" answers. That is by design.
* **Explicit-only supersession.** Some real reversals are reported as *disputed* instead of *superseded*. We prefer a visible uncertainty to a wrong history.
* **Bounded imports** (`IMPORT_MAX_*`) keep imports within API limits. Incremental imports merge new records into a cached snapshot (`backend/.cache/`), rebuild the graph so supersession sees the whole history, and sweep stale records.
* **Rule-based confidence.** Levels and scores are ordinal and explained, not calibrated probabilities.
