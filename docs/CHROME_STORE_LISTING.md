# Chrome Web Store: העלאת Co(de)Gedanken Bridge

כל הטקסטים כאן אושרו. מעתיקים כל אחד לשדה שלו.

## שלב 1: העלאה

1. נכנסים ל־https://chrome.google.com/webstore/devconsole
2. לוחצים **New item** (פריט חדש).
3. בוחרים את הקובץ:
   `C:\Users\moshe\Dropbox\מטלות\משה\פרטיים\codegedanken\dist-store\codegedanken-bridge-0.1.1.zip`

## שלב 2: לשונית Store listing

**Description:**

```
Help someone's code on your night, get help on theirs.

Co(de)Gedanken Bridge connects the Co(de)Gedanken help-exchange (codegedanken.dev) with Claude Code on the web. Before you go to sleep, it shows you a subtask from a developer in another time zone. You read the full prompt and decide. If you click Accept, the extension pastes the prompt into your own Claude Code tab. You press Send yourself, and Claude works on it while you sleep. Each subtask ends as a pull request on the requester's repo.

• A human approves every run. The extension never presses Send and never sends anything on its own.
• Everyone uses only their own Claude account. No credentials are shared.
• No money: credits are a time bank, earned by helping and spent by asking.
• Open source (MIT): github.com/moshehollander-hub/codegedanken

Not affiliated with or endorsed by Anthropic.
```

- **Category:** Developer Tools
- **Language:** English
- **Store icon (128x128):** `extension\icons\icon128.png`
- **Screenshots (1280x800):** `docs\assets\store-1.png` and `docs\assets\store-2.png`
- **Small promo tile (440x280):** `docs\assets\promo-small.png`
- **Homepage URL:** `https://codegedanken.dev`
- **Support URL:** `https://github.com/moshehollander-hub/codegedanken/issues`

## שלב 3: לשונית Privacy

**Single purpose description:**

```
Shows Co(de)Gedanken subtasks for the user to review, and after the user clicks Accept, pastes the accepted prompt into the Claude Code composer on claude.ai. The user always presses Send.
```

**Permission justifications:**

- **storage:**
  ```
  Stores the user's hub token, chosen hub URL and availability setting locally.
  ```
- **alarms:**
  ```
  Runs a once-per-minute heartbeat to the Co(de)Gedanken hub and refreshes the badge showing whether a subtask is offered.
  ```
- **idle:**
  ```
  Reports active/idle presence on the Co(de)Gedanken dashboard only. Idle state never triggers any action or run.
  ```
- **Host permissions:**
  ```
  claude.ai: the content script pastes the accepted prompt into the Claude Code composer and shows an overlay; it never submits. codegedanken.dev: the hub API for offers, claims, completion and heartbeat.
  ```

**Remote code:** `No, I am not using remote code`

**Data usage.** Tick only:

- **Authentication information:** the hub token.
- **User activity:** idle or active presence.

Tick all three certification boxes (no selling of data, no unrelated use, no creditworthiness use).

**Privacy policy URL:** `https://codegedanken.dev/privacy`

## שלב 4: Distribution

- **Payments:** Free
- **Visibility:** Public
- **Regions:** All regions

## שלב 5: הגשה

לוחצים **Submit for review**. הבדיקה לוקחת בדרך כלל כמה ימים.
