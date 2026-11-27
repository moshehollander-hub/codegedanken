# CLAUDE.md — Co(de)Gedanken

**Project:** `codegedanken` (stylized **Co(de)Gedanken**)
**Domains:** `codegedanken.dev` (primary) and `codegedanken.com` (301 redirect to `https://codegedanken.dev`)
**License:** MIT

## What it is

A help-exchange for developers who use Claude Code on the web. A developer submits a task before bed; the
**Gedanken Task Decomposer** splits it into subtasks that don't touch the same files; developers in other time
zones review a subtask, accept it, and run it **in their own Claude account**. Each subtask ends as a pull
request on the requester's repo. Helpers earn credits, requesters spend them.

The UX is two browser tabs, the **Co(de)Gedanken Web Hub** and **Claude Code on the web (claude.ai)**, bridged
by the **Co(de)Gedanken Bridge** Manifest V3 extension. End users never run local workers.

## Non-negotiable rules (agreed with the founder)

These keep the project within Anthropic's terms and protect helpers. Don't weaken them.

1. **A human approves every run.** The extension shows the full subtask prompt; the helper clicks *Accept*;
   the extension pastes the prompt into the Claude Code composer; **the helper presses Send**. The extension
   never clicks Send, never presses Enter, never sends follow-up messages, and never executes anything
   because the user is idle. `chrome.idle` is used only to report presence on the dashboard.
2. **No money.** Credits are an in-app time bank. They are never bought, sold, transferred for value or
   paid out. The project charges nothing.
3. **Each person uses only their own account.** No credentials, cookies or sessions are shared.
4. **Narrow repo access.** Prompts tell the helper's Claude to work on a fork of the requester's public repo
   and not touch any other repository. Helpers are advised to connect only the repos they use for the exchange.
5. **Tiers are self-declared** (there is no API to verify a Claude plan) and only weight starting credits and
   queue priority. Free-plan users are waitlisted.
6. The site states it is independent and not affiliated with or endorsed by Anthropic.

A future, fully-automated mode must use the **Claude API with the user's own API key**, not claude.ai.

## Tiers

| tier | allowed | baseCredits | priorityMultiplier |
|---|---|---|---|
| `free` | false | 0 | 0 |
| `pro_20` ($20/mo) | true | 100 | 1.0 |
| `max_100` ($100/mo) | true | 500 | 1.5 |
| `max_200` ($200/mo) | true | 1200 | 2.0 |
| `enterprise` | true | 2500 | 2.5 |

10 credits per subtask submitted; 10 credits earned per subtask completed for someone else.
Claims expire after 6 hours; a helper can hold at most 2 claims.

## PR footer

Every prompt instructs Claude to append to the PR description:

```
---
🧠 *Co-thought overnight via [Co(de)Gedanken](https://codegedanken.dev) — Collaborative Time-Zone AI Exchange*
```

## Repository layout (npm workspaces)

- `shared/`: TypeScript types (`SubscriptionTier`, `TIER_CONFIG`, `Task`, `SubTask`, `BrowserNode`,
  `WaitlistEntry`), validation, `decomposeTask`, `buildPrompt`, `PR_FOOTER`.
- `web-hub/`: Fastify + SQLite (Node's built-in `node:sqlite`, file `codegedanken.db`), Tailwind UI.
  `PORT = process.env.PORT || 3000`, `DB_PATH` env var.
  - `GET /`: landing page, two-tab bridge diagram, live time-zone balance, registration/waitlist.
  - `GET /dashboard`: submit task, decomposition preview, my tasks and PRs, active nodes, "help someone".
  - `POST /api/users/register` (free → 403 + waitlist), `GET /api/me`
  - `POST /api/tasks/preview`, `POST /api/tasks`, `GET /api/tasks`, `GET /api/tasks/:id`
  - Bridge: `POST /api/nodes/heartbeat`, `GET /api/tasks/pull` (offer only, no claim),
    `POST /api/subtasks/:id/claim`, `POST /api/subtasks/:id/release`, `POST /api/tasks/:subtaskId/complete`
  - Public: `GET /api/stats`, `GET /api/prs`, `GET /healthz`
- `extension/`: MV3 extension: `manifest.json`, `popup.html/js` (hub switch prod/localhost, token, tier badge,
  availability toggle, accept/complete/give back), `background.js` (heartbeat alarm, badge), `content.js`
  (pastes into the claude.ai composer and shows an overlay; never submits).
- `docs/LAUNCH_POSTS.md`: launch post drafts.
- `Dockerfile`, `render.yaml`, `railway.json`: cloud deployment of the hub.

## Commands

```
npm install
npm run build      # shared → web-hub → extension check
npm test           # build + unit tests + end-to-end API test + extension safety tests
npm start          # runs the hub on PORT (default 3000)
```

## Roadmap / remaining phases

1. Create a public GitHub repo `codegedanken` and push `main`.
2. Load the extension unpacked (`chrome://extensions` → Developer mode → Load unpacked → `extension/`). The user does this step.
3. Register `codegedanken.dev` + `codegedanken.com`. Stop at payment; the user pays.
4. Deploy the hub (Render or Railway, Docker, persistent disk at `/data`), point `codegedanken.dev` at it with
   SSL, and 301 `codegedanken.com` → `https://codegedanken.dev`.
5. Verify live: landing and dashboard over HTTPS, register the founder's account, connect the extension.
