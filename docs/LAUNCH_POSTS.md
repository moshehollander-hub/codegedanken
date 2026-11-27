# Launch posts: drafts

Everything here is a draft. Read it, edit it, and post it yourself. Replace `<repo-url>` before posting.

---

## Hacker News: Show HN

**Title:** Show HN: Co(de)Gedanken – queue a coding task at night, wake up to PRs from other time zones

**Text:**

I kept ending the day with a list of small, well-defined changes and no energy left to do them. Co(de)Gedanken
is a small open-source experiment: a help-exchange between developers who use Claude Code on the web.

How it works:

- You describe a task as a bullet list. A simple decomposer groups bullets so that no two subtasks touch the
  same file (so the resulting PRs don't conflict).
- Developers whose day is starting see a subtask in a Chrome extension, read the full prompt, accept it, and
  run it in their own Claude Code session. The extension pastes the prompt; the person presses Send. Nothing
  runs unattended.
- Each subtask becomes a PR on your repo. Helpers earn credits; you spend them. Credits are a time bank, so
  there's no money involved.

Stack: Fastify + SQLite (node:sqlite), a Manifest V3 extension, TypeScript shared types. MIT.

Things I'd love feedback on: the decomposer heuristic (bullets + file mentions + union-find), and how to keep
review quality high when strangers open PRs on your repo.

Code: <repo-url> · Site: https://codegedanken.dev

---

## Reddit: r/ClaudeAI

**Title:** I built a time-zone "help exchange" for Claude Code users: queue tasks at night, get PRs in the morning

**Body:**

Open-source side project. You post a task (bullet list), it's split into non-overlapping subtasks, and
people in other time zones pick them up in their own Claude Code on the web session. A small Chrome extension
shows the subtask, and if you accept it, pastes it into Claude Code. You still read it and press Send yourself.
Every subtask ends as a PR on the requester's repo.

- No account sharing: everyone uses their own Claude account.
- No money: credits are earned by helping and spent by asking.
- Helpers should connect only repos they use for the exchange.

Not affiliated with Anthropic. Feedback welcome, especially on the safety model. <repo-url>

---

## Reddit: r/opensource

**Title:** Co(de)Gedanken: MIT-licensed task exchange that turns one task into several conflict-free PRs

**Body:**

Co(de)Gedanken is a small monorepo (Fastify + SQLite hub, MV3 Chrome extension, shared TS types) for a
developer help-exchange. The interesting bit is the decomposer: it splits a task description into subtasks
and merges any that mention the same file, so contributors working in parallel don't produce conflicting PRs.

Looking for contributors on: better decomposition, GitHub App integration to verify PRs, and i18n.
<repo-url>

---

## X / Twitter

**Thread:**

1/ Queue a coding task before bed. Wake up to PRs.
Co(de)Gedanken is an open-source help-exchange for Claude Code users across time zones. 🧠🌍

2/ Your task gets split into subtasks that don't touch the same files. Someone whose day is starting reads one,
accepts it, and runs it in their own Claude session. You return the favour tomorrow.

3/ No money and no account sharing. A human presses Send every time. Credits are a time bank.

4/ MIT licensed: Fastify + SQLite + an MV3 extension. Code: <repo-url>
Site: https://codegedanken.dev
