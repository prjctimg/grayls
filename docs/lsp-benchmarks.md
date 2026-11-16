# GrayLS: `server.js` (Node) vs native (`scriptc`) benchmark

Benchmarks compare the two LSP server entry points in this repository:

- **server.js (Node):** `node out/server.js --stdio` (vscode-languageserver-based JS server)
- **native (scriptc):** `out/grayls --stdio` (scriptc-built native binary from `src/native.ts`)

## Method

- **Workload/sample:** `main.gray` (opened as a Gray document over LSP)
- **Runs:** 3 runs per target, averaged (mean shown); each run is a fresh server process
- **Session (Neovim-like):** `initialize` → `initialized` → `didOpen` → `hover`, `completion`, member completion (`strings.<cursor>`), `definition`, `documentSymbol`, `references`, `inlayHint`, `formatting`, then 10× (`didChange` + `hover`) edit burst
- **Speed:** client-observed request/response latency (wall-clock, ms) per LSP method
- **Memory:** sampled from `/proc/<pid>/status` every ~20 ms during the session (RSS)
- **CPU:** process CPU time from `/proc/<pid>/stat` (`utime+stime`, mean across runs)
- **Generated:** 2026-11-16 (local benchmark run in this workspace)

> Notes: `inlayHint`/`formatting` and diagnostics-related behavior may invoke `gray` CLI tools when available, so absolute times depend on environment; comparisons below are same-machine, same-workload.

## Startup / responsiveness

```benchmark
title: LSP initialize latency (ms)
unit: ms
lower is better
- native (scriptc): 47.4
- server.js (Node): 159.6
```

```benchmark
title: Hover latency (ms)
unit: ms
lower is better
- native (scriptc): 36.0
- server.js (Node): 44.1
```

```benchmark
title: Completion latency (ms)
unit: ms
lower is better
- native (scriptc): 31.1
- server.js (Node): 34.0
```

```benchmark
title: Member completion latency (ms, after ".")
unit: ms
lower is better
- native (scriptc): 24.4
- server.js (Node): 28.7
```

```benchmark
title: Go-to-definition latency (ms)
unit: ms
lower is better
- native (scriptc): 23.5
- server.js (Node): 26.2
```

```benchmark
title: Document symbols latency (ms)
unit: ms
lower is better
- native (scriptc): 26.0
- server.js (Node): 33.9
```

```benchmark
title: References latency (ms)
unit: ms
lower is better
- native (scriptc): 39.0
- server.js (Node): 98.1
```

## Heavier operations / edit responsiveness

```benchmark
title: Inlay hints latency (ms)
unit: ms
lower is better
- native (scriptc): 124.2
- server.js (Node): 148.4
```

```benchmark
title: Formatting latency (ms)
unit: ms
lower is better
- native (scriptc): 77.4
- server.js (Node): 86.9
```

```benchmark
title: Edit burst: 10× (didChange + hover) total (ms)
unit: ms
lower is better
- server.js (Node): 483.4
- native (scriptc): 764.2
```

## Memory usage

```benchmark
title: Peak RSS during LSP session (MB)
unit: MB
lower is better
- native (scriptc): 3.88
- server.js (Node): 98.00
```

```benchmark
title: Average RSS during LSP session (MB)
unit: MB
lower is better
- native (scriptc): 3.73
- server.js (Node): 71.81
```

## CPU usage

```benchmark
title: CPU time per benchmark session (s, utime+stime)
unit: s
lower is better
- native (scriptc): 0.67
- server.js (Node): 1.59
```

## Summary

- **Memory:** the native scriptc binary uses dramatically less memory (~3.9 MB peak / ~3.7 MB avg RSS) than the Node `server.js` process (~98.0 MB peak / ~71.8 MB avg RSS) for the same LSP workload.
- **CPU:** lower CPU time per session for native (~0.67 s) vs Node (~1.59 s).
- **Latency:** native is faster for startup/initialize and for most request types measured (hover, completion, member completion, definition, document symbols, references, inlay hints, formatting). In this run, the Node server was faster for the repeated 10× edit+hover burst; results can vary with implementation details, caching, and external `gray` CLI costs.
- **Caveat:** numbers are from 3 runs on one machine/workload and include operations that may shell out to `gray`; treat as comparative indicators, not absolute guarantees. Reproduce with `node scripts/benchmark-lsp.mjs`.

Raw results (JSON) are captured by the benchmark script.
