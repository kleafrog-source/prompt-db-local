import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  appendPromptUsageLog,
  loadMetaState,
  loadPromptSnapshot,
  type PromptSnapshotRecord,
  type PromptUsageLogEntry,
} from './metaStore';

type BatchConfig = {
  presetId?: string;
  pattern?: string;
  tagsInclude?: string[];
  tagsExclude?: string[];
};

type GenerateBatchPrompt = {
  id: string;
  text: string;
  presetId?: string;
  sequenceId?: string;
};

type BatchResult = {
  batchId: string;
  prompts: GenerateBatchPrompt[];
};

const DEFAULT_HTTP_PORT = 3210;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

const parsePattern = (pattern?: string) => {
  const match = String(pattern || '').trim().toLowerCase().match(/(\d+)\s*[xх*]\s*(\d+)(?:\s+([a-z_]+))?/i);

  return {
    files: Math.max(1, Number(match?.[1]) || 1),
    items: Math.max(1, Number(match?.[2]) || 12),
    mode: match?.[3] || 'random',
  };
};

const collectKeyNames = (value: unknown, result = new Set<string>()) => {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeyNames(entry, result));
    return result;
  }

  if (!isRecord(value)) {
    return result;
  }

  Object.entries(value).forEach(([key, entry]) => {
    result.add(key);
    collectKeyNames(entry, result);
  });

  return result;
};

const getValueByPath = (value: unknown, path: string): unknown => {
  const segments = path.split('.').filter(Boolean);
  let cursor: unknown = value;

  for (const segment of segments) {
    if (!isRecord(cursor)) {
      return undefined;
    }

    cursor = cursor[segment];
  }

  return cursor;
};

const collectLeafText = (value: unknown, result: string[] = []) => {
  if (typeof value === 'string') {
    const normalized = normalizeText(value);

    if (normalized) {
      result.push(normalized);
    }

    return result;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    result.push(String(value));
    return result;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectLeafText(entry, result));
    return result;
  }

  if (isRecord(value)) {
    Object.values(value).forEach((entry) => collectLeafText(entry, result));
  }

  return result;
};

const buildPromptTextFromValue = (value: unknown) => {
  const text = collectLeafText(value)
    .filter(Boolean)
    .join('\n')
    .trim();

  return text || JSON.stringify(value, null, 2);
};

const createTagBindingsMap = (bindings: Array<{ elementId: string; tags: string[] }>) =>
  new Map(bindings.map((binding) => [binding.elementId, binding.tags]));

const filterPrompts = (
  prompts: PromptSnapshotRecord[],
  bindingsMap: Map<string, string[]>,
  config: Required<Pick<BatchConfig, 'tagsInclude' | 'tagsExclude'>>,
  preset: {
    includeKeys: string[];
    excludeKeys: string[];
  },
) =>
  prompts.filter((prompt) => {
    const promptTags = new Set(bindingsMap.get(prompt.id) ?? []);
    const keyNames = collectKeyNames(prompt.json_data);

    if (config.tagsInclude.length > 0 && !config.tagsInclude.every((tag) => promptTags.has(tag))) {
      return false;
    }

    if (config.tagsExclude.some((tag) => promptTags.has(tag))) {
      return false;
    }

    if (preset.includeKeys.length > 0 && !preset.includeKeys.every((key) => keyNames.has(key))) {
      return false;
    }

    if (preset.excludeKeys.some((key) => keyNames.has(key))) {
      return false;
    }

    return true;
  });

const chooseIndexed = <T>(items: T[], index: number, mode: string) => {
  if (items.length === 0) {
    return null;
  }

  if (mode === 'sequential') {
    return items[index % items.length] ?? null;
  }

  return items[Math.floor(Math.random() * items.length)] ?? null;
};

const buildSequencePromptText = (
  prompt: PromptSnapshotRecord,
  sequencePaths: string[],
) => {
  const chunks = sequencePaths
    .map((path) => getValueByPath(prompt.json_data, path))
    .filter((value) => value !== undefined)
    .map((value) => buildPromptTextFromValue(value));

  return chunks.join('\n\n').trim();
};

