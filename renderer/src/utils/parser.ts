import type { PromptDraft } from '@/types/prompt';
import { extractKeywords, extractVariablesFromText } from '@/utils/keywords';

const PROMPT_KEYS = ['prompt', 'text', 'template', 'system'] as const;
const PROMPT_KEY_LOOKUP = new Set<string>(PROMPT_KEYS);
const PROMPT_FUZZY_PATTERN = /(prompt|template|system|instruction|content|message|completion)/i;
const NAME_KEYS = ['name', 'title', 'id', 'module_id', 'macro_name', 'package_id', 'system_id'];

type JsonFragment = {
  parsed: unknown;
  start: number;
  end: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const findBalancedJsonEnd = (text: string, start: number): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      depth += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }

      if (depth < 0) {
        return -1;
      }
    }
  }

  return -1;
};

const looksLikeJsonStart = (text: string, start: number): boolean => {
  const first = text[start];

  if (first !== '{' && first !== '[') {
    return false;
  }

  let index = start + 1;

  while (index < text.length && /\s/.test(text[index] ?? '')) {
    index += 1;
  }

  if (index >= text.length) {
    return false;
  }

  const next = text[index];

  if (first === '{') {
    return next === '"' || next === '}';
  }

  return (
    next === '{' ||
    next === '[' ||
    next === '"' ||
    next === ']' ||
    next === '-' ||
    /[0-9tfn]/.test(next)
  );
};

const extractJsonFragments = (text: string): JsonFragment[] => {
  const results: JsonFragment[] = [];
  const seenRanges = new Set<string>();

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char !== '{' && char !== '[') {
      continue;
    }

    if (!looksLikeJsonStart(text, index)) {
      continue;
    }

    const endIndex = findBalancedJsonEnd(text, index);

    if (endIndex < 0) {
      continue;
    }

    const rangeKey = `${index}:${endIndex}`;

    if (seenRanges.has(rangeKey)) {
      continue;
    }

    seenRanges.add(rangeKey);

    const candidate = text.slice(index, endIndex + 1);

    try {
      const parsed = JSON.parse(candidate) as unknown;

      if (isRecord(parsed) || Array.isArray(parsed)) {
        results.push({
          parsed,
          start: index,
          end: endIndex,
        });
        index = endIndex;
      }
    } catch {
      // Ignore malformed candidate and continue scanning the surrounding text.
    }
  }

  return results;
};

const collectPromptText = (node: Record<string, unknown>) => {
  const texts = Object.entries(node)
    .filter(([key, value]) => {
      if (typeof value !== 'string') {
        return false;
      }

      return PROMPT_KEY_LOOKUP.has(key) || PROMPT_FUZZY_PATTERN.test(key);
    })
    .map(([, value]) => value);

  return Array.from(new Set(texts));
};

const collectLeafText = (
  value: unknown,
  acc: string[] = [],
  path: string[] = [],
  depth = 0,
): string[] => {
  if (acc.length >= 18 || depth > 6) {
    return acc;
  }

  if (typeof value === 'string') {
    const normalized = normalizeWhitespace(value);

    if (normalized) {
      const keyLabel = path[path.length - 1];
      acc.push(keyLabel ? `${keyLabel}: ${normalized}` : normalized);
    }

    return acc;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    const keyLabel = path[path.length - 1] ?? 'value';
    acc.push(`${keyLabel}: ${String(value)}`);
    return acc;
  }

  if (Array.isArray(value)) {
    value.slice(0, 10).forEach((item, index) => {
      collectLeafText(item, acc, [...path, `${path[path.length - 1] ?? 'item'}_${index}`], depth + 1);
    });

    return acc;
  }

  if (isRecord(value)) {
    Object.entries(value)
      .slice(0, 24)
      .forEach(([key, entryValue]) => {
        collectLeafText(entryValue, acc, [...path, key], depth + 1);
      });
  }

  return acc;
};

const sanitizeVariables = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }

        if (isRecord(item) && typeof item.name === 'string') {
          return item.name.trim();
        }

        return '';
      })
      .filter(Boolean);
  }

  if (isRecord(value)) {
    return Object.keys(value);
  }

  return [];
};

const sanitizeKeywords = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter(Boolean);
};

const extractContextPreview = (rawText: string, start: number, end: number): string => {
  const before = rawText
    .slice(Math.max(0, start - 500), start)
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .slice(-3);

  const after = rawText
    .slice(end + 1, Math.min(rawText.length, end + 180))
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => !line.startsWith('{') && !line.startsWith('['))
    .slice(0, 1);

  return normalizeWhitespace([...before, ...after].join(' | ')).slice(0, 320);
};

