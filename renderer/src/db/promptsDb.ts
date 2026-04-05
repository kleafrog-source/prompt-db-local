import Dexie, { type Table } from 'dexie';
import type { BatchPresetDraft, BatchPresetRecord } from '@/types/batchPreset';
import type { PromptDraft, PromptRecord } from '@/types/prompt';
import { extractKeywords } from '@/utils/keywords';

export const PROMPTS_DB_NAME = 'prompt-db-local-v2';

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith('__'))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
};

export const createPromptFingerprint = (value: {
  text: string;
  json_data: Record<string, unknown>;
}): string => stableSerialize(value.json_data);

class PromptsDb extends Dexie {
  prompts!: Table<PromptRecord, string>;
  batchPresets!: Table<BatchPresetRecord, string>;

  constructor() {
    super(PROMPTS_DB_NAME);

    this.version(1).stores({
      prompts: 'id, name, created_at, updated_at, *keywords, *variables',
    });

    this.version(2)
      .stores({
        prompts: 'id, &fingerprint, name, created_at, updated_at, *keywords, *variables',
      })
      .upgrade((transaction) =>
        transaction
          .table('prompts')
          .toCollection()
          .modify((prompt) => {
            const record = prompt as PromptRecord;
            record.fingerprint = createPromptFingerprint(record);
          }),
      );

    this.version(3)
      .stores({
        prompts: 'id, fingerprint, name, created_at, updated_at, *keywords, *variables',
      })
      .upgrade((transaction) =>
        transaction
          .table('prompts')
          .toCollection()
          .modify((prompt) => {
            const record = prompt as PromptRecord;
            record.fingerprint = createPromptFingerprint(record);
          }),
      );

    this.version(4).stores({
      prompts: 'id, fingerprint, name, created_at, updated_at, *keywords, *variables',
      batchPresets:
        'id, presetName, updated_at, exportFormat, mode, *variableKeys, *outputFields',
    });
  }
}

export const promptsDb = new PromptsDb();

export const clearPromptsDb = async () => {
  await promptsDb.prompts.clear();
  await promptsDb.batchPresets.clear();
};

export const normalizePromptDraft = (draft: PromptDraft): PromptRecord => {
  const now = new Date().toISOString();
  const mergedKeywords = Array.from(
    new Set([...(draft.keywords ?? []), ...extractKeywords(draft.text)]),
  ).slice(0, 20);

  return {
    id: draft.id ?? crypto.randomUUID(),
    name: draft.name.trim() || 'Untitled prompt',
    text: draft.text.trim(),
    json_data: draft.json_data,
    fingerprint:
      draft.fingerprint ??
      createPromptFingerprint({
        text: draft.text,
        json_data: draft.json_data,
      }),
    variables: Array.from(new Set(draft.variables ?? [])),
    keywords: mergedKeywords,
    created_at: draft.created_at ?? now,
    updated_at: now,
    source: draft.source,
  };
};

export const normalizeBatchPresetDraft = (draft: BatchPresetDraft): BatchPresetRecord => {
  const now = new Date().toISOString();

  return {
    id: draft.id ?? crypto.randomUUID(),
    presetName: draft.presetName.trim() || 'Batch preset',
    files: Math.max(1, Number(draft.files) || 1),
    items: Math.max(1, Number(draft.items) || 12),
    mode: draft.mode,
    query: draft.query.trim(),
    exportFormat: draft.exportFormat,
    variableKeys: Array.from(new Set((draft.variableKeys ?? []).map((entry) => entry.trim()).filter(Boolean))),
    outputFields: Array.from(new Set((draft.outputFields ?? []).map((entry) => entry.trim()).filter(Boolean))),
    blocklyXml: draft.blocklyXml ?? '',
    created_at: draft.created_at ?? now,
    updated_at: now,
  };
};
