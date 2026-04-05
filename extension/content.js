// @ts-check

/** @type {{ promptId: string; text: string; tagColor?: string; tagNumber?: number } | null} */
let lastInsertedPrompt = null;
/** @type {Set<string>} */
const usedPromptIds = new Set();
let observerStarted = false;

const BADGE_ATTRIBUTE = 'data-prompt-db-badge';
const MESSAGE_ATTRIBUTE = 'data-prompt-db-message';

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const findLastTextarea = () => {
  const textareas = [...document.querySelectorAll('textarea')].filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  return textareas[textareas.length - 1] || null;
};

const ensurePromptBadge = (target, payload) => {
  const host = target.parentElement || target;

  if (host && getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
  }

  /** @type {HTMLDivElement | null} */
  let badge = host.querySelector(`[${BADGE_ATTRIBUTE}="textarea"]`);

  if (!badge) {
    badge = document.createElement('div');
    badge.setAttribute(BADGE_ATTRIBUTE, 'textarea');
    badge.style.position = 'absolute';
    badge.style.top = '8px';
    badge.style.right = '8px';
    badge.style.zIndex = '999999';
    badge.style.padding = '6px 10px';
    badge.style.borderRadius = '999px';
    badge.style.fontSize = '11px';
    badge.style.fontWeight = '700';
    badge.style.boxShadow = '0 10px 30px rgba(0,0,0,0.12)';
    host.appendChild(badge);
  }

  badge.textContent = `USED #${payload.tagNumber || '?'}`;
  badge.style.background = payload.tagColor || '#3aa56c';
  badge.style.color = '#ffffff';
};

const decorateMessageNode = (node, payload) => {
  if (!(node instanceof HTMLElement)) {
    return;
  }

  if (node.querySelector(`[${BADGE_ATTRIBUTE}="${payload.promptId}"]`)) {
    return;
  }

  node.setAttribute(MESSAGE_ATTRIBUTE, payload.promptId);
  node.style.outline = `2px solid ${payload.tagColor || '#3aa56c'}`;
  node.style.outlineOffset = '4px';
  node.style.borderRadius = '14px';
  node.style.boxShadow = `0 0 0 4px color-mix(in srgb, ${payload.tagColor || '#3aa56c'} 18%, transparent)`;

  const badge = document.createElement('div');
  badge.setAttribute(BADGE_ATTRIBUTE, payload.promptId);
  badge.textContent = `#${payload.tagNumber || '?'} sent`;
  badge.style.display = 'inline-flex';
  badge.style.alignItems = 'center';
  badge.style.gap = '6px';
  badge.style.marginBottom = '8px';
  badge.style.padding = '4px 10px';
  badge.style.borderRadius = '999px';
  badge.style.background = payload.tagColor || '#3aa56c';
  badge.style.color = '#ffffff';
  badge.style.fontSize = '11px';
  badge.style.fontWeight = '700';

  node.prepend(badge);
};

const findMessageCandidate = (payload) => {
  const snippet = normalizeText(payload.text).slice(0, 80);

  if (!snippet) {
    return null;
  }

  const candidates = [...document.querySelectorAll('article, section, div, li, p')]
    .filter((node) => node instanceof HTMLElement)
    .filter((node) => !node.matches('textarea, input, form'))
    .filter((node) => !node.closest(`[${BADGE_ATTRIBUTE}]`))
    .filter((node) => normalizeText(node.textContent).includes(snippet));

  return /** @type {HTMLElement | null} */ (candidates[candidates.length - 1] || null);
};

const waitForSentMessageHighlight = (payload) => {
  const immediate = findMessageCandidate(payload);

  if (immediate) {
    decorateMessageNode(immediate, payload);
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, 6000);

    const observer = new MutationObserver(() => {
      const candidate = findMessageCandidate(payload);

      if (!candidate) {
        return;
      }

      window.clearTimeout(timeout);
      observer.disconnect();
      decorateMessageNode(candidate, payload);
      resolve(true);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
};

const notifyPromptEvent = (type, payload) =>
  chrome.runtime.sendMessage({
    type,
    payload: {
      promptId: payload.promptId,
      usedAt: Date.now(),
      url: location.href,
    },
  });

const triggerSentMessageFlow = (reason) => {
  if (!lastInsertedPrompt) {
    return;
  }

  const payload = lastInsertedPrompt;

  window.setTimeout(() => {
    void waitForSentMessageHighlight(payload).finally(() => {
      void notifyPromptEvent('PROMPT_SENT_MESSAGE', payload);
    });
  }, reason === 'keyboard' ? 450 : 900);
};

const installSendObservers = () => {
  if (observerStarted) {
    return;
  }

  observerStarted = true;

  document.addEventListener(
    'keydown',
    (event) => {
      const target = /** @type {HTMLElement | null} */ (event.target);

      if (!target || target.tagName !== 'TEXTAREA') {
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        triggerSentMessageFlow('keyboard');
      }
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      const target = /** @type {HTMLElement | null} */ (event.target);

      if (!target) {
        return;
      }

      const button = target.closest('button, [role="button"], input[type="submit"]');

      if (!button) {
        return;
      }

      const label = normalizeText(button.textContent || button.getAttribute('aria-label') || button.value);

      if (/send|submit|generate|run|chat|continue/i.test(label)) {
        triggerSentMessageFlow('button');
      }
    },
    true,
  );
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PROMPTS_UPDATED') {
    const prompts = Array.isArray(message.payload?.prompts) ? message.payload.prompts : [];
    usedPromptIds.clear();

    prompts.forEach((prompt) => {
      if (prompt?.used && prompt?.id) {
        usedPromptIds.add(prompt.id);
      }
    });

    sendResponse?.({ ok: true });
    return false;
  }

  if (message?.type !== 'INSERT_PROMPT') {
    return false;
  }

  const target = findLastTextarea();

  if (!target) {
    sendResponse({
      ok: false,
      error: 'No visible textarea found on this producer.ai page.',
    });
    return false;
  }

  if (usedPromptIds.has(message.payload.promptId)) {
    sendResponse({
      ok: false,
      error: 'Prompt is already marked as used in this browser session.',
    });
    return false;
  }

  target.focus();
  target.value = message.payload.text;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));

  lastInsertedPrompt = {
    promptId: message.payload.promptId,
    text: message.payload.text,
    tagColor: message.payload.tagColor,
    tagNumber: message.payload.tagNumber,
  };

  ensurePromptBadge(target, lastInsertedPrompt);
  installSendObservers();

  void notifyPromptEvent('PROMPT_USED', lastInsertedPrompt);

  sendResponse({
    ok: true,
    promptId: message.payload.promptId,
  });
  return false;
});

chrome.runtime.sendMessage(
  {
    type: 'GET_PROMPTS',
  },
  (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      return;
    }

    const prompts = Array.isArray(response.prompts) ? response.prompts : [];
    usedPromptIds.clear();

    prompts.forEach((prompt) => {
      if (prompt?.used && prompt?.id) {
        usedPromptIds.add(prompt.id);
      }
    });
  },
);
