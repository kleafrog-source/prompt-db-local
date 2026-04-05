import type { BatchPresetConfig } from '@/types/batchPreset';
import type { PromptRecord } from '@/types/prompt';

export type ExportMode =
  | 'random'
  | 'ordered_name'
  | 'updated_recent'
  | 'keyword_density'
  | 'variable_density'
  | 'keyword_chain';

export type ExportFormatKey =
  | 'full_bundle'
  | 'prompt_cards'
  | 'variable_catalog'
  | 'keyword_matrix'
  | 'runtime_bundle';

export type BatchFormula = {
  files: number;
  items: number;
  mode: ExportMode;
};

export const EXPORT_MODES: ExportMode[] = [
  'random',
  'ordered_name',
  'updated_recent',
  'keyword_density',
  'variable_density',
  'keyword_chain',
];

export const EXPORT_FORMATS: Array<{
  key: ExportFormatKey;
  label: string;
  description: string;
}> = [
  {
    key: 'full_bundle',
    label: 'Full bundle',
    description: 'Full prompt records with JSON, keywords, variables, and export metadata.',
  },
  {
    key: 'prompt_cards',
    label: 'Prompt cards',
    description: 'Compact cards for prompt review, QA, and content handoff.',
  },
  {
    key: 'variable_catalog',
    label: 'Variable catalog',
    description: 'Variable-first export that groups prompts by reusable keys.',
  },
  {
    key: 'keyword_matrix',
    label: 'Keyword matrix',
    description: 'Keyword clusters with prompt links and matching variable usage.',
  },
  {
    key: 'runtime_bundle',
    label: 'Runtime bundle',
    description: 'Application-ready bundle with prompt text, selected fields, and variable defaults.',
  },
];

const CORE_FIELD_RESOLVERS: Record<string, (prompt: PromptRecord) => unknown> = {
  id: (prompt) => prompt.id,
  name: (prompt) => prompt.name,
  text: (prompt) => prompt.text,
  source: (prompt) => prompt.source ?? '',
  created_at: (prompt) => prompt.created_at,
  updated_at: (prompt) => prompt.updated_at,
  fingerprint: (prompt) => prompt.fingerprint,
  keywords: (prompt) => prompt.keywords,
  variables: (prompt) => prompt.variables,
};

const shuffle = <T>(values: T[]) => {
  const next = [...values];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
};

const getPathValue = (value: unknown, path: string): unknown => {
  const normalizedPath = path.trim();

  if (!normalizedPath) {
    return undefined;
  }

  if (CORE_FIELD_RESOLVERS[normalizedPath]) {
    return CORE_FIELD_RESOLVERS[normalizedPath](value as PromptRecord);
  }

  const segments = normalizedPath.split('.').filter(Boolean);
  let cursor: unknown = (value as PromptRecord).json_data;

  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
};

const getVariableEntries = (prompt: PromptRecord) => {
  const rawVariables = prompt.json_data.variables;

  if (Array.isArray(rawVariables)) {
    return rawVariables
      .map((entry) => {
        if (typeof entry === 'string') {
          return {
            name: entry,
            value: '',
          };
        }

        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          return {
            name: typeof record.name === 'string' ? record.name : '',
            value: typeof record.value === 'string' ? record.value : '',
          };
        }

        return {
          name: '',
          value: '',
        };
      })
      .filter((entry) => entry.name);
  }

  if (rawVariables && typeof rawVariables === 'object') {
    return Object.entries(rawVariables as Record<string, unknown>).map(([name, entry]) => ({
      name,
      value: typeof entry === 'string' ? entry : JSON.stringify(entry),
    }));
  }

  return prompt.variables.map((name) => ({
    name,
    value: '',
  }));
};

const getPromptSelection = (prompts: PromptRecord[], ids: string[]) =>
  ids
    .map((id) => prompts.find((prompt) => prompt.id === id))
    .filter((prompt): prompt is PromptRecord => Boolean(prompt));

