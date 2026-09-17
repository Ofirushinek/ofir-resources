# The Canvas-to-Code Ruleset

The companion discipline to `ui-to-canvas-capture.mjs` in this repo. Capture turns a real page into
an editable design canvas; this is the rule set for the other direction — turning an edit made in
that canvas back into real, safe code changes. Not tied to any specific product, tool, or codebase.

There is no script for this half. It's a checklist for whoever (human or AI) is doing the editing —
because unlike Capture, this side requires judgment, not just computation.

---

## The problem this solves

Capture is deliberately "dumb" in one specific way: every element it produces is free-standing,
independently editable, with no memory of where it came from in the real source. That's a
deliberate trade — it's what makes the canvas honest ("every element here is really, fully
editable"), not a limitation to work around.

But that same dumbness means writing an edit back into code is never a blind copy-paste. Three
real failure modes show up if it's treated as one:

1. **Shared components silently forked.** The edited element might be one instance of a component
   used in many places. Writing the change back naively either (a) changes it everywhere, silently,
   when the editor only meant to tweak one instance, or (b) creates an accidental near-duplicate
   component nobody decided to create.
2. **Live data frozen as a literal.** An element's content might come from a database, an API, or
   any other live source — not a hardcoded string. If Return writes back whatever text happened to
   be showing at capture time, every real user from then on sees that one frozen value instead of
   their own.
3. **A decision made silently is a decision made wrong.** Both of the above are only safe if a
   human explicitly chooses the outcome. Guessing — even a reasonable-sounding guess — is the
   actual bug.

## The ruleset

1. **Before writing anything, identify what kind of element was touched.**
   - A true one-off, matching nothing else in the real source → generate the patch directly. No
     question needed.
   - An instance of a shared class/component used elsewhere → **stop. Do not write code yet.**
   - An element whose content is bound to a live data source, not a literal string → treat its
     *style* (color, spacing, size) as normal to patch; never write its *content* back as a
     hardcoded value.

2. **When a shared component is touched, ask one explicit question before writing:**
   *"This also affects [the component], used in [N other places] — update it everywhere, or split
   this into its own one-off version?"* Never pick silently. Name the real blast radius so the
   answer is informed, not a guess.

3. **Verify visually before publishing any capture-to-canvas step**, and again before treating
   anything as "returned" successfully. Render the result, compare it against the real page or a
   supplied reference, and only then call it done. A capture or a return that "looks right" without
   being checked is exactly how a small, real bug (a missing hover state, a misaligned cell) ships
   unnoticed — checking after the fact costs a correction; checking before costs nothing.

4. **Editing in the canvas should always stay 100% free.** Never restrict what a person can select,
   drag, resize, or restyle in the canvas itself in order to make Return easier later (for example,
   locking two elements together as one shared component so an edit propagates automatically). The
   smart decision-making belongs entirely on the Return side, at the moment code is generated — not
   as a constraint placed on editing.

## Open, unsolved problems (real, not hypothetical)

- **Stable identity across an edit.** Reliably mapping "this exact edited element" back to "that
  exact line in that exact source file" needs a durable id stamped at capture time — not yet solved
  in general.
- **Tracing a value's real origin.** Telling a hardcoded string apart from a live-data-bound value
  by looking at rendered output alone is not possible — both can render as an identical, ordinary
  element. This requires actually reading the source that produced the page, not just its output.
- **Per-stack code generation.** What a "patch" looks like is different for a hand-written
  template-literal codebase versus a component-framework one (JSX, hooks, generated files). The
  decision logic above is stack-agnostic; the mechanics of writing the patch are not, and likely
  need a small adapter per stack.
