# graphify as a code-connection-graph tool — research report

## Candidates named graphify

### 1. Graphify-Labs/graphify (PyPI `graphifyy`, CLI `graphify`) — the code knowledge-graph tool

- **Canonical repo:** https://github.com/Graphify-Labs/graphify — "Turn any codebase, with its docs, SQL schemas, configs, and PDFs, into a queryable knowledge graph. A /graphify skill for Claude Code, Cursor, Codex, and Gemini CLI: local deterministic AST parsing, every edge explained, no vector store." Language Python, **Apache-2.0**, 118,094 stars / 11,412 forks / 1,341 open issues at time of reading (GitHub API). Upstream clone URL used in its own CONTRIBUTING section is still `https://github.com/safishamsi/graphify.git`; active development branch is `v8`.
- **Package / install:** PyPI project is **`graphifyy`** (double-y) — https://pypi.org/project/graphifyy/ (latest `0.9.62`, ~403K weekly downloads, requires Python >=3.10). README: "The PyPI package is `graphifyy` (double-y). Other `graphify*` packages on PyPI are not affiliated. The CLI command is still `graphify`."
  ```bash
  uv tool install graphifyy      # or: pipx install graphifyy / pip install graphifyy
  graphify install               # register the /graphify skill with your AI assistant
  graphify install --project     # writes .claude/skills/graphify/SKILL.md or .agents/skills/graphify/SKILL.md
  uvx --from graphifyy graphify install   # note: plain `uvx graphify` fails, package name != command name
  ```
- **Languages parsed:** "37 tree-sitter grammars" per README file table — `.py .ts .mts .cts .js .jsx .tsx .mjs .go .rs .java .c .cpp .cc .cxx .h .hpp .cu .cuh .metal .rb .cs .kt .kts .scala .php .swift .lua .luau .zig .ps1 .ex .exs .m .mm .ml .mli .jl .vue .svelte .astro .groovy .gradle .dart .v .sv .sql .f90 .pas .sh .bash .json .dm …` plus Salesforce Apex (regex), Terraform/HCL, OCaml, Common Lisp, Robot Framework as optional extras; also MCP configs (`mcp.json`), package manifests (`pyproject.toml`, `go.mod`, `pom.xml`) → `depends_on` edges, SQL DDL (tables/views/FKs/JOINs), live Postgres via `--postgres DSN`, Cargo workspaces via `--cargo`. (Capability table says relationships "resolved across ~40 languages via tree-sitter AST"; `docs/how-it-works.md` on branch `v8` says "25 languages supported" — the docs are internally inconsistent, treat the count as approximate.)
- **Output artifact:** directory **`graphify-out/`** containing `graph.json` (full graph), `graph.html` (interactive force-directed viz), `GRAPH_REPORT.md` (god nodes, surprising connections, suggested questions), plus `cache/` (SHA256 content cache), `converted/`, `manifest.json`, `cost.json`, `memory/`, `reflections/LESSONS.md`.
  - Format: `graph.json` is **NetworkX node-link JSON**. Node fields: `id`, `label`, `file_type` (`code|document|paper|image|rationale`), `source_file`. Edge fields: `source`, `target`, `relation` (e.g. `calls`, `imports`, `implements`, `inherits`, `mixes_in`, `semantically_similar_to`), `confidence` (`EXTRACTED|INFERRED|AMBIGUOUS`), `confidence_score` (float, INFERRED only), `source_file`. Group relationships live in `G.graph["hyperedges"]`. Source: https://raw.githubusercontent.com/Graphify-Labs/graphify/v8/docs/how-it-works.md
  - Extra exports: `--svg` (`graph.svg`), `--graphml` (Gephi/yEd), `--neo4j` / `--neo4j-push bolt://…` (`cypher.txt`), `--falkordb` / `--falkordb-push falkordb://…`, `--obsidian` (vault), `--wiki` (agent-crawlable markdown), `graphify export callflow-html` (Mermaid architecture/call-flow HTML at `graphify-out/<project>-callflow.html`).
