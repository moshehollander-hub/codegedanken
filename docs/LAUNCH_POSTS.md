# Launch posts: drafts

Everything here is a draft. Read it, edit it, and post it yourself. Repo: https://github.com/moshehollander-hub/codegedanken

---

## Hacker News: Show HN

**Title:** Show HN: Co(de)Gedanken – help someone's code on your night, get help on theirs

**Text:**

I kept ending the day with a list of small, well-defined changes and no energy left to do them. Co(de)Gedanken
is a small open-source experiment: a help-exchange between developers who use Claude Code on the web.

How it works:

- You describe a task as a bullet list. A simple decomposer groups bullets so that no two subtasks touch the
  same file (so the resulting PRs don't conflict).
- Before going to sleep, a developer in another time zone sees a subtask in a Chrome extension, reads the full
  prompt, accepts it, and runs it in their own Claude Code session, which works on it overnight. The extension
  pastes the prompt; the person presses Send.
- On your night, you do the same for someone else.
- Each subtask becomes a PR on your repo. Helpers earn credits; you spend them. Credits are a time bank, so
  there's no money involved.

Stack: Fastify + SQLite (node:sqlite), a Manifest V3 extension, TypeScript shared types. MIT.

Things I'd love feedback on: the decomposer heuristic (bullets + file mentions + union-find), and how to keep
review quality high when strangers open PRs on your repo.

Code: https://github.com/moshehollander-hub/codegedanken · Site: https://codegedanken.dev

---

## Reddit: r/ClaudeAI

**Title:** I built a time-zone "help exchange" for Claude Code users: help on your night, get help on theirs

**Body:**

Open-source side project. You post a task (bullet list), it's split into non-overlapping subtasks, and
people in other time zones pick them up before they go to sleep, in their own Claude Code on the web session.
On your night, you do the same for someone else. A small Chrome extension
shows the subtask, and if you accept it, pastes it into Claude Code. You still read it and press Send yourself.
Every subtask ends as a PR on the requester's repo.

- No account sharing: everyone uses their own Claude account.
- No money: credits are earned by helping and spent by asking.
- Helpers should connect only repos they use for the exchange.

Not affiliated with Anthropic. Feedback welcome, especially on the safety model. https://github.com/moshehollander-hub/codegedanken

---

## Reddit: r/opensource

**Title:** Co(de)Gedanken: MIT-licensed task exchange that turns one task into several conflict-free PRs

**Body:**

Co(de)Gedanken is a small monorepo (Fastify + SQLite hub, MV3 Chrome extension, shared TS types) for a
developer help-exchange. The interesting bit is the decomposer: it splits a task description into subtasks
and merges any that mention the same file, so contributors working in parallel don't produce conflicting PRs.

Looking for contributors on: better decomposition, GitHub App integration to verify PRs, and i18n.
https://github.com/moshehollander-hub/codegedanken

---

## X / Twitter

**Thread:**

1/ Help someone's code on your night. Get help on theirs.
Co(de)Gedanken is an open-source help-exchange for Claude Code users across time zones. 🧠🌍

2/ Your task gets split into subtasks that don't touch the same files. Before bed, someone in another time zone
reads one, accepts it, and runs it in their own Claude session overnight. On your night, you do the same.

3/ No money and no account sharing. A human presses Send every time. Credits are a time bank.

4/ MIT licensed: Fastify + SQLite + an MV3 extension. Code: https://github.com/moshehollander-hub/codegedanken
Site: https://codegedanken.dev
