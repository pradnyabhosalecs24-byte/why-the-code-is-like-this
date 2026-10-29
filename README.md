# Why The Code Is Like This (TraceWhy)

*HackFront India · PS T1.1*

TraceWhy reconstructs the reasoning behind engineering decisions from verifiable repository evidence. It imports a public GitHub repository into a **Neo4j knowledge graph** of commits, pull requests, review comments, issues, timeline events, docs, ADRs, files, functions and configuration keys. It extracts candidate **decisions**, works out whether each one is **current, superseded, disputed or unknown**, and answers "why" questions by **walking graph relationships to the evidence**. Every claim links back to the original GitHub record.

It is not a chatbot over embeddings. With the LLM switched off, the full pipeline still runs and produces answers using a deterministic, extractive composer. When the LLM is on, it only rewrites retrieved evidence into prose. Any claim it cites to evidence that doesn't exist is dropped.

---

## 1. How it works (the part to explain to judges)

```
GitHub REST API ──► snapshot (JSON) ──► buildGraph() ─────────────► Neo4j AuraDB
  commits+files       pure data          • code entities (regex)        nodes: Repository, File, Module,
  PRs+reviews                            • explicit references           Function, Configuration, Commit,
  issues+timeline                        • decision extraction           PullRequest, Issue, Incident,
  tree+file contents                     • entity resolution             Decision, Person, Evidence
                                         • temporal supersession

Question ──► parse (identifiers, #refs, keywords, intent)
         ──► SEEDS: exact code entities + full-text index (Cypher)
         ──► EXPAND: bounded multi-hop traversal over typed relationships (Cypher)
         ──► RANK: score spreads from seeds along edges × reliability of each edge
         ──► evidence pack [E1..En] + sufficiency gate ("is a reason actually stated?")
         ──► extractive composer or OpenAI (cited JSON) ──► citation validation
         ──► answer + confidence factors + graph path for every evidence card
```

**Why the graph matters:** evidence is ranked by *how it is connected* to the thing you asked about, not by word overlap. Take a question about `MAX_RETRIES`. The incident report that caused the change never mentions `MAX_RETRIES`. The system still reaches it, through `Configuration ← CONTAINS File ← CHANGED_BY Commit → DISCUSSED_IN PR → RELATED_TO Issue`. A test removes those relationships and shows that the same question can no longer reach the incident (`tests/integration/pipeline.test.js`, test "GRAPH MATTERS").

### Graph schema

| Node | Stable id | Key properties |
|---|---|---|
| Repository | `repo:owner/name` | url, defaultBranch, headSha, lastImportAt |
| File / Module | `file:repo:path` / `module:repo:dir` | path, language, existsAtHead |
| Function | `fn:repo:path#name` | name, kind (function/class), line |
| Configuration | `cfg:repo:path#key` | key, value (never from `.env*`), kind (config/constant) |
| Commit / PullRequest / Issue | `commit:repo:sha`, `pr:repo:N`, `issue:repo:N` | url, date, author, merged, labels |
| Evidence | `evidence:<hash>` | kind (commit_message, pr_description, pr_review_comment, issue_comment, doc_section, adr…), text, url, author, date |
| Decision | `decision:<hash>` | statement, rationale, alternatives (all **verbatim**), status, statusReason, extractionMethod |
| Incident | `incident:repo:…` | from incident/regression/outage labels, titles, or post-mortem docs |
| Person | `person:gh:login` or a repo-scoped `unlinked_name` | resolution |

Every node also has `nodeType`, `repo`, `importedAt` and a shared `:TW` label. A unique constraint on `TW.id` exists, plus one per label, and there's a full-text index over text fields. Run `npm run db:init` to create them all.

Relationships: `CONTAINS, CHANGED_BY, DISCUSSED_IN, INTRODUCED_BY, AFFECTS, AUTHORED_BY, RELATED_TO, SUPPORTED_BY, SUPERSEDES, REPORTED_IN, RENAMED_FROM`. **Every relationship stores `origin` and `method`:**

* `confirmed` comes from GitHub's structured data: PR commit lists, changed files, rename status, authors, timeline cross-references.
* `inferred` is parsed from text: `Fixes #12`, `(#34)` squash titles, SHA mentions, identifier mentions, revert messages, ADR status lines. These carry the evidence id and method that produced them.

Relationships are **never created just because two records share a keyword**. Name resolution uses exact matches only. If a name matches 2–3 entities, the link is marked `ambiguous`. If it matches more than 3, no link is made.

### Decisions and temporal reasoning

