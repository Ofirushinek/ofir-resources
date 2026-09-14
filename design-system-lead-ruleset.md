# The Design System Lead Ruleset

A companion to Article #8. This is the actual rule set behind the "Design System Gate" —
written to be read once for the philosophy, then pasted into an agent's instructions and used.
Not tied to any specific product, tool, or codebase.

---

## The problem this solves

A Design System always looks orderly on paper: components, tokens, naming conventions. Then a
real product gets built fast, in several places at once, and it frays at the edges — one more
raw value in CSS, one more button that's almost the same as an existing one, one more component
built because checking what already exists felt slower than just building.

Agents make this worse, not better. They're fast enough to ship a great screen and invent three
new near-duplicate shades in the same five minutes. Speed without a system-owner is how drift
compounds.

The fix isn't a better-documented system. It's giving the system an *owner* — a role whose only
job is deciding what's reused, what's extended, and what's genuinely new, on every single build,
not just when something visibly breaks.

## The philosophy, in four rules

1. **Reuse before create, checked at the highest level first.** Before approving anything new,
   check whether a whole existing pattern already solves the shape of the problem — not just
   whether a similar component exists. Most "new component" needs are actually "existing pattern,
   different content."

2. **Every build ends in a stated decision.** "It's small, leave it as is" is not an outcome.
   Every UI build resolves to exactly one of: **Reuse**, **Extend**, or **New**. A genuine one-off
   is a valid answer — but it has to be a decision someone made, not a gap nobody checked.

3. **The running product is the evidence, not the source file.** A component with a story in the
   codebase is not "documented" — it's documented only once it's actually live in whatever
   surface the team actually looks at. A rule written into one CSS selector is not "enforced" —
   check the rendered product, because a more specific selector elsewhere can silently override
   the general one. Trust what's running, not what the code says should happen.

4. **An imperfect, honestly-measured system beats an assumed-perfect one.** The job isn't to
   produce a flawless system — it's to know exactly how far from perfect it is (what % of spacing
   actually uses tokens, which raw values snuck in) and fix that debt on purpose, instead of
   assuming things are fine because the documentation looks nice.

## The role

**Owns:** design tokens (color, spacing, typography, radius, shadow, motion), the documented
component library, enforcing visual consistency across every surface, deciding what's canonical
vs. one-off.

**Does not own:** building product screens/features (that's whoever builds UI), copy/words,
product roadmap or feature prioritization.

**Sits where:** *before* every UI build (what already exists, how to use it) and *after* every
UI build (what actually got built, does anything need to enter the system) — never only at the
end, when it's already shipped.

## The reuse ladder

Walked in this exact order, every time, before anything new gets approved:

1. **Reuse a whole existing page or pattern.** Does something already solve this shape of
   problem? Use it as-is — same structure, same spacing rhythm. Different content is not a
   reason to change the pattern.
2. **Compose the solution from existing components.** No matching whole pattern — build the
   screen out of parts that already exist. A new page made entirely of existing parts is the
   target outcome, not a compromise.
3. **Extend an existing component.** Something almost fits — add a variant (a size, a state, a
   modifier) rather than letting a near-duplicate sibling appear that does the same job.
4. **Only then, create something new.** And even then: nobody invents at the page level. What's
   genuinely new is assembled from the rung below it — existing components, existing tokens.
   That's the actual mechanism by which new work reads as native instead of pasted on.

## The Design System Gate — paste this into an agent's instructions

```
BEFORE every UI build:
- Inspect the existing live design system before creating anything.
- Walk the reuse ladder in this exact order:
  1. Reuse an existing page or pattern.
  2. Compose the solution from existing components.
  3. Extend an existing component.
  4. Only then create something new.
- Before implementation, explicitly state the expected outcome — Reuse / Extend / New —
  and name the existing components/tokens you plan to use.

AFTER every UI build:
- Review the actual implemented UI, not only the source code or documentation.
- Check for duplicated patterns, raw values, and new colors, spacing, radii, typography,
  controls, or breakpoints that bypass the existing system.
- Finish with one explicit outcome: Reuse / Extend / New.
- If something was extended or created, update the design system's documentation AND verify
  it is actually live and accessible — a source file with no live surface is not documentation.
- Never treat "the file exists" as proof the system is current. The running product is the
  final evidence, not the code.
```

## Canonical vs. one-off — the decision, not the default

Not everything built belongs in the system. The rule: a genuinely reused, foundational pattern
gets documented properly — token-clean, named, its variants and states captured. A genuinely
unique, single-use piece gets left alone; documenting it would just add noise nobody reads.

The failure mode isn't "too many one-offs" or "too strict a system" — it's *silence*: nobody
deciding, so a real pattern goes undocumented and quietly duplicates, or a one-off bloats the
system for no reason. Either way, someone states the decision out loud.

---

This doesn't replace a design system. It gives one an owner — a role, not a prompt asking "is
this consistent?"
