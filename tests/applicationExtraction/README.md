# Application extraction eval harness

Goal: score the extraction pipeline against a frozen golden corpus so we can
move from "looks right" to "measurably better than last run" before landing
prompt or architecture changes.

## Layout

```
tests/applicationExtraction/
├── README.md                  # this file
├── corpus/                    # git-ignored. Real PDFs live here, out of repo.
│   ├── acord125-gl.pdf
│   └── …
├── goldens/                   # committed. Hand-reviewed intent graphs.
│   ├── acord125-gl.json
│   └── …
├── scoring.ts                 # scoring functions (recall, precision, structure F1)
├── scoring.test.ts            # unit tests for the scoring functions themselves
└── run.ts                     # CLI: run the pipeline on the corpus, score vs goldens
```

Golden files conform to the `IntentGraph` type exported from
`convex/lib/applicationIntentGraph.ts`. Add one golden per corpus PDF.

## Commands

```bash
# Score the current pipeline against all goldens. Writes a report to
# tests/applicationExtraction/.report.json and exits non-zero if any metric
# falls below the threshold in scoring.ts.
pnpm vitest run tests/applicationExtraction/scoring.test.ts

# (future) Regenerate extractions for the corpus; compares against goldens.
pnpm tsx tests/applicationExtraction/run.ts
```

## Metrics (see `scoring.ts`)

- **Field recall** — % of golden nodes with a matching emitted node.
- **Field precision** — % of emitted nodes matching a golden node.
- **Type accuracy** — % of matched nodes with identical `answerType`.
- **Structure F1** — conditional + repeating edges recovered vs. expected.
- **Token cost** — reported per run; soft thresholds only.

Thresholds are intentionally loose until we have a corpus of 20+. Tighten as
the pipeline stabilizes.
