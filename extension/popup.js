const statusNode = document.getElementById('status');
const previewNode = document.getElementById('preview');
const metricsNode = document.getElementById('metrics');
const sendButton = document.getElementById('send');
const scanButton = document.getElementById('scan');
const checkButton = document.getElementById('check');
const copyButton = document.getElementById('copy');

let lastExtraction = null;

const setStatus = (message, isError = false) => {
  statusNode.textContent = message;
  statusNode.classList.toggle('error', isError);
};

const renderMetrics = (metrics = {}) => {
  const items = [
    `${metrics.promptLikeCount ?? 0} prompt-like hits`,
    `${metrics.parsedPreviewCount ?? 0} parsed JSON blocks`,
    `${metrics.scriptCount ?? 0} script sources`,
    `${metrics.textBlockCount ?? 0} text blocks`,
  ];

  metricsNode.innerHTML = items.map((item) => `<span class="badge">${item}</span>`).join('');
};

const getActiveProducerTab = async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    throw new Error('Active tab was not found.');
  }

  return tab;
};

const extractCurrentPage = async () => {
  const tab = await getActiveProducerTab();
  const extraction = await chrome.tabs.sendMessage(tab.id, {
    type: 'EXTRACT_PRODUCER_JSON',
  });

  if (!extraction?.ok) {
    throw new Error(extraction?.error || 'Failed to extract mixed JSON payload from the page.');
  }

  lastExtraction = extraction.payload;
  previewNode.value = String(extraction.payload?.rawPayload || '').slice(0, 6000);
  renderMetrics(extraction.payload);

  return extraction.payload;
};

const pingLocalApp = async () => {
  const result = await chrome.runtime.sendMessage({
    type: 'PING_LOCAL_APP',
  });

  if (!result?.ok) {
    throw new Error(result?.error || 'Electron app is unavailable.');
  }

  return result;
};

const handleScan = async () => {
  setStatus('Scanning current producer.ai page...');
  const payload = await extractCurrentPage();
  setStatus(
    payload?.parsedPreviewCount > 0
      ? `Preview updated. Found ${payload.parsedPreviewCount} parsed JSON blocks.`
      : 'Preview updated. Mixed text was captured for local parsing.',
  );
};

const handleCheck = async () => {
  setStatus('Checking local Electron websocket...');
  await pingLocalApp();
  setStatus('Local Electron app is reachable on ws://127.0.0.1:3001');
};

const handleSend = async () => {
  setStatus('Preparing payload and sending it to the local database...');
  const payload = lastExtraction ?? (await extractCurrentPage());
  const rawPayload = String(payload?.rawPayload || '').trim();

  if (!rawPayload) {
    throw new Error('No page payload was extracted.');
  }

  await pingLocalApp();

  const result = await chrome.runtime.sendMessage({
    type: 'FORWARD_TO_LOCAL_APP',
    payload: rawPayload,
  });

  if (!result?.ok) {
    throw new Error(result?.error || 'Failed to send payload to Electron.');
  }

  setStatus(
    payload?.parsedPreviewCount > 0
      ? `Sent to Electron. Found ${payload.parsedPreviewCount} parsed JSON blocks on the page.`
      : 'Sent mixed page payload to Electron for local parsing.',
  );
};

const handleCopy = async () => {
  const payload = lastExtraction ?? (await extractCurrentPage());
  const rawPayload = String(payload?.rawPayload || '');

  if (!rawPayload.trim()) {
    throw new Error('Nothing to copy yet.');
  }

  await navigator.clipboard.writeText(rawPayload);
  setStatus('Raw mixed payload copied to clipboard.');
};

const bind = (node, handler) => {
  node.addEventListener('click', () => {
    Promise.resolve(handler()).catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Unexpected extension error.', true);
    });
  });
};

bind(scanButton, handleScan);
bind(checkButton, handleCheck);
bind(sendButton, handleSend);
bind(copyButton, handleCopy);

void handleScan().catch((error) => {
  setStatus(error instanceof Error ? error.message : 'Unable to scan current page.', true);
});
