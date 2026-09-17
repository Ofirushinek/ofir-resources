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

## Approaching a brand-new site: a repeatable method, not a one-off

Every new site costs real time the first time — new selectors, new auth, new layout quirks. That
cost does NOT need to repeat itself. Follow this order every time; it is the distilled result of a
real stress test (an unfamiliar external site — nothing about it was known going in):

1. **Skeleton first, one piece at a time, approved before the next.** Capture the page's own
   top-level structural regions (nav, header/toolbar, main content area) as their real measured
   boxes before filling in any detail. Get each piece confirmed correct before moving to the next —
   catching a wrong assumption (a wrong region height, a missing sub-row) costs nothing at this
   stage and a lot once ten more pieces are built on top of it.
2. **Find selectors by STABLE identity, never by generated class names.** `data-testid`,
   `aria-label`, `role`, or a plain semantic tag (`header`, `main`, `nav`) survive a re-render;
   hashed/generated classes (`css-4kayew`, `css-18dut0i`) are build artifacts that can change on
   the next deploy and tell you nothing about what the element IS. Search for stable attributes or
   distinctive visible text first; fall back to structural position only when nothing stable exists.
3. **A "not found" or suspiciously-empty page is almost always a timing or scoping problem, not a
   missing element.** Before concluding an element doesn't exist: (a) check whether the SAME class
   or `data-testid` matches more than one element (a hidden duplicate elsewhere on the page will
   silently win a `querySelector`) — scope the selector narrower; (b) confirm the page actually
   finished loading (`document.body.innerText.length` near-zero means it hasn't) — heavy SPAs often
   need `networkidle`, not `load`, and occasionally need one retry on a transient timeout.
4. **Verify with a real number, not a look.** Screenshot the capture, screenshot the same region of
   the real reference, and diff them (even a plain pixel-closeness ratio via Pillow is enough) —
   this turns "looks about right" into a concrete score you can watch move as you fix things, and
   makes it obvious when a fix actually worked versus just looked like it might have.
5. **When you fix a fundamental bug, re-test everything you'd previously written off as unsolved —
   don't assume each visual symptom needs its own separate fix.** One root cause can produce several
   seemingly unrelated symptoms. Concretely: a bug where an unescaped `"` in a computed value (a
   quoted font-family) truncated the rest of a style attribute was, in hindsight, ALSO the real
   explanation for an earlier "moving an element broke its CSS" finding that got a whole separate
   fix — the separate fix was still worth keeping, but it wasn't the true root cause of what had
   been observed.
6. **A container's assigned height is a guess until you measure the real content against it.**
   A "fold" wrapper sized to fill the remaining viewport (e.g. 888px) can sit on top of content
   that only actually needs a fraction of that (e.g. 495px) — the real page had almost no gap
   between sections, but the capture had a ~380px dead zone. Before building the next piece on top
   of a container, measure the real page's content bottom (`getBoundingClientRect()` on the last
   real element) and match the container to it, rather than trusting an initial size guess.
7. **Before every publish/republish, diff "images referenced in the HTML" against "images actually
   included."** `grep -o 'src="[^"]*"'` on the output vs. the file list you're about to upload —
   any name in the first set missing from the second is a guaranteed broken image. This is an easy
   miss specifically on a RE-publish: it's natural to re-copy only the files you just touched (e.g.
   new `.jpg`s) and forget older ones already referenced (e.g. `.svg` icons) that were sitting in
   the same output folder the whole time.

None of the above is specific to any one site, framework, or library — that is the point. Following
it is what makes the SECOND unfamiliar site faster than the first, and the tenth faster still,
instead of every new site starting the investigation over from zero.

## This skill does not cover the return direction

Mapping an edit made in the canvas back into real source code is a separate skill —
`canvas-to-ui` in this same repo. It is judgment-driven, not something this script does, and
deliberately has no code of its own.
