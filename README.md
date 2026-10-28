# Pathways

Plan the way from **where you are** to **where you want to be**. Pathways is a local-first visual planner: your current situation on the left, your goals on the right, and several competing paths of steps between them. An AI connects over MCP to generate paths, research steps and re-plan when things change, and git is how a team shares the plans (no hosting needed).

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/Problem99-io/pathways.git
cd pathways
npm install
npm run dev
```

Open http://localhost:5317. The API and MCP server run on http://localhost:4317.

To load a sample plan, built entirely through MCP tool calls the way an AI would build it:

```bash
npm run demo
```

## What's in it

- **Graph, left to right.** NOW → steps → goals. Each path is its own lane with its name, the time it has left, its odds and its progress. Nodes spring into place when the plan changes.
- **Multiple goals, multiple paths.** Each goal can have several competing paths. The ⚡ marks the quickest one.
- **Several fronts at once.** Mark each path you're actually working with ▶ *pursue* (on its lane label, chip menu or in Forward). Every pursued path keeps its own "you are here". Each one gets its own pin, and the fog clears around all of them at the same time. Paths you aren't pursuing stay visible as options in the mist.
- **Forward (`W`)** is one place to see everything ahead of you. For every goal it shows each path you're pursuing: where you are, progress against plan, and the next milestone. Below that it lists what's ready to do now across all of them, ongoing loops and when they're due, what's coming up next, what's blocked, and other paths you could start. It can be filtered by person.
- **Milestones** are intermediate goals on a path. They can have target dates, they're forecast against the plan, and they show as diamonds on the progress bar.
- **Possible futures.** Any step can be a fork: after it, the future can go several ways.
  - **Chance** outcomes have odds ("25% the round closes, 60% it doesn't, 15% an accelerator offer"). **Choice** outcomes are options you'll pick between.
  - Each outcome leads to its own steps, and the branches can merge back.
  - The prediction engine weighs every combination. It shows the expected time, the best and worst case, how likely each step is to happen, and which option is quickest. More likely futures are drawn with thicker lines.
  - When it plays out, say **What happened?** The other futures fade as *didn't happen*, "you are here" moves into the branch that happened, and the forecast tightens.
  - **Paths can intertwine.** A future can *switch to another path* partway in. For example: "start on Plan A, but if the client leaves, move to Plan B at *Launch to waitlist*". The forecast follows the route across both paths. When it happens, you start on Plan B at that step, and its earlier steps are skipped. Right-click a step → **Possible futures → If something happens, switch to…**, or choose **Leads to** on an outcome.
  - Use **Futures** in the step panel or right-click → **Possible futures**. The AI uses `branch_step` / `settle_branch`.
  - Each fork's outcomes sit in a column of pills right after the step, and each line leaves its pill for where that future goes.
- **Playbooks.** A goal's paths start out side by side. Pick one to **start with** (on its lane label, or right-click the goal → **Start with…**), and the others don't get thrown away: they become **backup plays**. Each backup is laid out off the fork that switches to it, starting at the step you'd join it. The steps you'd skip by switching in are hidden. A path no fork reaches is marked *not in the playbook*. Right-click the goal → **Show paths side by side** to go back. The AI uses `set_goal` with `openingPathId`.
- **Recurring steps** are ongoing loops, like growing an audience or doing outreach. Their sub-steps are one cycle, and drilling in shows the loop arc. Log a cycle along with the metric value at that point.
- **Sub-paths.** Any step can contain its own steps. Use **Break down** or double-click a step to drill in, with breadcrumbs back out.
- **Focus fog.** Everything except where you are on each pursued path, and what comes next there, fades into mist. Toggle it with `F`.
- **Trackpad or mouse.** By default two-finger scroll pans and pinch zooms (`⌘`/`Ctrl` + scroll zooms too). The hand/mouse button in the bottom-left controls switches to mouse mode, where the wheel zooms and you drag to pan. The choice is remembered.
- **Path highlight.** Click a path name or its chip. Other paths recede, the route gets numbered, and an overview lists what's left on it and where it leads.
- **Search.** `⌘K` or `/` searches paths, goals, milestones, steps, requirements, references, people and changes, then takes you to the result.
- **Planned vs actual.** Steps record when they started and finished. The progress bar shows how far through the plan you should be against how far you actually are, how many days ahead or behind you are, a forecast end date and the deadline. Expand it for a chart and a comparison of all paths.
- **Prediction engine.** For each path it calculates the critical path, the odds that every step goes to plan, and the *expected* time to the goal. Expected time stretches each step by 1/confidence, because a step that fails gets retried.
- **Step panel.** Edit the kind, status, estimates, schedule, requirements checklist, sub-steps, people, dependencies and references (images by drag, drop or paste; links with previews; notes). From the panel you can also set "I'm here", Complete, or "What if…", which forks the path from this step.
- **Context.** Where you are, the goals, free-form context for the AI, *What changed?* signals, requests for the AI, the team, and pathway-wide references.
- **People.** Assign steps to people and click an avatar to highlight their work.
- **Who you are.** Pick yourself from the team with the avatar button at the top right, or type a name. It's saved in this browser only and never written to the pathway, so everyone sharing the repo picks their own. Your edits, AI requests and "Assign to me" use it.
- **Right-click anything.** Steps, path labels and chips, goals, where-you-are, connections and the empty canvas all have a context menu. From it you can rename, change status or kind, assign, add the next or parallel step, break down, fork, pursue, recolour, leave a request for the AI, delete and more. Arrow keys move through it, `→` opens a submenu, and `Esc` backs out.

Keyboard shortcuts: `⌘K` search · `W` forward · `F` fog · `Tab`/`N` add the next step · `Enter` drill in · `.` I'm here · `C` complete · `Esc` back, close or clear.

## Chat with Claude in the app

The **Claude** button opens a chat panel, so you don't have to switch to a terminal. Each message runs [Claude Code](https://claude.com/claude-code) headless on your computer. It's connected to this app's MCP server and given the planning skill, and its changes land on the canvas as it works. As the reply streams in you can see each tool call ("Added 4 steps", "Searched …").

- **Conversation and history:** there's one ongoing conversation per pathway, so Claude remembers earlier messages. History is saved in `workspace/.chat/`, which is git-ignored, so it stays on your computer.
- **Selected step:** if a step is selected, it's attached to your message as context. Click the chip to leave it out.
- **Right-click:** the *Ask AI* items and *Ask Claude about this…* on a step send straight to the chat.
- **Controls:** *Stop* interrupts a reply, and *New chat* starts over.
- **Setup:** Pathways finds `claude` on your `PATH`, in the usual install folders, or bundled with the Claude desktop app. It needs to be logged in once with `claude auth login`, or you can start Pathways with `ANTHROPIC_API_KEY` set. Settings (the gear icon) let you choose a different binary or model.
- **Tools Claude can use:** in the chat, Claude can use only the Pathways tools, web search and web fetch. It has no shell access and can't edit files.

## Connect an AI

MCP endpoint: `http://localhost:4317/mcp` (Streamable HTTP).

