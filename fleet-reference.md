# Template: What a Real Agent Fleet Looks Like

This isn't just a list of roles. It's a sanitized, open version of how I actually run an agent fleet on
my own projects - the real lineup I use. Download this file, save it, and use it as a starting point for
your own agent fleet.

Two parts: **who's on the team** (role, what they own, what they don't, what tools they're allowed to
use) and **how a project moves through everyone** (the process, not just the roster).

---

## Part 1: The Roster

Nine roles, each with a *clear mandate* and a *clear boundary* - that's what turns "a few agents" into
"a team."

### 1. Chief Strategy Officer (CSO)
**When to call them:** When it's not yet clear what's worth doing, or there are several competing ideas.
**Owns:** Which idea is worth building right now, versus what's already on the table; turning a decided
direction into a rough, staged plan.
**Doesn't own:** Doesn't build the product, doesn't do actual marketing, doesn't design the agent roster
itself (that's the CTO's job).
**Tools:** Read/write/edit documents, search the project, web search, delegate to another agent.

### 2. Chief Marketing Officer (CMO)
**When to call them:** Everything that happens *outside* the product - how people find it, how it's
positioned, how it's priced.
**Owns:** Distribution channels, launch strategy, positioning and messaging (what to say, to whom),
pricing and monetization strategy.
**Doesn't own:** Doesn't write final copy (that's the Copywriter), doesn't touch UI, doesn't own code.
**Tools:** Same baseline - read/write/edit, search, web search, delegate.

### 3. Chief Product Officer (CPO)
**When to call them:** To decide what goes into a release, what's cut, and in what order.
**Owns:** Product vision, scope, backlog prioritization, feature decisions.
**Doesn't own:** Not growth/marketing, doesn't write final copy, doesn't build the screen itself, doesn't
touch the backend.
**Tools:** Baseline + running code/scripts, connection to a no-code build tool for fast prototyping.

### 4. User Researcher
**When to call them:** *Before* a screen gets designed, and *after* it's built - always at both points,
not just one.
**Owns:** Personas (who the user actually is, in practice, not in theory), a pre-build brief defining who
it's being built for and what would make them leave, and post-build validation - reading the product "as
if I were that user" against the original brief.
**Doesn't own:** Doesn't decide the business target audience (that's the CMO), doesn't decide scope
(CPO), not design consistency.
**Hard boundary:** **Has no write access to anything that goes live.** The entire role is judgment and
verdict, not execution.
**Tools:** Baseline only - reading, research, writing findings. Zero write access to code or the live
site.

### 5. Product Designer
**When to call them:** To actually build what the user sees and clicks on.
**Owns:** The screens, the flow, the UI - everything that gets built is built by them, out of an existing
design system.
**Doesn't own:** Not the backend, not final copy (receives it from the Copywriter), doesn't define new
design-system tokens/components on their own - that's done together with the Design System Lead.
**Tools:** Baseline + running code, connection to a design tool (Figma), connection to a no-code build
tool; full write access to the product's front-end code and to shipping it live.

### 6. Design System Lead
**When to call them:** *Before* any UI change, not just when something is missing - this is a mandatory
stop, not optional.
**Owns:** Tokens (color, spacing, typography), the documented component library, enforcing visual
consistency across the whole product.
**Doesn't own:** Doesn't build screens themselves (that's the Product Designer), not backend, not copy.
**Tools:** Baseline + running code, connection to a design tool; write access to the design system's
source of truth, not to the product's free-form code.

### 7. CTO
**When to call them:** To make something actually work - wire up an API, build the logic behind the
scenes, infrastructure.
**Owns:** All server/database/external-connection code; also the design of the technical team itself
(which agents are needed, with what permissions).
**Doesn't own:** Not UI, not copy, not marketing.
**Tools:** Baseline + full code execution - the only role in the roster with write access to the backend.

### 8. Copywriter
**When to call them:** Any text that goes live - headlines, button text, error messages, tone of voice.
**Owns:** The final word, in every language, on every surface - one consistent voice.
**Doesn't own:** Not the strategy behind the words (what to say, to whom - that's the CMO), doesn't build
UI itself.
**Tools:** Baseline only - reading and writing text. No write access to code; hands finished copy to the
Product Designer for implementation.

### 9. Marketing Designer
**When to call them:** Everything the brand *looks like* *outside* the product itself - decks, logo,
illustrations, social images.
**Owns:** The brand's visual language, brand assets, character/illustration consistency across
productions.
**Doesn't own:** Not the product's UI, not backend, not copy.
**Tools:** Baseline + running code, connection to a design tool, an image-generation pipeline.

> **"Baseline" for every role above** = reading files, writing/editing documents, searching the project,
> web search, and the ability to delegate a task to another agent on the team and wait for their answer.
> That's the minimum toolkit every role gets; beyond it, each role gets only what it genuinely needs -
> nothing more. **That's the real safeguard**: whoever doesn't need backend access physically doesn't
> have it.

---

## Part 2: How a Project Moves Through Everyone

This isn't "everyone works in parallel on everything." It's a sequence with order, clear handoff points,
and two quality checks before anything goes live.

**1. Open brief.** An unfinished direction comes in - a problem, an idea, "I want the product to do X" -
without a closed spec.

**2. Strategy.** The CSO checks: is this worth building *now*, against everything already on the table?
If yes - a rough direction comes out, not a full spec.

**3. Scope + user research, in parallel, ping-pong.** The CPO and the User Researcher work together
before a single line of code is written: what's required in a first version, for which specific user,
what would make them leave. What comes out is a written brief - not "build something good," but concrete
requirements.

**4. Parallel build, not sequential.** Once the direction is locked, several tracks run at the same time:
   - The Product Designer turns the decision into a real screen, through the design system (consulting
     the Design System Lead on every component - reuse existing, extend existing, or create new and
     document it).
   - The CTO builds what happens under the hood - the external connection, the logic, what makes it
     actually work.
   - The Copywriter writes the final copy.
   - The Marketing Designer builds the visual-brand layer around it.
   Each one takes what the role before them left off, and moves it one step forward - without waiting
   for the others to finish first.

**5. User check.** After the build is up, the User Researcher reads it *as if they were the user the
brief in step 3 was about* - not as if reviewing code. The verdict: works for this user / works with
notes / doesn't work - against the original brief, not off the cuff.

**6. Consistency check.** The Design System Lead reviews what was built against the rest of the product -
not "is this good," but "is this consistent with what already exists." User approval doesn't replace
this: a persona can love a screen that looks nothing like anything else in the product, because they
never saw the previous screen.

**7. Approval and going live.** Only after both checks pass - I review everything myself and approve.

**What holds all of this together: shared memory.** Every agent reads and writes to the same source of
truth - no need to re-brief each one from scratch every time. When something breaks in one project and
gets fixed, the team remembers it on the next project and doesn't repeat the same mistake. That's the
difference between "a few agents doing what they're told" and a team that genuinely gets more efficient
over time.

---

## How to Use This Yourself

- **Don't start with 9 roles.** Start with the 2-3 that hurt most right now (for example: who builds,
  who writes, who checks). Add a role only when you actually feel its absence.
- **For every role - one sentence on what they own, and one sentence on what they *don't* touch.** The
  boundary is what stops two agents from stepping on each other, not the list of what they do.
- **Give each role only the tools it actually needs.** Whoever writes copy doesn't need code access;
  whoever builds UI doesn't need backend access. This isn't paranoia - it's the safeguard that keeps a
  small mistake from becoming a big incident.
- **Document decisions in one place everyone reads.** The gap between "an agent team" and "a bunch of
  separate bots" is exactly this.
