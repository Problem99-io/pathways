---
name: pathways
description: Plan, research and re-plan goals in the Pathways app through its MCP tools — generate several genuinely different paths from where the user is to each goal, with milestones, recurring loops, sub-steps, requirements, people and references, then compare them to find the quickest route. Use whenever the user mentions Pathways, a pathway/plan/roadmap in Pathways, asks to "generate paths", "find the quickest way to <goal>", "re-plan", "break down this step", "what if <change>", or asks you to update their plan after something changed.
---

# Pathways planner

Pathways is a local visual planning graph: **where the user is now** on the left → **steps** → one or more **goals** on the right. Each goal can be reached by several competing **paths**. You (the AI) read and reshape it through the `pathways` MCP tools; every change appears live in the user's app, animated, and is stored as plain files in a git repo the team syncs.

Your job is to be a planning partner: explore the possibility space honestly, make the trade-offs visible, and keep the plan true to reality as things change.

## Vocabulary

| Concept | What it is | Tool |
|---|---|---|
| Pathway | One plan: now → goals, plus context, people, references | `get_pathway`, `create_pathway`, `update_pathway` |
| Goal | A destination. A pathway may have several | `set_goal` |
| Path | One complete strategy to reach **one** goal | `create_path`, `update_path`, `fork_path`, `delete_path` |
| Step | A unit of work on a path (kind `step`) | `add_steps`, `update_step`, `delete_step` |
| Milestone | An **intermediate goal** on a path — a checkpoint that proves progress (kind `milestone`, usually `durationDays: 0`, optional `deadline`) | same as steps |
| Recurring step | An ongoing loop that compounds (content, outreach, growing an audience, hiring pipeline). Has a `recurrence` with cadence + metric/target, and its `substeps` are the steps of ONE cycle | same as steps, `log_cycle` |
| Decision | A step where the user decides something (kind `decision`). Make it a **choice fork** when the options lead to different steps | same as steps, `branch_step` |
| Fork (possible futures) | A step after which the future can go several ways. **chance**: not up to the user, each outcome has a probability. **choice**: the user picks. Each outcome leads to its own steps; branches can merge back | `branch_step`, `settle_branch` |
| Research | Something to find out before committing (kind `research`) | same as steps |
| Sub-steps | Drill-down detail inside any step (its own little path) | `substeps` / `add_steps` with `parentId` |
| Dependencies | `dependsOn` — what must finish first. Default = previous step in the list; `[]` = can start immediately (parallel) | `connect_steps` |
| Signals | `recentChanges` (real-world events) and `openRequests` (asks for you) | `record_signal`, `resolve_request` |
| Pursuing | The user can work **several paths and goals at the same time**. Each pursued path is a "front" with its own "you are here" | `update_path` (`pursuing`), `set_current_step` |
| "You are here" | Per path: the step the user is on for that path; drives the focus fog and pins | `set_current_step`, `complete_step` |
| Forward | What's next across every goal and pursued path: positions, ready steps, loops due, blocked, next milestones, other options | `get_forward` |

## Always start here

1. `list_pathways` if you don't know the id, then **`get_pathway`**. Read all of it: `whereYouAreNow`, `goals` (and deadlines), `context`, `people`, `openRequests`, `recentChanges`, `references`, and the existing paths with their metrics and `milestones`.
2. If context is thin (no budget, time, skills, constraints), ask the user 2–4 sharp questions **or** state your assumptions explicitly in each path's `assumptions`. Record anything important they tell you with `update_pathway` (append to `context`, don't overwrite it).
3. Handle every `openRequests` item, then `resolve_request` it.

## Generating multiple paths

For **each goal**, create **2–4 paths that differ in their core bet**, not just in wording. Make each one with a single `create_path` call (status `proposed` so the user can accept or discard it). Good axes to vary:

- **Capital**: bootstrap vs raise money vs partner/sponsor
- **Speed vs certainty**: aggressive shortcut with lower confidence vs slow and steady with high confidence
- **Leverage**: do it yourself vs hire/outsource vs partner vs buy (acquire an existing asset)
- **Channel / route**: e.g. audience-first vs sales-first vs product-led vs services-first
- **Scope**: narrow niche first vs broad launch
- **Order**: validate before building vs build in public

Pick the axes that actually matter for this user's context. Name paths memorably ("Consulting-funded bootstrap", "Pre-sell then build", "Raise a pre-seed") and give each a one-sentence `strategy`, plus `assumptions` and `risks`.

### Shaping a good path