- **Committed into the repo?** Yes, explicitly: "`graphify-out/` is meant to be committed to git so everyone on the team starts with a map", with recommended `.gitignore` of `graphify-out/cost.json` and optionally `graphify-out/cache/`. `manifest.json` stores relative paths so it is portable across clones. Counter-note in Troubleshooting: add `graph.json` / `graphify-out/` to `.claudeignore` so writes don't invalidate Claude Code's prompt cache.
- **Incremental updates / re-runs:** SHA256 content fingerprint per file in `graphify-out/cache/`; re-runs skip unchanged files. Commands: `graphify update ./src` (`--no-cluster`, `--force`), `/graphify . --update` ("re-extract only changed files"), `graphify check-update ./src`, `graphify cluster-only` (re-cluster without re-extracting), `--force` / `GRAPHIFY_FORCE=1` to allow a smaller graph after refactors, `--allow-partial` for interrupted runs, `graphify merge-graphs a.json b.json`. A design doc for this exists at `docs/superpowers/specs/2026-05-04-incremental-updates-dedup-design.md`.
- **Watch mode:** yes — `graphify watch ./src` and `/graphify ./raw --watch` ("auto-sync as files change").
- **Git / CI usage:** `graphify hook install` installs post-commit + post-checkout hooks (background rebuild, AST-only, no API cost) **and a git merge driver so `graph.json` never shows conflict markers**; `graphify hook status` / `hook uninstall`. `git pull` is the one manual step (`graphify update .`). Headless CI path: `graphify extract ./src --code-only` (local AST, **no API key**), `--backend {gemini,kimi,claude,openai,deepseek,ollama,bedrock,azure,claude-cli}` only for docs/PDF/image semantic pass. Repo's own CI: `.github/workflows/{ci.yml,publish.yml,release-graph.yml}`; Ubuntu, Python 3.10/3.12/3.13/3.14, `uv run pytest tests/ -q`.
- **Agent integration (relevant to your brief):** `graphify install --platform {claude,codex,opencode,cursor,gemini,copilot,aider,kilo,droid,trae,hermes,kimi,amp,agents,kiro,pi,devin,antigravity,codebuddy,claw}`; PreToolUse hooks that nudge (or with `--strict`, block the first raw source read and redirect to the graph); MCP server `python -m graphify.serve graphify-out/graph.json [--transport http --port 8080 --api-key …]` exposing `query_graph`, `get_node`, `get_neighbors`, `shortest_path`, `list_prs`, `get_pr_impact`, `triage_prs`. Cross-repo: `graphify global add graphify-out/graph.json --as myrepo` → `~/.graphify/global-graph.json`.
- **Caveat vs your brief:** graphify is *not* purely programmatic. Pass 1 (tree-sitter, local, deterministic) yields the call/import/inherit graph; Pass 3 sends docs/PDFs/images to an LLM and produces semantic edges such as `semantically_similar_to` plus `INFERRED` edges with confidence scores. `--code-only` restricts it to the AST graph, and a code-only corpus skips the LLM pass entirely. Also note the local query log at `~/.cache/graphify-queries.log` (README's Privacy section says it logs every query; the env-var table says it is opt-in via `GRAPHIFY_QUERY_LOG_ENABLE` — the two sections contradict each other, verify before relying on either).
- **Maturity/activity:** extremely high star count and download volume, 1,341 open issues, YC S26 badge, commercial "graphify Enterprise" at https://graphify.com. Licensing is mixed-looking: repo license reported as Apache-2.0 with both `LICENSE` and `LICENSE-MIT` + `NOTICE` present in the tree — check which applies to which component before vendoring.

### 2. rhanka/graphify (npm `@sentropic/graphify`) — TypeScript sibling/fork, now ontology-first

- **Repo:** https://github.com/rhanka/graphify — TypeScript, **MIT**, 23 stars / 7 forks / 35 open issues.
- **Package:** https://www.npmjs.com/package/@sentropic/graphify — v0.18.0, ~6.2K weekly downloads; the old npm name `graphifyy` is a deprecated re-export (https://www.npmjs.com/package/graphifyy). Install: `npm install -g @sentropic/graphify` then `graphify install`; requires Node.js 20+.
- **Parsing:** `web-tree-sitter` dependency; clustering via `graphology-communities-louvain` (Louvain, not Leiden). README: "graphify started life as a **code knowledge graph**: parse a repo, extract classes/functions/calls, cluster, report" and now generalizes to ontology-typed entity graphs.
- **Output artifact:** **`.graphify/`** (not `graphify-out/`): `graph.json`, `GRAPH_REPORT.md`, `studio/` (self-contained static Ontology Studio SPA), `wiki/`, `cache/` (gitignored). The repo itself commits `.graphify/graph.json` and `.graphify/GRAPH_REPORT.md`.
- **CLI:** `graphify query "…" --graph .graphify/graph.json`, `graphify path A B`, `graphify explain X`, `graphify summary`, `graphify studio export .graphify/studio`.
- **Maturity:** much smaller; CI = `.github/workflows/typescript-ci.yml`. Its README reuses the same token-reduction benchmark table (71.5×/5.4×/~1×) as Graphify-Labs, confirming shared ancestry.

### 3. kbastani/graphify — legacy Neo4j NLP extension (NOT code analysis)

- https://github.com/kbastani/graphify — "a Neo4j unmanaged extension used for document and text classification using graph-based hierarchical pattern recognition." Java, Apache-2.0, 448 stars. Install = drop `graphify-1.0.0-jar-with-dependencies.jar` into Neo4j `plugins/`, set `org.neo4j.server.thirdparty_jaxrs_classes=org.neo4j.nlp.ext=/service`; use over HTTP (`/service/graphify/training`, `/classify`, `/similar/{label}`). No code parsing, no repo artifact. Dormant. Related-but-distinct: https://github.com/graphaware/neo4j-nlp (GraphAware NLP, **retired May 2021**).

### 4. Unrelated npm packages named graphify

- `@buggyorg/graphify` — https://www.npmjs.com/package/@buggyorg/graphify — layouts KGraph → SVG. Not code analysis.
- `graphify-node` — https://www.npmjs.com/package/graphify-node — ELK graph layout (node sizes/positions). Not code analysis.
- `grapify` (one p, different name) — https://www.npmjs.com/package/grapify — chart rendering.
- `warioddly/graphify` — https://github.com/warioddly/graphify — ECharts-based chart library.
- `Graphitti/graphify` — https://github.com/Graphitti/graphify — dataset-upload/visualization web app.
- `graphify-pi` — https://www.npmjs.com/package/graphify-pi (repo https://github.com/juhas96/graphify-pi), v0.3.0, MIT, ~135 weekly downloads — third-party Pi extension that makes Graphify-Labs graphs always-on; an integration, not an analyzer.

## Best match + confidence

**Graphify-Labs/graphify (PyPI `graphifyy`, CLI `graphify`) — confidence ~0.90.**

It is the only "graphify" that satisfies every clause of the brief: you install it into a codebase (`graphify install --project`), run it (`/graphify .` or `graphify extract . --code-only`), it writes a committed artifact directory (`graphify-out/graph.json` + `graph.html` + `GRAPH_REPORT.md`), the edges are programmatic (`calls`, `imports`, `inherits`, `mixes_in`, `depends_on`, SQL FK/JOIN) from tree-sitter ASTs rather than documentation links, and it keeps itself updated (`graphify update`, `graphify watch`, post-commit/post-checkout hooks, SHA256 cache, `graph.json` merge driver). Residual 10%: (a) graphify's graph is *also* a documentation/semantic graph when docs are in scope, so "PROGRAMMATIC connections only" requires `--code-only`; (b) if the brief's author meant a purely deterministic import/call extractor, `dependency-cruiser`/SCIP would be a better literal fit; (c) rhanka/graphify is a name collision that could be meant if the stack is Node-only.

## Alternatives in the niche

| Tool | Repo / docs | Install & CLI | Languages | Output artifact | Committed? | Incremental / watch / CI |
|---|---|---|---|---|---|---|
| **aider repo map** | https://aider.chat/docs/repomap.html · https://github.com/Aider-AI/aider | `pip install aider-install`; built into `aider`, `--map-tokens` (default 1k) | tree-sitter tag-query languages | **No file artifact** — an in-context text map of files→key symbols, ranked by PageRank over a file-dependency graph | No | Rebuilt per chat turn; not a repo artifact |
| **SCIP** (protocol + CLI) | https://github.com/scip-code/scip (Apache-2.0, Go, 800★) | `scip` CLI from releases; `scip print --json index.scip` | protocol; indexers below | `index.scip` (protobuf per `scip.proto`): symbols, occurrences, definitions/references/implementations | Usually CI-uploaded, not committed | Per-indexer; standard CI pattern (upload to Sourcegraph via `src-cli`) |
| **scip-typescript / scip-python / scip-java / scip-clang / scip-ruby / scip-dotnet** | listed at https://github.com/scip-code/scip#tools-using-scip (e.g. https://github.com/sourcegraph/scip-typescript) | `npm i -g @sourcegraph/scip-typescript`; `scip-typescript index` | TS/JS, Python, Java/Scala/Kotlin, C/C++, Ruby, C#/VB | `index.scip` | No | Full re-index per run; CI-oriented |
| **rust-analyzer scip** | https://rust-lang.github.io/rust-analyzer/rust_analyzer/cli/scip/index.html · usage example https://github.com/rust-lang/rust-analyzer/discussions/21125 | `rust-analyzer scip .` | Rust | `index.scip`; JSON via `scip print --json` | No | Batch re-index |
| **github/stack-graphs** | https://github.com/github/stack-graphs (Apache-2.0, Rust, 875★) | crates `stack-graphs`, `tree-sitter-stack-graphs{,-python,-javascript,-typescript,-java}` | Python, JS, TS, Java | Incremental name-binding graph (per-file partial graphs, stitched) | Library, not a repo artifact | Designed for **incremental** per-file indexing |
| **dependency-cruiser** | https://github.com/sverweij/dependency-cruiser (MIT, 7,183★) | `npm i -D dependency-cruiser`; `depcruise src --output-type dot\|json\|mermaid\|archi` | JS/TS/CoffeeScript (ESM/CJS/AMD) | JSON / DOT / Mermaid / HTML graph + **rule violations**; config `.dependency-cruiser.mjs`; baseline file `.dependency-cruiser-known-violations.json` | Config + baseline committed; graph usually generated | `depcruise-baseline`; standard CI gate (exit code on violations); no watch |
| **madge** | https://github.com/pahen/madge (MIT, 10,161★) | `npm i -g madge`; `madge --image graph.svg src/`, `--circular`, `--json` | CommonJS/AMD/ES6 (+TS) module deps only | JSON / DOT / SVG-PNG via Graphviz | Usually not | Full re-scan; no watch; common CI circular-dep check |
| **pyan** | https://github.com/davidfraser/pyan (**GPL-2.0**, 710★) | `pip install pyan3`; `pyan *.py --uses --no-defines --colored --dot` | Python only | Graphviz DOT / yEd GraphML / SVG call-dependency graph | No | Full re-run |
| **blarify** | https://github.com/blarApp/blarify (MIT, Python, 231★) | see repo; tree-sitter + LSP | multi-language | Graph pushed to **Neo4j / FalkorDB** | No (DB-backed) | Repo ships `.blarignore`; incremental support is repo-documented |
| **code-graph-rag** | https://github.com/vitali87/code-graph-rag (MIT, Python, 5,138★) | see repo; Docker image published | multi-language monorepos | **Memgraph/Neo4j** graph + RAG query layer | No (DB-backed) | CI workflows present; DB refresh per run |
| **CodeBoarding** | https://github.com/CodeBoarding/CodeBoarding (MIT, Python, 2,425★) | GitHub Action + CLI | Python-first, multi | Commits **`.codeboarding/`** into the repo: `analysis.json`, `static_analysis.pkl/.sha`, `fingerprint.json`, `file_coverage.json`, health reports, Mermaid diagrams | **Yes — committed** | `.sha`/`fingerprint.json` fingerprints; `.github/workflows/codeboarding{,-sync}.yml` |
| **FalkorDB code-graph** | https://github.com/FalkorDB/code-graph (MIT, 348★) | Docker; GraphRAG-SDK | multi | FalkorDB graph + web UI; MCP tests in CI | No (DB-backed) | Re-index per run |
| **Sourcetrail** | https://github.com/CoatiSoftware/Sourcetrail | desktop app | C/C++, Java, Python | SQLite project DB (`.srctrldb`) + interactive explorer | DB usually gitignored | **Discontinued** — corroborated only secondarily (https://codelayers.ai/blog/complete-guide-code-visualization-2026); verify upstream before relying on it |

Notes for your design: if you want a *deterministic, committed, programmatic-only* artifact, the shortlist is **graphify `--code-only`** (broadest language coverage, ships the hook/merge-driver plumbing you'd otherwise build), **dependency-cruiser/madge** (JS/TS only, but rule-enforceable and boringly stable), and **SCIP indexers** (precise, cross-language, but binary protobuf and one indexer per language). stack-graphs is the only one architected for true per-file incrementality.

## Sources

- https://github.com/Graphify-Labs/graphify (README, file tree, license, stars — GitHub API)
- https://raw.githubusercontent.com/Graphify-Labs/graphify/v8/docs/how-it-works.md (three passes, Leiden, confidence rubric, SHA256 cache, NetworkX node-link graph schema)
- https://pypi.org/project/graphifyy/ (package name, version 0.9.62, downloads, Python >=3.10)
- https://github.com/rhanka/graphify · https://raw.githubusercontent.com/rhanka/graphify/main/README.md · https://www.npmjs.com/package/@sentropic/graphify · https://www.npmjs.com/package/graphifyy
- https://github.com/kbastani/graphify · https://github.com/graphaware/neo4j-nlp (retirement notice)
- https://www.npmjs.com/package/@buggyorg/graphify · https://www.npmjs.com/package/graphify-node · https://www.npmjs.com/package/grapify · https://www.npmjs.com/package/graphify-pi · https://github.com/warioddly/graphify · https://github.com/Graphitti/graphify
- https://aider.chat/docs/repomap.html
- https://github.com/scip-code/scip · https://raw.githubusercontent.com/scip-code/scip/main/README.md · https://github.com/sourcegraph/scip-typescript
- https://rust-lang.github.io/rust-analyzer/rust_analyzer/cli/scip/index.html · https://github.com/rust-lang/rust-analyzer/discussions/21125
- https://github.com/github/stack-graphs
- https://github.com/sverweij/dependency-cruiser · https://github.com/pahen/madge · https://github.com/davidfraser/pyan
- https://github.com/blarApp/blarify · https://github.com/vitali87/code-graph-rag · https://github.com/CodeBoarding/CodeBoarding · https://github.com/FalkorDB/code-graph · https://github.com/CoatiSoftware/Sourcetrail

**Low-trust sources deliberately excluded from claims:** ai.miraheze.org/wiki/Graphify, mcpmarket.com listings, skillsllm.com, and Medium/DEV posts surfaced by search — their star counts, creation dates and feature claims disagreed with the GitHub API and repo docs. Where this report cites star counts, downloads, licenses, or CLI flags, they come from the GitHub API / PyPI / npm registry reads listed above.
