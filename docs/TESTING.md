# Test map (brief §8)

Run: `npm test` (backend + frontend), `npm run test:e2e` (browser, demo mode).
Result at handover: backend **77 passed, 0 failed, 1 skipped** (real-Neo4j contract test, runs with `TEST_NEO4J=1` and Aura credentials) · frontend **10 passed** · e2e **8 passed**.

| Brief scenario | Test (file › name) |
|---|---|
| **A. Ingestion** | |
| Valid public repository | `scenarios.ingestion` › valid public repository imports and reports fetched / processed / skipped; `import` › import job ingests GitHub data… |
| Invalid repository URL | `scenarios.ingestion` › invalid repository URL is rejected…; `parsing` › input validation…; e2e › ingestion failure is reported… |
| Nonexistent repository | `scenarios.ingestion` › nonexistent repository fails with a clear error |
| Empty history | `scenarios.ingestion` › repository with empty history completes with zero records |
| Paginated history | `githubClient` › paginate follows next links and respects max |
| Duplicate ingestion | `scenarios.ingestion` › duplicate ingestion does not create duplicate nodes; `pipeline` › building twice is idempotent |
| API rate limiting | `githubClient` › waits for short rate-limit resets…; `scenarios.ingestion` › API rate limiting stops the import… |
| Network timeout | `scenarios.ingestion` › network timeout is reported as GITHUB_TIMEOUT after retries |
| Missing / malformed credentials | `scenarios.ingestion` › missing or malformed credentials are reported without exposing them |
| Partial ingestion failure | `scenarios.ingestion` › partial ingestion failure: a failing sub-resource is skipped and counted |
| **B. Question answering** | |
| Strong evidence | `scenarios.qa` › strong supporting evidence…; `pipeline` › evidence-grounded answer with citations |
| Multiple source types | `scenarios.qa` › evidence across multiple source types |
| No evidence | `scenarios.qa` › no supporting evidence…; `pipeline` › REFUSAL… |
| Ambiguous question | `scenarios.qa` › ambiguous question: vague wording, or an identifier defined in several places |
| Conflicting decisions | `scenarios.qa` › conflicting decisions are explained as conflict… |
| Superseded decision | `scenarios.qa` › superseded decision shows original, replacement…; `pipeline` › SUPERSEDED… |
| Missing author / timestamp | `scenarios.qa` › missing author is never invented; › missing timestamp is shown as unknown |
| Sarvam AI provider (request, key header, JSON parsing) | `llm` › Sarvam AI provider calls api.sarvam.ai…; › parseJsonLoose…; › provider selection… |
| Unsupported generated claims | `scenarios.qa` › unsupported claims in a generated response are removed; `answer` › LLM claims citing evidence that does not exist are dropped |
| Broken / unavailable links | `scenarios.qa` › broken or unavailable source links are flagged |
| **C. Graph** | |
| Node & relationship creation | `pipeline` › graph has the expected schema, provenance… |
| Stable-ID dedupe | `pipeline` › building twice is idempotent; `scenarios.ingestion` › duplicate ingestion… |
| Missing related node | `scenarios.graph-security` › missing related nodes never produce dangling relationships |
| Empty retrieval | `scenarios.graph-security` › empty retrieval results… |
| Invalid graph connection | `scenarios.graph-security` › invalid graph connection fails with a clear, credential-free error |
| Query errors / Cypher construction | `scenarios.graph-security` › query construction rejects unknown labels…; › internal errors return a safe response |
| Evidence-chain integrity | `scenarios.graph-security` › evidence-chain integrity… |
| Temporal ordering & supersession | `scenarios.graph-security` › temporal ordering…; `supersession` (5 unit tests) |
| Graph changes retrieval | `pipeline` › GRAPH MATTERS… |
| **D. API & security** | |
| Invalid body / missing fields / wrong types | `scenarios.graph-security` › invalid body, missing fields and unexpected types… |
| Invalid repository ids | `scenarios.graph-security` › invalid repository identifiers are rejected |
| Safe error responses | `scenarios.graph-security` › internal errors return a safe, structured response |
| Rate limiting | `scenarios.graph-security` › rate limiting returns 429 with Retry-After |
| No secrets exposed | `api` › health never leaks secrets; `answer` › secrets are redacted from logs |
| Prompt injection in issues/comments | `scenarios.graph-security` › prompt-injection text… is treated as data |
| Malicious / misleading content | `scenarios.graph-security` › malicious or misleading source content…; frontend › only GitHub and synthetic-viewer links… |
| Unsupported Cypher construction | `scenarios.graph-security` › query construction rejects…; › Cypher-looking questions are handled as plain data |
| **E. UI & end-to-end** | |
| Repository connection flow / progress | frontend › repository connection flow shows progress and counts |
| Ingestion failure | frontend › ingestion failure is shown with its error code; e2e › ingestion failure… |
| Asking a question | frontend › asking a question renders cited claims…; e2e › ask a question… |
| Opening an evidence link | e2e › ask a question, see cited facts, open an evidence link |
| Inspecting the graph | e2e › inspect the knowledge graph from an answer |
| Viewing a superseded decision | frontend › viewing a superseded decision…; e2e › view a superseded decision… |
| Empty states | frontend › empty states…; › app shows backend-unreachable error and first-run empty state |
| Responsive layout | e2e › responsive layout has no horizontal scroll (desktop + Pixel 7) |
| Loading & error states | frontend › loading and error states while asking |

Fixtures: `backend/tests/fixtures/` (test-only) and `backend/tests/helpers/fakeGitHub.js` (simulated GitHub API, tests only). The synthetic demo dataset in `backend/demo/` is separate and is only used for demo mode / `seed:demo` (and by the demo-scenario tests that check it).