const buildBatchPrompts = async (config: BatchConfig): Promise<BatchResult> => {
  const [metaState, promptSnapshot] = await Promise.all([loadMetaState(), loadPromptSnapshot()]);
  const exportPreset =
    metaState.exportPresets.find((preset) => preset.id === config.presetId) ??
    metaState.exportPresets[0];
  const parsedPattern = parsePattern(config.pattern || exportPreset?.composition?.pattern);
  const bindingsMap = createTagBindingsMap(metaState.elementTagBindings);
  const includeKeys = exportPreset?.filters?.includeKeys ?? [];
  const excludeKeys = exportPreset?.filters?.excludeKeys ?? [];
  const filtered = filterPrompts(
    promptSnapshot,
    bindingsMap,
    {
      tagsInclude: config.tagsInclude ?? exportPreset?.filters?.includeTags ?? [],
      tagsExclude: config.tagsExclude ?? exportPreset?.filters?.excludeTags ?? [],
    },
    {
      includeKeys,
      excludeKeys,
    },
  );
  const compositionMode = exportPreset?.composition?.mode ?? 'as-is';
  const sequencePresets =
    exportPreset?.slicing?.useKeySequences && exportPreset.slicing.useKeySequences.length > 0
      ? metaState.keySequencePresets.filter((preset) =>
          exportPreset.slicing?.useKeySequences?.includes(preset.id),
        )
      : metaState.keySequencePresets;

  const prompts: GenerateBatchPrompt[] = [];
  const total = parsedPattern.files * parsedPattern.items;
  const maxMixItems = Math.max(2, exportPreset?.slicing?.maxBlocksPerElement ?? 4);

  for (let index = 0; index < total; index += 1) {
    if (compositionMode === 'random-mix') {
      const picked = Array.from({ length: maxMixItems }, (_unused, mixIndex) =>
        chooseIndexed(filtered, index + mixIndex, parsedPattern.mode),
      ).filter((entry): entry is PromptSnapshotRecord => Boolean(entry));
      const text = picked.map((entry) => entry.text).join('\n\n').trim();

      prompts.push({
        id: `mix_${index + 1}_${crypto.randomUUID()}`,
        text,
        presetId: exportPreset?.id ?? config.presetId,
      });
      continue;
    }

    if (compositionMode === 'sequence-based' && sequencePresets.length > 0) {
      const selectedSequencePreset = chooseIndexed(sequencePresets, index, parsedPattern.mode);

      if (selectedSequencePreset) {
        const chunks = selectedSequencePreset.sequences
          .map((sequence) => {
            const parentPath = sequence.pathChain[0];
            const prompt = filtered.find((entry) => getValueByPath(entry.json_data, parentPath) !== undefined);

            if (!prompt) {
              return null;
            }

            return {
              prompt,
              sequenceId: sequence.id,
              text: buildSequencePromptText(prompt, sequence.pathChain),
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
          .slice(0, maxMixItems);

        prompts.push({
          id: `sequence_${index + 1}_${crypto.randomUUID()}`,
          text: chunks.map((chunk) => chunk.text).join('\n\n').trim(),
          presetId: exportPreset?.id ?? config.presetId,
          sequenceId: chunks[0]?.sequenceId,
        });
        continue;
      }
    }

    const prompt = chooseIndexed(filtered, index, parsedPattern.mode);

    prompts.push({
      id: prompt?.id ?? `prompt_${index + 1}_${crypto.randomUUID()}`,
      text: prompt?.text ?? '',
      presetId: exportPreset?.id ?? config.presetId,
    });
  }

  return {
    batchId: crypto.randomUUID(),
    prompts: prompts.filter((prompt) => prompt.text.trim().length > 0),
  };
};

const readJsonBody = async (request: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? (JSON.parse(raw) as unknown) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(JSON.stringify(payload));
};

export const startHttpApiServer = (port = DEFAULT_HTTP_PORT) => {
  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {});
      return;
    }

    try {
      if (request.method === 'GET' && request.url === '/api/health') {
        sendJson(response, 200, {
          ok: true,
          port,
        });
        return;
      }

      if (request.method === 'GET' && request.url === '/api/exportPresets') {
        const metaState = await loadMetaState();
        sendJson(response, 200, {
          presets: metaState.exportPresets,
        });
        return;
      }

      if (request.method === 'POST' && request.url === '/api/generateBatch') {
        const body = (await readJsonBody(request)) as BatchConfig;
        const batchResult = await buildBatchPrompts(body);
        sendJson(response, 200, batchResult);
        return;
      }

      if (request.method === 'POST' && request.url === '/api/promptUsage') {
        const body = (await readJsonBody(request)) as Partial<PromptUsageLogEntry>;
        const entry: PromptUsageLogEntry = {
          promptId: String(body.promptId || ''),
          usedAt:
            typeof body.usedAt === 'number'
              ? new Date(body.usedAt).toISOString()
              : String(body.usedAt || new Date().toISOString()),
          url: String(body.url || ''),
          tabId: Number(body.tabId || 0),
          windowId: Number(body.windowId || 0),
          chromeProfileId: body.chromeProfileId ? String(body.chromeProfileId) : undefined,
          source:
            body.source === 'prompt_sent_message' ? 'prompt_sent_message' : 'prompt_used',
        };

        await appendPromptUsageLog(entry);
        sendJson(response, 200, {
          ok: true,
          promptId: entry.promptId,
        });
        return;
      }

      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Unknown HTTP API error',
      });
    }
  });

  return new Promise<http.Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
};

export const HTTP_API_PORT = DEFAULT_HTTP_PORT;
