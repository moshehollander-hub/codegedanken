// Co(de)Gedanken Bridge — service worker.
// Sends heartbeats, shows how many subtasks are waiting on the badge, and relays
// popup actions to the hub. It never runs anything in claude.ai on its own:
// a subtask is pasted only after the person clicks "Accept" in the popup, and
// the person presses Send in Claude themselves.

const ENVS = {
  prod: 'https://codegedanken.dev',
  local: 'http://localhost:3000',
};
const HEARTBEAT_ALARM = 'cg-heartbeat';

async function settings() {
  const s = await chrome.storage.local.get(['env', 'token', 'available', 'nodeId']);
  if (!s.nodeId) {
    s.nodeId = 'node-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    await chrome.storage.local.set({ nodeId: s.nodeId });
  }
  return { env: s.env === 'local' ? 'local' : 'prod', token: s.token || '', available: Boolean(s.available), nodeId: s.nodeId };
}

async function api(method, path, body) {
  const s = await settings();
  if (!s.token) return { status: 401, data: { error: 'Add your API token in the popup first.' } };
  try {
    const res = await fetch(ENVS[s.env] + path, {
      method,
      headers: { authorization: 'Bearer ' + s.token, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: { error: 'Hub unreachable: ' + (e && e.message ? e.message : e) } };
  }
}

async function heartbeat() {
  const s = await settings();
  if (!s.token) {
    await chrome.action.setBadgeText({ text: '' });
    return null;
  }
  const idleState = await chrome.idle.queryState(300);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const r = await api('POST', '/api/nodes/heartbeat', { nodeId: s.nodeId, available: s.available, idleState, timezone });
  if (r.status === 200) {
    const n = r.data.availableSubtasks;
    await chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    await chrome.action.setBadgeText({ text: s.available && n > 0 ? String(Math.min(n, 99)) : '' });
    await chrome.storage.local.set({ me: r.data.user, lastHeartbeat: Date.now() });
  } else {
    await chrome.action.setBadgeText({ text: '!' });
  }
  return r;
}

async function openClaudeWithPrompt(prompt, subtaskId) {
  // The content script picks this up, pastes it into the composer and shows an overlay.
  await chrome.storage.local.set({ pendingPrompt: { prompt, subtaskId, at: Date.now() } });
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  const codeTab = tabs.find((t) => t.url && t.url.startsWith('https://claude.ai/code'));
  if (codeTab && codeTab.id !== undefined) {
    await chrome.tabs.update(codeTab.id, { active: true });
    if (codeTab.windowId !== undefined) await chrome.windows.update(codeTab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: 'https://claude.ai/code' });
  }
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === HEARTBEAT_ALARM) heartbeat(); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'heartbeat':
        return heartbeat();
      case 'me':
        return api('GET', '/api/me');
      case 'pull':
        return api('GET', '/api/tasks/pull');
      case 'accept': {
        const r = await api('POST', `/api/subtasks/${encodeURIComponent(msg.subtaskId)}/claim`);
        if (r.status === 200) {
          await chrome.storage.local.set({ activeClaim: r.data });
          await openClaudeWithPrompt(r.data.prompt, r.data.subtask.id);
        }
        return r;
      }
      case 'repaste': {
        const { activeClaim } = await chrome.storage.local.get('activeClaim');
        if (activeClaim) await openClaudeWithPrompt(activeClaim.prompt, activeClaim.subtask.id);
        return { status: 200 };
      }
      case 'complete': {
        const r = await api('POST', `/api/tasks/${encodeURIComponent(msg.subtaskId)}/complete`, { prUrl: msg.prUrl });
        if (r.status === 200) await chrome.storage.local.remove('activeClaim');
        return r;
      }
      case 'release': {
        const r = await api('POST', `/api/subtasks/${encodeURIComponent(msg.subtaskId)}/release`);
        await chrome.storage.local.remove(['activeClaim', 'pendingPrompt']);
        return r;
      }
      default:
        return { status: 400, data: { error: 'Unknown message.' } };
    }
  })().then(sendResponse);
  return true; // async response
});