* **Extraction** (`services/extraction/decisions.js`) looks for decision language ("we decided", "switch to", "instead of", "limit X to 3", "deprecate"…) and pulls out verbatim sentences with an optional verbatim rationale ("because…", "to avoid…") and alternatives. ADRs are parsed into Context / Decision / Status. If you set `OPENAI_REFINE_DECISIONS=true`, the LLM can only *reject* candidates. It cannot rewrite them.
* **Supersession** (`services/temporal/supersession.js`). A newer record **never** supersedes an older decision just because it is newer. `SUPERSEDES` requires one of:
  * a git revert (`This reverts commit <sha>`)
  * an ADR status line (`Supersedes ADR-1` / `Superseded by ADR-2`)
  * change language **plus** an explicit `#N` or SHA reference to the older decision's source.
  
  If two decisions touch the same config key or function with change language but no explicit link, both are marked **disputed**, not superseded. If the replacing change was itself reverted, the original is reinstated.
* **Status** is one of: `current` (nothing replaces it and the affected code still exists at HEAD), `superseded`, `disputed`, or `unknown` (unmerged PR, no linked code, or the code has been deleted). Each status comes with a human-readable reason.

### Confidence

The confidence level is a rule-based **High / Medium / Low / Insufficient**, explained by five factors: *directness* (is the reason stated in the decision's own record?), *corroboration* (number of independent sources), *relationship reliability* (share of confirmed edges on the evidence paths), *evidence quality* (ADR/PR description > comments), and *temporal consistency*. The UI says plainly that this is **not a calibrated probability**.

### Honesty guarantees

* For "why" questions, the answer is only marked established if a retrieved record **states** a reason. Otherwise the headline reads *"The imported repository history does not establish the reason."* The related records are listed only as context.
* LLM output is JSON with `E#` citations. Any claim citing an unknown id is dropped, and the headline is overridden if retrieval found no reason. A test checks this with a fake LLM that invents a person and a reason.
* "Who introduced X?" answers use file-level history, following renames. The answer states that this is not line-level blame.

---

## 2. Folder structure

```
tracewhy/
├─ backend/                       Node.js + Express API
│  ├─ src/
│  │  ├─ app.js, server.js        Express app (security headers, CORS, JSON limit, errors)
│  │  ├─ config/env.js            Environment loading; reports which credentials exist, never their values
│  │  ├─ middleware/              Structured errors + log redaction, input validation, rate limiting
│  │  ├─ routes/api.js            REST endpoints (see §6)
│  │  └─ services/
│  │     ├─ github/               REST client (timeouts, retries, rate limits, pagination) + snapshot fetcher
│  │     ├─ parse/                Code-entity extraction, explicit reference extraction
│  │     ├─ extraction/           Decision + ADR extraction, optional LLM candidate filter
│  │     ├─ resolution/           Entity resolution (symbols, renames, people)
│  │     ├─ temporal/             Supersession detection and decision status
│  │     ├─ graph/                Schema, buildGraph (pure), Neo4j store (Cypher), memory store (tests)
│  │     ├─ retrieval/            Question parsing, graph ranking
│  │     ├─ answer/               Answer pipeline, confidence, OpenAI wrapper
│  │     └─ importer.js           Import jobs, progress, incremental snapshot cache, sweep
│  ├─ scripts/                    db:init (constraints/indexes), db:clear (remove one repo)
│  ├─ tests/unit, tests/integration, tests/fixtures
│  └─ .env.example
├─ frontend/                      React + Vite UI
│  └─ src/components/             Import panel, stats, Ask workspace, decisions, timeline, graph explorer
├─ docs/DEMO.md                   Judge demo script and example queries
└─ .vscode/tasks.json             One-click "TraceWhy: run app" and "TraceWhy: tests"
```

---

## 3. Requirements and credentials

* **Node.js 20 or newer** (`node -v`) and **VS Code**
* **Neo4j AuraDB** (the free tier is fine): **required**
* **GitHub personal access token**: strongly recommended. Without one, GitHub allows only 60 requests per hour.
* **OpenAI API key**: optional. Without it, answers are extractive.

All credentials live only in `backend/.env`. The browser talks to `/api` through the Vite proxy and never sees a key.

### Configure Neo4j AuraDB

1. Go to <https://console.neo4j.io>, then **New instance → AuraDB Free**.
2. Download or copy the credentials shown **once**: the connection URI (`neo4j+s://xxxx.databases.neo4j.io`), the username (`neo4j`) and the password.
3. Put them into `backend/.env` as `NEO4J_URI`, `NEO4J_USERNAME` and `NEO4J_PASSWORD`. Keep `NEO4J_DATABASE=neo4j`.
4. Run `npm run db:init` (see below). It prints the constraints and indexes it creates.
5. Free instances **pause after a few days idle**. If health says "Cannot reach Neo4j", resume the instance in the Aura console.

### GitHub token

GitHub → Settings → Developer settings → Personal access tokens → *Fine-grained*. Choose "Public repositories (read-only)" and set the token as `GITHUB_TOKEN`.

### OpenAI (optional)

Set `OPENAI_API_KEY`. `OPENAI_MODEL` defaults to `gpt-4o-mini` and can be any chat model that supports JSON mode.

---

## 4. Run it locally from VS Code

```bash
# 1. open the folder in VS Code, then in the terminal (Ctrl+`):
npm run install:all

