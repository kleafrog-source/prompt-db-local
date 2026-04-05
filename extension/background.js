// @ts-check

/**
 * @typedef {string} PromptId
 */

/**
 * @typedef {{
 *   id: PromptId;
 *   text: string;
 *   presetId?: string;
 *   batchId?: string;
 *   used: boolean;
 *   usedMeta?: {
 *     usedAt: number;
 *     url: string;
 *     tabId: number;
 *     windowId: number;
 *     chromeProfileId?: string;
 *   };
 *   tagColor?: string;
 *   tagNumber?: number;
 * }} PromptEntry
 */

/**
 * @typedef {{
 *   promptId: PromptId;
 *   usedAt: number;
 *   url: string;
 *   tabId: number;
 *   windowId: number;
 *   chromeProfileId?: string;
 * }} PromptUsage
 */

/**
 * @typedef {{
 *   presetId: string;
 *   pattern?: string;
 *   tagsInclude?: string[];
 *   tagsExclude?: string[];
 * }} BatchConfig
 */

/**
 * @typedef {{
 *   batchId: string;
 *   prompts: Array<{
 *     id: PromptId;
 *     text: string;
 *     presetId?: string;
 *     sequenceId?: string;
 *   }>;
 * }} BatchResult
 */

/**
 * @typedef {{
 *   prompts: Record<PromptId, PromptEntry>;
 *   activeBatchId?: string;
 * }} ExtensionState
 */

/**
 * @typedef {{
 *   apiBaseUrl: string;
 *   chromeProfileId: string;
 *   exportPresets: Array<{ id: string; label: string; description?: string }>;
 * }} ExtensionSettings
 */

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3210';
const STORAGE_STATE_KEY = 'promptDbExtensionStateV2';
const STORAGE_SETTINGS_KEY = 'promptDbExtensionSettingsV2';
const PRODUCER_URL_PATTERN = /^https:\/\/([^/]+\.)?producer\.ai\//i;

/** @type {ExtensionState} */
let extensionState = {
  prompts: {},
  activeBatchId: undefined,
};

/** @type {ExtensionSettings} */
let extensionSettings = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  chromeProfileId: '',
  exportPresets: [],
};

let initializationPromise = loadPersistedState();

const ensureInitialized = async () => {
  await initializationPromise;
};

function hashColor(input) {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33 + input.charCodeAt(index)) | 0;
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 68% 52%)`;
}

/**
 * @param {number} index
 */
function createTagNumber(index) {
  return index + 1;
}

async function loadPersistedState() {
  const result = await chrome.storage.local.get([STORAGE_STATE_KEY, STORAGE_SETTINGS_KEY]);
  extensionState = result[STORAGE_STATE_KEY] || extensionState;
  extensionSettings = {
    ...extensionSettings,
    ...(result[STORAGE_SETTINGS_KEY] || {}),
  };
}

async function persistAll() {
  await chrome.storage.local.set({
    [STORAGE_STATE_KEY]: extensionState,
    [STORAGE_SETTINGS_KEY]: extensionSettings,
  });
}

function getPromptList() {
  return Object.values(extensionState.prompts).sort((left, right) => {
    if (left.used !== right.used) {
      return Number(left.used) - Number(right.used);
    }

    return (left.tagNumber || 0) - (right.tagNumber || 0);
  });
}

async function sendRuntimeUpdate() {
  const payload = {
    prompts: getPromptList(),
    activeBatchId: extensionState.activeBatchId,
    chromeProfileId: extensionSettings.chromeProfileId,
  };

  try {
    await chrome.runtime.sendMessage({
      type: 'PROMPTS_UPDATED',
      payload,
    });
  } catch {}

  try {
    await chrome.runtime.sendMessage({
      type: 'SETTINGS_UPDATED',
      payload: {
        chromeProfileId: extensionSettings.chromeProfileId,
      },
    });
  } catch {}

  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => tab.id && PRODUCER_URL_PATTERN.test(tab.url || ''))
      .map(async (tab) => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'PROMPTS_UPDATED',
            payload,
          });
        } catch {}
      }),
  );
}

/**
 * @param {string} path
 * @param {'GET'|'POST'} method
 * @param {unknown=} payload
 */
async function requestLocalApp(path, method, payload) {
  const response = await fetch(`${extensionSettings.apiBaseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: method === 'POST' ? JSON.stringify(payload || {}) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Local app request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchExportPresets() {
  const result = await requestLocalApp('/api/exportPresets', 'GET');
  extensionSettings.exportPresets = Array.isArray(result.presets) ? result.presets : [];
  await persistAll();
  return extensionSettings.exportPresets;
}

/**
 * @param {BatchConfig} config
 */
async function generateBatch(config) {
  /** @type {BatchResult} */
  const batchResult = await requestLocalApp('/api/generateBatch', 'POST', config);
  /** @type {Record<PromptId, PromptEntry>} */
  const nextPrompts = {};

  batchResult.prompts.forEach((prompt, index) => {
    const previous = extensionState.prompts[prompt.id];

    nextPrompts[prompt.id] = {
      id: prompt.id,
      text: prompt.text,
      presetId: prompt.presetId || config.presetId,
      batchId: batchResult.batchId,
      used: previous?.used ?? false,
      usedMeta: previous?.usedMeta,
      tagColor: previous?.tagColor || hashColor(`${batchResult.batchId}:${index}`),
      tagNumber: previous?.tagNumber || createTagNumber(index),
    };
  });

  extensionState = {
    prompts: nextPrompts,
    activeBatchId: batchResult.batchId,
  };
  await persistAll();
  await sendRuntimeUpdate();

  return getPromptList();
}

async function getActiveProducerTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (!tab?.id || !PRODUCER_URL_PATTERN.test(tab.url || '')) {
    throw new Error('Active producer.ai tab not found.');
  }

  return tab;
}

