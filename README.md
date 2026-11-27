# Co(de)Gedanken

**Queue your task before bed. Wake up to pull requests.**

Co(de)Gedanken is an open-source help-exchange for developers who use Claude Code on the web. Your task is
split into subtasks that don't touch the same files. Developers in other time zones review a subtask, accept
it, and run it in **their own** Claude session; each one comes back to you as a pull request. You return the
favour during your day. Credits are a time bank, not money.

- **Web Hub**: landing page, dashboard, task decomposer and bridge API (`web-hub/`)
- **Bridge extension**: Chrome MV3; shows subtasks, pastes the ones you accept into Claude Code. **You always press Send.** (`extension/`)
- **Shared**: types, tier config, decomposer, prompt builder (`shared/`)

## Run locally

```bash
npm install
npm test        # build + all tests
npm start       # http://localhost:3000
```

Load the extension: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → choose the `extension/`
folder. In the popup, pick `localhost:3000`, paste the API token you got when registering, and save.

## Deploy

The hub ships as a Docker image (`Dockerfile`) with configs for Render (`render.yaml`) and Railway
(`railway.json`). Mount a persistent volume at `/data` for the SQLite database.

## Principles

- A human reads and approves every subtask before it runs, in their own account.
- No money changes hands; credits can't be bought or sold.
- Plans are self-declared and only weight starting credits and priority.

Co(de)Gedanken is independent and not affiliated with or endorsed by Anthropic. MIT licensed.