# 2. credentials
cp backend/.env.example backend/.env      # Windows PowerShell: Copy-Item backend\.env.example backend\.env
#    edit backend/.env (Neo4j, GitHub token, optional OpenAI key)

# 3. create constraints + indexes in Aura
npm run db:init

# 4. run the tests
npm test

# 5. start the app (two terminals, or Terminal → Run Task → "TraceWhy: run app")
npm run dev:backend      # http://localhost:4000
npm run dev:frontend     # http://localhost:5173  ← open this
```

The header shows whether the graph, GitHub token and LLM are configured. Missing credentials show up as clear warnings, not crashes.

**Offline fallback:** `GRAPH_BACKEND=memory` runs the same pipeline on an in-process graph. Data is lost on restart. Use it for testing only; the real demo uses Neo4j.

**Neo4j contract test:** with Aura configured, run `TEST_NEO4J=1 npm test --prefix backend`. On PowerShell: `$env:TEST_NEO4J=1; npm test --prefix backend`. This runs the supersession and refusal scenarios against your real database, then cleans up.

---

## 5. Tests

`npm test` runs 42 tests: 41 run offline, and one Neo4j contract test is skipped unless enabled.

* **Unit:** reference parsing, code and config extraction (`.env` values are never stored), decision and ADR extraction, the supersession rules (including "newer does not automatically supersede", disputed status, and a revert of a revert), the GitHub client (pagination, 5xx retries, rate-limit wait and failure, 404s, refusing non-GitHub URLs), LLM citation validation, confidence, and log redaction.
* **Integration:** the full pipeline on a clearly labelled **synthetic fixture** (`tests/fixtures/snapshot.js`, used only by tests and never in the demo). It includes:
  * **SUPERSEDED**: an older `cache.ttlSeconds` decision is superseded by a later PR that explicitly replaces it. The answer shows both decisions, the dates and the citations.
  * **REFUSAL**: "Why was legacyFormatter not migrated?" returns *insufficient evidence*, even when a fake LLM tries to invent a reason.
  * **GRAPH MATTERS**: removing relationships changes what is retrieved.
  * Idempotent re-import, sweeping stale records, incremental merge, and the HTTP API.
  * The real import job run against a simulated GitHub REST API.

---

## 6. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Which credentials are present (booleans only) + graph connectivity |
| POST | `/api/repos/import` `{url, mode: "incremental"\|"full"}` | Start an import job (returns 202 + job) |
| GET | `/api/jobs/:id` | Import progress, stage, errors |
| GET | `/api/repos` | Imported repositories |
| GET | `/api/repos/:owner/:name/stats` | Node, relationship, provenance and status counts |
| GET | `/api/repos/:owner/:name/decisions` | Decisions with supersession links |
| GET | `/api/repos/:owner/:name/timeline` | Dated decisions, PRs, issues, incidents |
| GET | `/api/repos/:owner/:name/graph[?node=id]` | Overview or neighbourhood subgraph |
| GET | `/api/repos/:owner/:name/nodes?id=` | Full properties of one node |
| POST | `/api/repos/:owner/:name/ask` `{question, model?, useLlm?}` | Evidence-grounded answer |
| DELETE | `/api/repos/:owner/:name` `{confirm: "owner/name"}` | Safely remove one repository's data |

---

## 7. Import behaviour and limits

* **Incremental** (the default): fetches only commits, PRs and issues newer than the last import. It merges them into a cached snapshot (`backend/.cache/`), rebuilds the graph so supersession sees the full history, upserts with `MERGE` on stable ids (no duplicates), then **sweeps** anything no longer produced.
* **Full**: clears that repository's data first, then rebuilds it.
* The limits in `.env` (`IMPORT_MAX_*`) keep imports quick. File contents are read for docs, configs and source files up to `IMPORT_MAX_FILES`. Vendored, lock and build files are skipped.
* Code entity extraction is regex-based (JS/TS, Python, Go, Java/Kotlin/C#, Ruby, Rust, JSON/YAML/TOML/INI/.env). It is explainable but not a full parser. Its provenance method is recorded as `regex_symbol_extraction`.
* Known limits: no line-level blame, no private repositories, and decision extraction depends on how explicitly a team writes its reasoning. When the reasoning isn't written down, TraceWhy says so.

See **docs/DEMO.md** for the judge walkthrough.
