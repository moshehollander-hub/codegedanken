// Co(de)Gedanken Bridge — content script for claude.ai.
// Pastes an accepted subtask into the Claude composer and shows a status overlay.
// It deliberately never clicks Send: the person reviews the prompt and sends it.

(() => {
  const OVERLAY_ID = 'cg-bridge-overlay';
  const COMPOSER_SELECTORS = [
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"][role="textbox"]',
    'fieldset div[contenteditable="true"]',
    'div[contenteditable="true"]',
    'textarea',
  ];
  const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

  function overlay(text, tone) {
    let el = document.getElementById(OVERLAY_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = OVERLAY_ID;
      el.setAttribute('role', 'status');
      Object.assign(el.style, {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647', maxWidth: '340px',
        padding: '10px 14px', borderRadius: '10px', font: '13px/1.4 system-ui, sans-serif',
        color: '#e2e8f0', background: '#1e1b4b', border: '1px solid #6366f1', boxShadow: '0 8px 30px rgba(0,0,0,.35)',
        cursor: 'pointer',
      });
      el.title = 'Click to dismiss';
      el.addEventListener('click', () => el.remove());
      document.documentElement.appendChild(el);
    }
    el.style.borderColor = tone === 'warn' ? '#f59e0b' : tone === 'ok' ? '#10b981' : '#6366f1';
    el.textContent = '🧠 Co(de)Gedanken: ' + text;
  }

  function findComposer() {
    for (const sel of COMPOSER_SELECTORS) {
      const nodes = [...document.querySelectorAll(sel)].filter((n) => n.offsetParent !== null);
      if (nodes.length) return nodes[nodes.length - 1];
    }
    return null;
  }

  function insert(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    // contenteditable (ProseMirror): select existing content and insert via the editing pipeline
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    if (document.execCommand('insertText', false, text)) return true;
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }

  function waitForComposer(timeoutMs) {
    return new Promise((resolve) => {
      const found = findComposer();
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = findComposer();
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(findComposer()); }, timeoutMs);
    });
  }

  let busy = false;
  async function handlePending() {
    if (busy) return;
    const { pendingPrompt } = await chrome.storage.local.get('pendingPrompt');
    if (!pendingPrompt || Date.now() - pendingPrompt.at > PENDING_MAX_AGE_MS) return;
    busy = true;
    try {
      overlay('waiting for the Claude Code composer…');
      const el = await waitForComposer(20000);
      if (!el) {
        try { await navigator.clipboard.writeText(pendingPrompt.prompt); } catch {}
        overlay('couldn’t find the message box. The prompt is on your clipboard — paste it, review it, then press Send.', 'warn');
      } else if (insert(el, pendingPrompt.prompt)) {
        overlay('subtask pasted. Read it, pick the right repository/environment, then press Send yourself.', 'ok');
      } else {
        overlay('paste failed. Use “Paste again” in the extension popup.', 'warn');
      }
      await chrome.storage.local.remove('pendingPrompt');
    } finally {
      busy = false;
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pendingPrompt && changes.pendingPrompt.newValue) handlePending();
  });
  handlePending();
})();