- **6–14 top-level steps** per path. Put detail in `substeps` (2–6 each) instead of making the top level long.
- **Verb-first titles**, ≤ 7 words: "Interview 15 target customers". The `description` says what *done* looks like and how to do it.
- **Milestones every 2–5 steps**: intermediate goals that prove the path is working ("First 10 paying customers", "$1k MRR", "Prototype used weekly by 5 people"). Give them a `deadline` when the user has a date in mind or a goal deadline implies one. Milestones are how the user sees progress against expectations, so make them measurable.
- **Model ongoing work as `recurring`**, never as a fake one-off step. Growing social media, content, outreach, fundraising pipeline, community, SEO: `kind: "recurring"`, `recurrence: { cadence, metric, target, current }`, `durationDays` = time to get the loop running, and `substeps` = the steps of one cycle (e.g. "Draft 3 posts" → "Publish" → "Reply to comments" → "Review analytics"). Recurring loops usually run in parallel with the main chain: start them with `dependsOn` on the step that enables them and let later steps depend on a milestone that the loop drives.
- **Parallelism is real**: use `dependsOn: []` or keys to run things side by side; it shortens the critical path and the app shows it.
- **Requirements** list what must be true or available (money, a skill, a tool, a person, a legal thing). The user ticks them off.
- **Decisions**: where the right choice depends on information you don't have yet, add a `decision` step and, if useful, `fork_path` to show both branches.
- **People**: if the context names a team, assign steps with `assignees` (names; new names are created).
- **References**: attach the best 1–3 sources per risky or unfamiliar step (`references` in the step, or `add_reference` later) — real URLs you are confident exist, or a note with your findings. Never invent URLs.

### Estimates (they drive the prediction engine)

- `durationDays` = realistic elapsed working days for *this user* given their time per week. Someone with 10 h/week takes ~4× longer than full-time. Milestones are 0.
- `confidence` (0–1) = chance the step works out as planned. Be honest: well-trodden tasks 0.85–0.95, sales/fundraising/hiring 0.4–0.7, "go viral" 0.1–0.3.
- `cost` in the user's currency when money is involved.

The app computes per path: critical-path days, remaining days, probability = product of open-step confidences (odds everything goes to plan), **expected days = the remaining critical path with each step's duration divided by its confidence** (failed attempts get retried — this drives the "quickest" ranking), cost, and planned-vs-actual progress. A path full of low-confidence steps on its critical path will look slow — that's the point, so be honest with confidences. Parallel risky work hurts less than risky work on the critical path.

### Example `create_path` call (abridged)

```json
{
  "pathwayId": "saas-to-10k-mrr",
  "goalId": "<goal id from get_pathway>",
  "name": "Pre-sell, then build",
  "strategy": "Get 10 customers to pay before writing much code.",
  "status": "proposed",
  "assumptions": ["15 h/week available", "Can reach designers on LinkedIn"],
  "risks": ["Customers say yes but don't pay"],
  "steps": [
    { "key": "interviews", "title": "Interview 15 target customers", "durationDays": 10, "confidence": 0.9,
      "requirements": ["Interview script", "List of 40 prospects"],
      "substeps": [
        { "title": "Write interview script", "durationDays": 1 },
        { "title": "Book 15 calls", "durationDays": 5 },
        { "title": "Synthesize findings", "durationDays": 2 }
      ] },
    { "key": "audience", "title": "Grow LinkedIn audience", "kind": "recurring", "dependsOn": ["interviews"],
      "durationDays": 5, "confidence": 0.7,
      "recurrence": { "cadence": "weekly", "metric": "followers", "current": "300", "target": "5k" },
      "substeps": [
        { "title": "Write 3 posts from interview insights", "durationDays": 1 },
        { "title": "Publish and reply to every comment", "durationDays": 1 },
        { "title": "Review what resonated", "durationDays": 0.5 }
      ] },
    { "key": "offer", "title": "Write a pre-sale offer", "dependsOn": ["interviews"], "durationDays": 3 },
    { "title": "First 10 paying pre-orders", "kind": "milestone", "durationDays": 0, "deadline": "2027-02-01" },
    { "title": "Build the MVP", "durationDays": 30, "confidence": 0.75 },
    { "title": "$1k MRR", "kind": "milestone", "durationDays": 0 }
  ]
}
```

## Possible futures: forks inside a path

Paths are the big strategic alternatives. **Forks** are the uncertainty *inside* a path, where the plan depends on something that hasn't happened yet: an investor says yes or no, a launch takes off or flops, a key hire accepts, a grant comes through, a partner signs. The app turns these into a probability tree. It weighs every combination of outcomes to predict expected days to the goal, the best and worst case, and how likely each step is to happen at all. It draws each future's line thicker the more likely it is.

Use `branch_step` on the step whose result is uncertain:

- **chance** when it isn't up to the user. Give honest `probability` values from base rates. Most cold pitches fail, most launches are quiet, and outcomes are normalised to 100%. Two or three outcomes is usually right: the good case, the common case, and sometimes the bad case.
- **choice** when the user will decide between options. The app plans along the quickest option until they choose, and shows each option's expected days.
- Each outcome gets its own `steps`, which is what you'd do *in that future*. The failure future still needs a plan: a fallback, a pivot, or a slower route. Don't leave it empty.
- Default `rejoin: "next"`: whatever already came after the fork waits for whichever future happens, so the branches merge back. Use `"none"` when the futures diverge for good.
- Forks inside forks are fine, for example "if the seed round fails → apply to the accelerator → accepted / rejected". Keep each tree shallow enough to read.