export const parseBatchFormula = (input: string, fallbackMode: ExportMode): BatchFormula => {
  const raw = String(input || '').trim().toLowerCase();
  const match = raw.match(/(\d+)\s*[xС…*]\s*(\d+)(?:\s+['"]?([a-z_]+)['"]?)?/i);

  if (!match) {
    return {
      files: 1,
      items: 12,
      mode: EXPORT_MODES.includes(fallbackMode) ? fallbackMode : 'random',
    };
  }

  const mode = match[3] as ExportMode | undefined;

  return {
    files: Math.max(1, Number(match[1]) || 1),
    items: Math.max(1, Number(match[2]) || 1),
    mode: mode && EXPORT_MODES.includes(mode) ? mode : fallbackMode,
  };
};

export const formatBatchFormula = (files: number, items: number, mode: ExportMode) =>
  `${Math.max(1, files)}x${Math.max(1, items)} ${mode}`;

export const createDefaultBatchPresetConfig = (): BatchPresetConfig => ({
  presetName: 'Default batch preset',
  files: 3,
  items: 12,
  mode: 'random',
  query: '',
  exportFormat: 'full_bundle',
  variableKeys: [],
  outputFields: ['name', 'text', 'keywords', 'variables', 'updated_at'],
});

export const selectPromptIdsByMode = (
  prompts: PromptRecord[],
  mode: ExportMode,
  requestedCount: number,
) => {
  if (prompts.length === 0) {
    return [];
  }

  const count = Math.max(1, Math.min(prompts.length, Number(requestedCount) || 1));

  if (mode === 'random') {
    return shuffle(prompts).slice(0, count).map((prompt) => prompt.id);
  }

  if (mode === 'ordered_name') {
    return [...prompts]
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, count)
      .map((prompt) => prompt.id);
  }

  if (mode === 'updated_recent') {
    return [...prompts]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, count)
      .map((prompt) => prompt.id);
  }

  if (mode === 'keyword_density') {
    return [...prompts]
      .sort((left, right) => right.keywords.length - left.keywords.length)
      .slice(0, count)
      .map((prompt) => prompt.id);
  }

  if (mode === 'variable_density') {
    return [...prompts]
      .sort((left, right) => right.variables.length - left.variables.length)
      .slice(0, count)
      .map((prompt) => prompt.id);
  }

  if (mode === 'keyword_chain') {
    const sorted = [...prompts].sort((left, right) => right.keywords.length - left.keywords.length);
    const result: string[] = [];
    const used = new Set<string>();
    let current: PromptRecord | null = sorted[0] ?? null;

    while (result.length < count && current) {
      result.push(current.id);
      used.add(current.id);

      const currentKeywords: Set<string> = new Set(current.keywords);
      const next: PromptRecord | undefined = sorted.find((candidate) => {
        if (used.has(candidate.id)) {
          return false;
        }

        return candidate.keywords.some((keyword) => currentKeywords.has(keyword));
      });

      current = next ?? sorted.find((candidate) => !used.has(candidate.id)) ?? null;
    }

    return result.slice(0, count);
  }

  return prompts.slice(0, count).map((prompt) => prompt.id);
};

export const createBatchExportPayload = (
  prompts: PromptRecord[],
  ids: string[],
  mode: ExportMode,
  fileIndex: number,
  exportFormat: ExportFormatKey = 'full_bundle',
  variableKeys: string[] = [],
  outputFields: string[] = [],
) => {
  const selectedPrompts = getPromptSelection(prompts, ids);
  const selectedVariableKeys = variableKeys.map((entry) => entry.trim()).filter(Boolean);
  const selectedOutputFields = outputFields.map((entry) => entry.trim()).filter(Boolean);

  const baseMeta = {
    type: 'prompt-db-export-batch',
    exportedAt: new Date().toISOString(),
    mode,
    exportFormat,
    fileIndex,
    itemCount: selectedPrompts.length,
    variableKeys: selectedVariableKeys,
    outputFields: selectedOutputFields,
  };

  if (exportFormat === 'prompt_cards') {
    return {
      ...baseMeta,
      items: selectedPrompts.map((prompt) => ({
        id: prompt.id,
        name: prompt.name,
        text: prompt.text,
        source: prompt.source ?? '',
        keywords: prompt.keywords,
        variables: prompt.variables,
        excerpt: prompt.text.slice(0, 220),
        updated_at: prompt.updated_at,
      })),
    };
  }

  if (exportFormat === 'variable_catalog') {
    const rows = selectedVariableKeys.length > 0 ? selectedVariableKeys : Array.from(
      new Set(selectedPrompts.flatMap((prompt) => getVariableEntries(prompt).map((entry) => entry.name))),
    ).sort((left, right) => left.localeCompare(right));

    return {
      ...baseMeta,
      items: rows.map((variableKey) => ({
        variableKey,
        promptCount: selectedPrompts.filter((prompt) =>
          getVariableEntries(prompt).some((entry) => entry.name === variableKey),
        ).length,
        prompts: selectedPrompts
          .filter((prompt) => getVariableEntries(prompt).some((entry) => entry.name === variableKey))
          .map((prompt) => ({
            id: prompt.id,
            name: prompt.name,
            source: prompt.source ?? '',
            value:
              getVariableEntries(prompt).find((entry) => entry.name === variableKey)?.value ?? '',
          })),
      })),
    };
  }

  if (exportFormat === 'keyword_matrix') {
    const keywords = Array.from(
      new Set(selectedPrompts.flatMap((prompt) => prompt.keywords.map((keyword) => keyword.trim()).filter(Boolean))),
    ).sort((left, right) => left.localeCompare(right));

    return {
      ...baseMeta,
      items: keywords.map((keyword) => ({
        keyword,
        promptCount: selectedPrompts.filter((prompt) => prompt.keywords.includes(keyword)).length,
        promptIds: selectedPrompts
          .filter((prompt) => prompt.keywords.includes(keyword))
          .map((prompt) => prompt.id),
        variableKeys: Array.from(
          new Set(
            selectedPrompts
              .filter((prompt) => prompt.keywords.includes(keyword))
              .flatMap((prompt) => prompt.variables),
          ),
        ).sort((left, right) => left.localeCompare(right)),
      })),
    };
  }

  if (exportFormat === 'runtime_bundle') {
    const fields = selectedOutputFields.length > 0 ? selectedOutputFields : ['name', 'text', 'updated_at'];

    return {
      ...baseMeta,
      items: selectedPrompts.map((prompt) => ({
        id: prompt.id,
        runtime: Object.fromEntries(
          fields.map((field) => [field, getPathValue(prompt, field)]),
        ),
        variableDefaults: Object.fromEntries(
          getVariableEntries(prompt)
            .filter((entry) =>
              selectedVariableKeys.length === 0 ? true : selectedVariableKeys.includes(entry.name),
            )
            .map((entry) => [entry.name, entry.value]),
        ),
      })),
    };
  }

  return {
    ...baseMeta,
    items: selectedPrompts.map((prompt) => ({
      id: prompt.id,
      name: prompt.name,
      text: prompt.text,
      keywords: prompt.keywords,
      variables: prompt.variables,
      source: prompt.source ?? '',
      json_data: prompt.json_data,
      selectedFields: Object.fromEntries(
        selectedOutputFields.map((field) => [field, getPathValue(prompt, field)]),
      ),
      selectedVariables: Object.fromEntries(
        getVariableEntries(prompt)
          .filter((entry) =>
            selectedVariableKeys.length === 0 ? true : selectedVariableKeys.includes(entry.name),
          )
          .map((entry) => [entry.name, entry.value]),
      ),
      updated_at: prompt.updated_at,
    })),
  };
};
