# TraceWhy: Demo for the judges (≈7 minutes)

## Option A: local demo mode (no accounts needed, 3 minutes)

Run `npm run demo` and open http://localhost:5173. Point out the **"Local demo mode"** banner, which lists the integrations that are not active, and the **"Synthetic demonstration data"** banner. Then ask, in order:

1. *Why was the Idempotency-Key added to createPayment?* shows a feature introduced for issue #3. Point at the **fact** and **inference** labels and the reasoning chain.
2. *Why is MAX_RETRIES 3?* shows an incident leading to a fix, with evidence from the PR, the review comment and the incident issue. The injected "ignore previous instructions" comment is flagged and ignored.
3. *Has the SESSION_TTL_MINUTES decision been superseded?* shows the original decision, its replacement, the dates and the explicit reference.
4. *Why is GATEWAY_TIMEOUT_MS 12000?* shows a disputed decision, where conflicting evidence is explained rather than resolved by date.
5. *Why was legacyCsvExport not migrated?* shows the honest **insufficient evidence** answer.

Open any evidence link: it goes to the synthetic-record viewer, which has a "SYNTHETIC DEMO RECORD" banner. Then show the **Decisions** tab (filter `superseded` / `disputed`), the **Timeline** and the **Graph**.

Then do Option B, so the judges also see a **real** repository.

## Option B: real repository with Neo4j AuraDB

This uses a **real public repository**. Nothing is faked or seeded. Choose your demo repository **the day before** and rehearse with it.

## 0. Choosing a repository (do this before the demo)

Good demo repositories are small to medium (under ~2k commits) and have **written-down reasoning**: descriptive PR bodies, `Fixes #N` links, ADRs under `docs/adr/` or `doc/adr/`, and reverts. Here's how to pick one:

1. Import 2–3 candidates in the app.
2. Open the **Decisions** tab and filter by `superseded` and `disputed`.
3. Keep the repository whose decisions read like real engineering choices. Note 2–3 concrete identifiers (a config key, a constant, a function) that appear in those decisions.

Repositories that maintain ADRs are a good place to start: search GitHub for `path:doc/adr` or `path:docs/adr` together with "Superseded by". Check each candidate yourself before relying on it.

Write your chosen questions into the "Script" below. That way the live demo uses things you have already confirmed exist in that repository.

## 1. Setup check (30 s)

Open http://localhost:5173. The header pills should show **Graph neo4j**, **GitHub token set**, and either the LLM model or "extractive answers". Say:
> "All credentials stay in the backend. The browser only sees booleans."

## 2. Import (1 min)

Paste the repository URL and click **Import (Incremental)**. Show the stages: commits, PRs, issues, files, building, writing. When it finishes, point at the sidebar:

* node counts by type
* the **confirmed vs inferred** bar. Confirmed links come from GitHub's structured data; inferred links are parsed from text, and each one records its method.

Optional: open the Aura console → Query and run
```cypher
MATCH (d:Decision {repo: 'owner/name'})-[s:SUPERSEDES]->(o:Decision)
RETURN d.statement, s.method, s.reason, o.statement LIMIT 10;
```

## 3. Ask a "why" question (2 min)

Example shapes to fill in with your repository's identifiers:

* *Why is `<CONFIG_KEY>` set to `<value>`?*
* *Which discussion explains the `<flag>` configuration flag?*
* *Who introduced `<functionName>`?*
* *Was the decision in #`<PR>` later reversed?*
* *What evidence links issue #`<N>` to the code change?*
* *What is known about `<module>`, and what remains uncertain?*

What to show:
1. Each claim has `E#` chips. Hover a chip to highlight its evidence card, and click **open ↗** to show the original GitHub record.
2. On an evidence card, the **path** row shows how the graph reached it, e.g. `MAX_RETRIES ← CONTAINS client.js ← CHANGED_BY commit … DISCUSSED_IN → PR #5 RELATED_TO → Issue #4`. Dashed or italic links are *inferred*.
3. Explain the **Confidence** panel: it's built from five factors and is *not a probability*.
4. Click **Inspect supporting graph** to see the subgraph behind the answer. Click a node to inspect it, and double-click to expand it.

## 4. Temporal reasoning (1 min)

**Decisions** tab → filter `superseded`. Pick one and show the original decision, what replaced it, the method (git revert / ADR status / explicit reference) and the dates. Then filter `disputed`:
> "Here a later change touches the same setting but never references the earlier decision. We do not assume it replaced it; we flag it for a human."

**Timeline** tab: switch on Decisions and Incidents to show the history in order.

## 5. Honest no-evidence response (1 min)

Ask about something the repository never explains, e.g. *Why was `<some old function>` not migrated?*

The result should be the amber **"The imported repository history does not establish the reason."** with Confidence **INSUFFICIENT**. Related records are shown only as context. Say:
> "If the reason was never written down, TraceWhy says so. Even when an LLM is enabled, claims that cite non-existent evidence are dropped. That's covered by an automated test."

## 6. Prove the graph changes the answer (30 s)

In VS Code, run **Terminal → Run Task → TraceWhy: tests** and point at:
* `GRAPH MATTERS: relationships change which evidence is retrieved`
* `SUPERSEDED: an older decision is superseded by a later one…`
* `REFUSAL: the system refuses to invent a rationale…`

## Likely judge questions

* **"Isn't this just RAG?"** Retrieval starts from graph entities, such as an exact config key or a `#PR`. It traverses typed relationships, and each edge's reliability weight changes the ranking. Remove the edges and the evidence disappears (see the test).
* **"How do you avoid hallucination?"** The answer is gated on retrieved evidence, the LLM must cite `E#` ids, invalid citations are stripped, and "why" questions need a record that actually states a reason. All decision text is quoted verbatim.
* **"How do you decide something is superseded?"** Only with explicit evidence: a revert, an ADR status line, or change language plus a reference to the older record. Being newer is never enough on its own.
* **"What about renamed files?"** GitHub's rename status creates `RENAMED_FROM` edges (confirmed). Questions about old paths resolve to the current file, and "who introduced" follows the rename chain.
* **"Limitations?"** There's no line-level blame, the regex symbol extraction is not a full parser, and the system is only as good as what the team wrote down. It reports that honestly.
