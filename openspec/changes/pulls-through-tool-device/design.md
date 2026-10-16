## Context

`scripts/measures.ts` identifies a tool result by `message.toolName` in five places:

| Line (at `f900e60`) | Use |
| --- | --- |
| 416 | a Plant score's Pull source |
| 569 | a Revisit score's recall Pull |
| 638 | the `write_documentation` count |
| 639 | Pull counts |
| 768 | the tool a Re-fetch names |

`recallOf` and `recalledTurns` read `result.details` directly: `turnIndices` for `recall_earlier_turns`, and `turns` / `results` for `recall_across_conversations`.

omp 18.11.0 builds device results in its tool-device dispatcher. A tool that runs gives `details: { xdev: { tool, mode: "execute", args, tier, inner } }`, where `inner` is the tool's own `details`. A tool that throws (bad arguments, an unknown tool) gives `isError: true` and `details: { xdev: { tool, mode: "execute" } }`, with no `inner`. Help mode gives `xdev: { tool, mode: "help" }`. Reading `xd://<tool>` is a `read` whose details carry no `xdev` at all. The `gate` v1 probe records hold 32 device results, all of them `recall_earlier_turns` in execute mode.

## Goals / Non-Goals

**Goals:**
- One resolver, from a tool result to the tool it ran and that tool's details, used at all five sites. A sixth site cannot then fall back to `toolName` and drift.

**Non-Goals:**
- Recognising device calls by their arguments (`path: "xd://…"`). The result details are the harness's own record and survive argument rewriting.
- A Revisit's "concerning" match, which tests the call's argument strings. A device call's `content` string already holds the query, so it behaves like a direct call's arguments.
- `src/`: the extension needs no change.

## Decisions

### 1. Resolve from `details.xdev`, at the result

`invokedTool(message)` returns `{ name, details }`:
- **Device result** (`details.xdev.mode === "execute"` and `xdev.tool` a non-empty string): the name is `xdev.tool`, and the details are `xdev.inner ?? {}`.
- **Anything else**: the name is `message.toolName`, and the details are `message.details`.

`recallOf` and `recalledTurns` take the resolved details instead of the raw message, so neither ever sees the wrapper. A failed device call has no `inner`, which resolves to empty details. That makes it a Pull with no Turns: counted, and never a recall Pull, the same as a failed direct call.

*Alternative considered:* rewrite device results into direct ones while loading the Journal. That is rejected: other Measures, such as Re-fetch text and tokens, should see the message exactly as it was recorded, and a loader rewrite hides the provenance.

### 2. Help mode and documentation reads stay what they are

Help mode is not `execute`, and a `read xd://…` has no `xdev`, so both resolve to their recorded tool names (`write`, `read`) and never count as Pulls. Their text can still be a Re-fetch, as any repeated result can.

### 3. Re-fetch names the resolved tool

A Re-fetch's `tool` is informational: the spec says the tool does not decide whether a result is a Re-fetch. Naming `recall_earlier_turns` rather than `write` keeps the details readable, and every site then reads tools through the same resolver.

## Testing seams

The seam is `measureRun(fixture(…))` in `test/measures.test.ts`, the one the existing Pull, Plant and Revisit tests use. Each spec scenario is exercised through the fixture records:

- **Pulls (`pi-chart-pulls`)**:
  - Rewrite into device form one successful `recall_earlier_turns` call that is a recall Pull, the failed `recall_earlier_turns` call, and one `search_documentation` call. The rewritten failed call takes the error shape, with no `inner`.
  - Add one device `write_documentation` call, keeping the direct one. The expected `writes` goes from 1 to 2, the only expectation that changes.
  - Add a `read` of `xd://recall_earlier_turns` and a help-mode device result. They must leave every Pull count and token figure unchanged.
  - Every other expected count and recall Pull holds unchanged. Token figures keep their oracle: the test's `returned` helper sums the estimate over every result of the tool. It currently selects those results by `toolName` and gains the device form (`details.xdev.tool` in execute mode). So the expected token sums move with the rewritten messages and stay exact.
- **Plants (`pi-chart-plants`)**: rewrite the recall that sources a Plant into device form. The expected score (`source: "pull"`, `pull: "recall_earlier_turns"`) holds unchanged.
- **Revisits (`pi-chart-revisits`)**: rewrite the recall that recovers the Revisit into device form. The expected score holds unchanged.

These tests fail before the resolver exists and pass after it. Apart from `writes`, none of their expected figures changes.

## Risks / Trade-offs

- **[omp changes the `xdev` shape]** → the resolver reads three fields. If they move, device calls stop being recognised and the counts drop to what they are today, rather than becoming wrong in some other way. A fixture built from omp 18.11.0 output pins the shape.
- **[Token figures for device Pulls]** → the spec requires Pull tokens to be estimated the way Accounting sizes a part. That estimator serializes the whole message, including `details`, so a device result also counts its `xdev` wrapper: the echoed `args`, `tier` and `mode`, a few dozen characters. The figure stays as it is. It matches how Accounting sized that same message in the window, and that consistency is what the requirement asks for.
- **[Figures already reported]** → Measures are recomputed from the Run record on every read (`measureRun`), so old Runs pick up the fix when measured again. Only figures copied into documents go stale. The `gate` README's figures are recomputed from the probe records in `/tmp/gate-probe-{2,3}`. If those records are gone by then, the README marks its figures as pre-fix instead.
