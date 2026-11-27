// Co(de)Gedanken Bridge — popup UI.
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const say = (text, cls = 'muted') => { $('msg').className = cls; $('msg').textContent = text; };

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

async function showMe() {
  const r = await send({ type: 'me' });
  if (r && r.status === 200) {
    const u = r.data.user;
    $('tier').textContent = u.tier;
    $('who').textContent = `${u.handle} · ${u.credits} credits`;
  } else {
    $('tier').textContent = 'not connected';
    $('who').textContent = '';
    if (r && r.data && r.data.error) say(r.data.error, 'warn');
  }
}

function renderOffer(o, claimed) {
  const box = $('offer');
  box.replaceChildren();
  box.append(
    el('p', {}, el('b', {}, o.subtask.title)),
    el('div', { class: 'muted' }, `for ${o.task.ownerHandle} · ${o.task.repoUrl} · +${o.creditsOnCompletion} credits`),
    el('pre', {}, o.prompt),
  );
  if (!claimed) {
    box.append(el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: async () => {
        const r = await send({ type: 'accept', subtaskId: o.subtask.id });
        if (r.status === 200) { say('Pasted into Claude Code. Review it there and press Send.', 'ok'); renderOffer(r.data, true); }
        else say(r.data.error || 'Could not accept.', 'warn');
      } }, 'I’ve read it — accept & paste'),
      el('button', { onclick: () => { box.replaceChildren(); say(''); } }, 'Skip'),
    ));
  } else {
    const pr = el('input', { placeholder: `${o.task.repoUrl}/pull/123` });
    box.append(
      el('label', {}, 'Pull request URL', pr),
      el('div', { class: 'row' },
        el('button', { class: 'go', onclick: async () => {
          const r = await send({ type: 'complete', subtaskId: o.subtask.id, prUrl: pr.value.trim() });
          if (r.status === 200) { say(`Thanks! You now have ${r.data.credits} credits.`, 'ok'); box.replaceChildren(); showMe(); }
          else say(r.data.error || 'Could not complete.', 'warn');
        } }, 'Mark complete'),
        el('button', { onclick: () => send({ type: 'repaste' }) }, 'Paste again'),
        el('button', { onclick: async () => { await send({ type: 'release', subtaskId: o.subtask.id }); box.replaceChildren(); say('Given back to the queue.'); } }, 'Give back'),
      ),
    );
  }
}

async function init() {
  const s = await chrome.storage.local.get(['env', 'token', 'available', 'activeClaim']);
  $('env').value = s.env === 'local' ? 'local' : 'prod';
  $('token').value = s.token || '';
  $('available').checked = Boolean(s.available);
  if (s.activeClaim) renderOffer(s.activeClaim, true);
  if (s.token) showMe();
}

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ env: $('env').value, token: $('token').value.trim() });
  say('Connecting…');
  const r = await send({ type: 'heartbeat' });
  if (r && r.status === 200) say('Connected.', 'ok');
  else say((r && r.data && r.data.error) || 'Could not connect.', 'warn');
  showMe();
});

$('available').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ available: e.target.checked });
  send({ type: 'heartbeat' });
});

$('pull').addEventListener('click', async () => {
  const r = await send({ type: 'pull' });
  if (r.status === 204) { $('offer').replaceChildren(); say('Nothing waiting right now.'); }
  else if (r.status === 200) { say(''); renderOffer(r.data, false); }
  else say(r.data.error || 'Could not reach the hub.', 'warn');
});

init();