const inferNameFromContext = (contextPreview: string): string | null => {
  if (!contextPreview) {
    return null;
  }

  const blockMatch = contextPreview.match(/(?:Блок|Block)\s+\d+\s*:\s*([^|]+)/i);

  if (blockMatch?.[1]) {
    return normalizeWhitespace(blockMatch[1]);
  }

  const flowMatch = contextPreview.match(/\[flow:\s*([^\]]+)\]/i);

  if (flowMatch?.[1]) {
    return `flow ${normalizeWhitespace(flowMatch[1])}`;
  }

  return contextPreview.split('|').map((part) => part.trim()).find(Boolean) ?? null;
};

const inferFragmentName = (
  parsed: unknown,
  index: number,
  contextPreview: string,
): string => {
  if (isRecord(parsed)) {
    for (const key of NAME_KEYS) {
      const value = parsed[key];

      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    const firstKey = Object.keys(parsed)[0];

    if (firstKey) {
      return firstKey.replace(/[_-]+/g, ' ').trim();
    }
  }

  const nameFromContext = inferNameFromContext(contextPreview);

  if (nameFromContext) {
    return nameFromContext;
  }

  if (Array.isArray(parsed)) {
    return `Imported array fragment ${index + 1}`;
  }

  return `Imported fragment ${index + 1}`;
};

const toPromptDraft = (
  node: Record<string, unknown>,
  path: string[],
  source?: string,
): PromptDraft | null => {
  const promptParts = collectPromptText(node);

  if (promptParts.length === 0) {
    return null;
  }

  const text = promptParts.join('\n\n').trim();
  const explicitVariables = sanitizeVariables(node.variables);
  const inlineVariables = extractVariablesFromText(text);
  const variables = Array.from(new Set([...explicitVariables, ...inlineVariables]));
  const keywords = Array.from(new Set([...sanitizeKeywords(node.keywords), ...extractKeywords(text)]));

  return {
    name:
      (typeof node.name === 'string' && node.name.trim()) ||
      (typeof node.title === 'string' && node.title.trim()) ||
      path.join('.') ||
      'Imported prompt',
    text,
    json_data: {
      ...node,
      __importPath: path,
    },
    variables,
    keywords,
    source,
  };
};

const createFragmentPromptDraft = (
  parsed: unknown,
  index: number,
  source: string | undefined,
  rawText: string,
  start: number,
  end: number,
): PromptDraft => {
  const contextPreview = extractContextPreview(rawText, start, end);
  const record = isRecord(parsed) ? parsed : null;
  const promptParts = record ? collectPromptText(record) : [];
  const leafText = collectLeafText(parsed).slice(0, 14);
  const textSections = [contextPreview, ...promptParts];

  if (leafText.length > 0) {
    textSections.push(leafText.join('\n'));
  }

  const text =
    textSections.filter(Boolean).join('\n\n').trim() ||
    JSON.stringify(parsed, null, 2).slice(0, 2400);
  const explicitVariables = record ? sanitizeVariables(record.variables) : [];
  const inlineVariables = extractVariablesFromText(text);
  const variables = Array.from(new Set([...explicitVariables, ...inlineVariables]));
  const explicitKeywords = record ? sanitizeKeywords(record.keywords) : [];
  const keywords = Array.from(new Set([...explicitKeywords, ...extractKeywords(text)]));

  return {
    name: inferFragmentName(parsed, index, contextPreview),
    text,
    json_data: Array.isArray(parsed)
      ? {
          items: parsed,
          __fragmentIndex: index,
        }
      : {
          ...(parsed as Record<string, unknown>),
          __fragmentIndex: index,
        },
    variables,
    keywords,
    source,
  };
};

const walk = (
  node: unknown,
  path: string[],
  source: string | undefined,
  acc: PromptDraft[],
): void => {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walk(entry, [...path, String(index)], source, acc));
    return;
  }

  if (!isRecord(node)) {
    return;
  }

  const prompt = toPromptDraft(node, path, source);

  if (prompt) {
    acc.push(prompt);
  }

  Object.entries(node).forEach(([key, value]) => {
    if (isRecord(value) || Array.isArray(value)) {
      walk(value, [...path, key], source, acc);
    }
  });
};

export const parseJsonToPrompts = (
  rawJson: string,
  options?: { source?: string },
): PromptDraft[] => {
  const prompts: PromptDraft[] = [];

  try {
    const parsed = JSON.parse(rawJson) as unknown;

    walk(parsed, ['root'], options?.source, prompts);

    if (prompts.length === 0 && (isRecord(parsed) || Array.isArray(parsed))) {
      prompts.push(createFragmentPromptDraft(parsed, 0, options?.source, rawJson, 0, rawJson.length - 1));
    }

    return prompts;
  } catch {
    const fragments = extractJsonFragments(rawJson);

    return fragments.map((fragment, index) =>
      createFragmentPromptDraft(
        fragment.parsed,
        index,
        options?.source,
        rawJson,
        fragment.start,
        fragment.end,
      ),
    );
  }
};
