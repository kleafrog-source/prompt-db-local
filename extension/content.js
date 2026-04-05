const tryParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const unique = (values) => [...new Set(values.filter(Boolean))];

const PROMPT_PATTERN = /prompt|template|system|instruction|content|message|variable|keyword/i;

const cleanText = (value) => String(value || '').split('\0').join('').trim();

const collectTextBlocks = () =>
  [...document.querySelectorAll('pre, textarea, code, script[type="application/json"], [data-json], [data-payload]')]
    .map((node) => cleanText(node.textContent || node.getAttribute?.('data-json') || node.getAttribute?.('data-payload')))
    .filter(Boolean);

const collectScriptPayloads = () =>
  [...document.scripts]
    .map((node) => cleanText(node.textContent))
    .filter(Boolean)
    .filter((text) => text.startsWith('{') || text.startsWith('[') || PROMPT_PATTERN.test(text));

const collectDataAttributes = () =>
  [...document.querySelectorAll('*')]
    .slice(0, 1200)
    .flatMap((node) =>
      [...node.attributes]
        .filter((attribute) => /json|payload|session|state/i.test(attribute.name))
        .map((attribute) => cleanText(attribute.value)),
    )
    .filter(Boolean)
    .filter((text) => text.startsWith('{') || text.startsWith('[') || PROMPT_PATTERN.test(text));

const collectCandidatePayload = () => {
  const textBlocks = collectTextBlocks();
  const scriptPayloads = collectScriptPayloads();
  const dataAttributes = collectDataAttributes();
  const bodyText = cleanText(document.body?.innerText || '');
  const explicitCandidates = unique([...textBlocks, ...scriptPayloads, ...dataAttributes]);
  const parsedPreview = explicitCandidates.map((text) => tryParseJson(text)).filter(Boolean);
  const promptLikeCount = explicitCandidates.filter((text) => PROMPT_PATTERN.test(text)).length;

  return {
    url: window.location.href,
    title: document.title,
    rawPayload: [
      `URL: ${window.location.href}`,
      `TITLE: ${document.title}`,
      ...explicitCandidates,
      bodyText,
    ]
      .filter(Boolean)
      .join('\n\n'),
    extractedAt: new Date().toISOString(),
    parsedPreviewCount: parsedPreview.length,
    promptLikeCount,
    scriptCount: scriptPayloads.length,
    textBlockCount: textBlocks.length + dataAttributes.length,
  };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_PRODUCER_JSON') {
    return false;
  }

  try {
    sendResponse({
      ok: true,
      payload: collectCandidatePayload(),
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to scan current producer.ai page.',
    });
  }

  return false;
});
