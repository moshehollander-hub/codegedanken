# Co(de)Gedanken

**Help someone on your night. Get help on theirs.**

Co(de)Gedanken is an open-source help-exchange for developers who use Claude Code on the web. Before you go to
sleep, you pick a subtask from a developer in another time zone, read it, and press Send in **your own** Claude
session; Claude works on it while you sleep. When night comes where they live, someone does the same for your
task. Tasks are split into subtasks that don't touch the same files, and each one comes back as a pull request.
Credits are a time bank, not money.

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