/**
 * @param {PromptUsage} usage
 * @param {'prompt_used' | 'prompt_sent_message'} source
 */
async function reportPromptUsage(usage, source) {
  await requestLocalApp('/api/promptUsage', 'POST', {
    ...usage,
    usedAt: usage.usedAt,
    chromeProfileId: usage.chromeProfileId || extensionSettings.chromeProfileId || undefined,
    source,
  });
}

/**
 * @param {PromptId} promptId
 * @param {PromptUsage} usage
 */
async function markPromptUsed(promptId, usage) {
  const entry = extensionState.prompts[promptId];

  if (!entry) {
    return null;
  }

  extensionState.prompts[promptId] = {
    ...entry,
    used: true,
    usedMeta: {
      usedAt: usage.usedAt,
      url: usage.url,
      tabId: usage.tabId,
      windowId: usage.windowId,
      chromeProfileId: usage.chromeProfileId,
    },
  };

  await persistAll();
  await sendRuntimeUpdate();

  return extensionState.prompts[promptId];
}

chrome.runtime.onInstalled.addListener(() => {
  initializationPromise = loadPersistedState();
});

chrome.runtime.onStartup.addListener(() => {
  initializationPromise = loadPersistedState();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    await ensureInitialized();

    if (message?.type === 'GENERATE_BATCH') {
      const prompts = await generateBatch(message.payload);
      sendResponse({
        ok: true,
        prompts,
      });
      return;
    }

    if (message?.type === 'GET_PROMPTS') {
      sendResponse({
        ok: true,
        prompts: getPromptList(),
        activeBatchId: extensionState.activeBatchId,
      });
      return;
    }

    if (message?.type === 'GET_EXPORT_PRESETS') {
      const presets = await fetchExportPresets();
      sendResponse({
        ok: true,
        presets,
      });
      return;
    }

    if (message?.type === 'GET_SETTINGS') {
      sendResponse({
        ok: true,
        settings: extensionSettings,
      });
      return;
    }

    if (message?.type === 'UPDATE_SETTINGS') {
      extensionSettings = {
        ...extensionSettings,
        ...(message.payload || {}),
      };
      await persistAll();
      await sendRuntimeUpdate();
      sendResponse({
        ok: true,
        settings: extensionSettings,
      });
      return;
    }

    if (message?.type === 'INSERT_PROMPT_REQUEST') {
      const entry = extensionState.prompts[message.payload.promptId];

      if (!entry) {
        throw new Error('Prompt was not found in extension state.');
      }

      if (entry.used) {
        throw new Error('Prompt is already marked as used.');
      }

      const tab = await getActiveProducerTab();
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: 'INSERT_PROMPT',
        payload: {
          promptId: entry.id,
          text: entry.text,
          tagColor: entry.tagColor,
          tagNumber: entry.tagNumber,
        },
      });

      sendResponse({
        ok: Boolean(result?.ok),
        result,
      });
      return;
    }

    if (message?.type === 'PROMPT_USED' || message?.type === 'PROMPT_SENT_MESSAGE') {
      const source = message.type === 'PROMPT_SENT_MESSAGE' ? 'prompt_sent_message' : 'prompt_used';
      const usage = {
        promptId: message.payload.promptId,
        usedAt: Number(message.payload.usedAt || Date.now()),
        url: sender.tab?.url || message.payload.url || '',
        tabId: sender.tab?.id || message.payload.tabId || -1,
        windowId: sender.tab?.windowId || message.payload.windowId || -1,
        chromeProfileId: extensionSettings.chromeProfileId || undefined,
      };

      await markPromptUsed(usage.promptId, usage);
      await reportPromptUsage(usage, source);

      sendResponse({
        ok: true,
        prompt: extensionState.prompts[usage.promptId] || null,
      });
      return;
    }

    sendResponse({
      ok: false,
      error: `Unsupported message type: ${String(message?.type || 'unknown')}`,
    });
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown extension background error',
    });
  });

  return true;
});
