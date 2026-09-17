---
name: ui-to-canvas-capture
description: Turn any real, already-built webpage into an editable Design Component (a Main.dc.html file) that Claude Design's canvas editor can open. Use when someone wants to bring a live UI — any page, any framework, any stack — into a design canvas to edit it visually, rather than mocking it up from scratch.
---

# UI → Canvas Capture

This skill bundles one file: `ui-to-canvas-capture.mjs`. It is a Node.js script, not an AI
workflow — running it requires no model reasoning, only Node and Playwright.

## When to use this

The user wants a real, live page (or one element/region of it) editable inside a design canvas,
pixel-exact to how it actually renders — not a hand-drawn approximation of it.

## How it works, briefly

It opens the target URL in a real headless browser, walks the target element's subtree, and for
each node reads the browser's own **computed style** (`getComputedStyle`) — the final, resolved
style after every cascade, token and reset has applied — rather than copying CSS source rules by
selector. That is what makes it stack-agnostic: it never reads source code, only what a real
browser renders, so it works identically whether the page is React, vanilla JS, or anything else.
Full mechanism and the specific bugs this design avoids are documented in the script's own header
comment and inline comments — read those before modifying it.

## Running it

```
node ui-to-canvas-capture.mjs <url> <selector> <outDir> [viewportWidth] ["click:sel|hover:sel|wait:ms|group:sel1,sel2|..."]
```

- `<url>` — the live page to capture.
- `<selector>` — a CSS selector for the element (or region) to capture.
- `<outDir>` — where to write the output (`Main.dc.html` plus any extracted images).
- `[viewportWidth]` — optional, defaults to an iPhone-class 390px.
- The optional steps string replays interactions needed to reach the right state before capturing:
  `click:<selector>`, `hover:<selector>`, `wait:<ms>`, and `group:<sel1>,<sel2>,...` (merges loose
  sibling elements with no shared wrapper into one captured unit, in the order given).

Requires `npm install playwright` in whatever project runs this script.

## After capturing

The output (`Main.dc.html`) is a flat, self-contained HTML file with no external CSS dependency —
every element's style is baked inline. Open it in Claude Design's canvas editor (or hand it to
Claude to seed and publish there) to edit freely.

**Before treating any capture as done, render it and visually compare it against the real page or
a supplied reference — do not publish or hand it over unverified.** A capture that "looks right"
without being checked is exactly how a small, real bug (a missing hover state, a clipped row, a
misapplied radius) ships unnoticed. This applies to every capture, not only ones that look complex.

## This skill does not cover the return direction

Mapping an edit made in the canvas back into real source code is a separate skill —
`canvas-to-ui` in this same repo. It is judgment-driven, not something this script does, and
deliberately has no code of its own.