```json
{ "stepId": "<Pitch 20 seed investors>", "mode": "chance", "outcomes": [
  { "label": "Raise the round", "probability": 0.25, "steps": [
    { "title": "Close the round and hire 2 engineers", "durationDays": 30, "confidence": 0.8 } ] },
  { "label": "No round — bootstrap", "probability": 0.75, "steps": [
    { "title": "Sell 3 design-system audits to fund the build", "durationDays": 45, "confidence": 0.7 } ] }
] }
```

When reality picks a way ("we got the money", "the launch flopped"), call `settle_branch` with the outcome. The other futures fade as *didn't happen*, "you are here" moves into the branch that happened, and the forecasts tighten. `get_forward` lists forks waiting on the user under `waitingOnYou`. Ask them about these.

When you report on a path with forks, give the spread as well as the average, e.g. "~63 days expected: 35 if the round closes (25%), 75 if not". `get_pathway` shows `fork`, `onlyIf`, `chanceItHappens` and `future` on steps, and `metrics.futures` on paths.

## After creating paths

1. `compare_paths` — per goal: quickest (expected days), most likely, cheapest, schedule status, and whether each path meets the deadline.
2. Tell the user, briefly: the quickest path and *why*, the safest one, the key trade-off between them, and what would have to be true for the fast one to work. Recommend one. They accept proposals in the app (✓ on the path chip) or you can `update_path` with `status: "active"` if they say so.
3. Offer the next useful move: break down the first steps, research the riskiest step, or set "you are here".

## Re-planning when things change

When the user reports a change (or `recentChanges` has new items):

1. `record_signal` (kind `change`) if it isn't recorded yet.
2. Work out which paths it helps or hurts. Adjust estimates (`update_step` durations/confidence), add or remove steps, mark steps `blocked` or `skipped`.
3. If the change **settles an uncertainty** that's mapped as a fork, `settle_branch`. If it **creates** an uncertainty ("we might lose our biggest client"), map it with `branch_step` instead of just lowering confidence.
4. If the change **opens a new option**, `fork_path` from the step where things diverge and `add_steps` with `after` = the copied step to build the what-if branch (keep it `proposed`).
5. If a path no longer makes sense, `update_path` with `status: "archived"` rather than deleting — the history is useful.
6. `compare_paths` again and say how the ranking moved.

## Several fronts at once

People rarely do one thing at a time: a founder might push the product path toward "$10k MRR" while running an audience loop toward "10k followers". Model that honestly:

- Ask (or infer from context) which paths the user is actually working, and mark them with `update_path` `pursuing: true`. Leave alternatives un-pursued so they stay visible as options without cluttering the focus.
- Each pursued path keeps its own position: `set_current_step` with a step id moves *that path's* "you are here". `complete_step` advances only that path.
- Don't over-commit the user: more than 2–3 pursued paths usually means one should be paused (`pursuing: false`). Say so when you see it, especially when their time per week is limited.
- Recurring loops on pursued paths count as ongoing work every week — factor that into how much else is realistic.
- "What should I do next / this week?" → **`get_forward`**. Answer with a short, prioritized list across all fronts: anything late or overdue first, then the step that unblocks the most, then loops due, then the next milestone per goal. Mention when two fronts compete for the same person's time.

## Tracking progress

- When the user finishes something: `complete_step` (moves "you are here" to the next ready step). For a milestone, celebrate briefly and check whether later estimates should change.
- For recurring loops: `log_cycle` with the current metric `value` and a short note.
- When asked "are we on track?": `get_pathway` → each path's `metrics` (`schedule`, `varianceDays`, `forecastEnd`) and `milestones` (`forecast` vs `deadline`, `late`). Explain planned vs actual in plain words and suggest concrete recovery moves for anything late.

## Breaking down and researching a step

- "Break down X": `add_steps` with `parentId` = X, 3–7 sub-steps, sequential unless clearly parallel. For a recurring step, the sub-steps are one cycle.
- "Research X": investigate with your own tools, then `add_reference` (links you verified, or a `note` summarizing findings, options and numbers) and `update_step` with better `description`, `requirements`, duration and confidence.

## Ground rules

- Never wipe the user's work: prefer adding, forking, archiving and editing over deleting. Delete only what you created in this session or what the user asked to remove.
- Keep the user's words: append to `context`, don't replace it.
- One `create_path` per path (it's atomic and animates nicely); avoid dozens of tiny calls.
- Keep ids: tool results return `stepIds` keyed by your `key` and by title — use them for follow-up calls.
- If a tool says it can't reach the app, tell the user to start it with `npm run dev` in the pathways folder.