**Claude Code.** This folder's `.mcp.json` already registers the server. To use it from anywhere:

```bash
claude mcp add --transport http pathways http://localhost:4317/mcp
```

**The planning skill** (`.claude/skills/pathways/SKILL.md`) teaches the AI how to generate several genuinely different paths, write milestones, model recurring loops, make honest estimates and re-plan after changes. It's picked up automatically inside this folder. To install it globally:

```bash
mkdir -p ~/.claude/skills && cp -R .claude/skills/pathways ~/.claude/skills/
```

**Claude Desktop and other stdio clients.** The stdio server talks to the running app:

```json
{ "mcpServers": { "pathways": { "command": "npx", "args": ["-y", "tsx", "/absolute/path/to/pathways/mcp/stdio.ts"] } } }
```

Then ask things like *"Use the pathways skill to generate 3 paths for my pathway and tell me the quickest."* The **AI** panel in the app has ready-made prompts and shows a live feed of what the AI changed.

Tools: `list_pathways`, `get_pathway`, `create_pathway`, `update_pathway`, `set_goal`, `create_path`, `add_steps`, `update_step`, `delete_step`, `connect_steps`, `set_current_step`, `complete_step`, `log_cycle`, `update_path`, `delete_path`, `fork_path`, `assign_people`, `add_reference`, `record_signal`, `resolve_request`, `branch_step`, `settle_branch`, `get_forward`, `compare_paths`. `get_forward` returns the same "what's next across everything" view as the Forward panel. `set_current_step` and `update_path` (`pursuing`) move each path's position independently.

## Share with a team using git

Plans are plain files, so the source of truth is a git repo:

```
workspace/
  <pathway>/
    pathway.json      where you are, goals, context, paths, people, signals
    nodes/<id>.json   one file per step, so concurrent edits rarely conflict
    activity.jsonl    append-only log (merge=union)
    assets/           uploaded images and files
```

Open **Sync** in the app and click **Start tracking with git**, optionally with a remote URL. From then on, **Sync now** commits your changes with an auto-generated message, pulls your teammates' changes and pushes. You can also turn on auto-sync. Changes pulled from teammates show up live. If two people edit the same lines, you choose *Keep mine* or *Keep theirs*.

To point the app at any folder, for example a clone of your team's plans repo or a `plans/` folder inside an existing repo:

```bash
PATHWAYS_DIR=~/code/team-plans npm run dev
```

It uses your own git install and credentials, and everything stays on your machine.

## Layout

```
shared/   data model, ops (every change is an op), prediction engine
server/   Express API, live events (SSE), git sync, file storage, MCP over HTTP
mcp/      MCP tools + stdio entry
src/      React app (React Flow, Motion, Zustand)
scripts/  demo seeding via MCP
```

Environment variables: `PATHWAYS_DIR` (workspace folder), `PATHWAYS_PORT` (API port, default 4317), `PATHWAYS_URL` (for the stdio MCP server and the demo script).

`npm start` builds the app and serves everything from port 4317.

## License

MIT. See [LICENSE](LICENSE).
