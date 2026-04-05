import type {
  DBElement,
  ExportPreset,
  KeySequence,
  KeySequencePreset,
  TagRegistry,
} from '@/types/meta';
import { createTagId } from '@/utils/tagScanner';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const shuffle = <T>(values: T[]) => {
  const next = [...values];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
};

export const parseCompositionPattern = (pattern?: string) => {
  const match = String(pattern || '').trim().toLowerCase().match(/(\d+)\s*[xх*]\s*(\d+)(?:\s+([a-z_]+))?/i);

  return {
    files: Math.max(1, Number(match?.[1]) || 1),
    items: Math.max(1, Number(match?.[2]) || 12),
    mode: match?.[3] || 'random',
  };
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

const setValueByPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const segments = path.split('.').filter(Boolean);

  if (segments.length === 0) {
    return;
  }

  let cursor = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    const existing = cursor[key];

    if (!isRecord(existing)) {
      cursor[key] = {};
    }

    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]] = deepClone(value);
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

const matchesKeys = (element: DBElement, includeKeys: string[] = [], excludeKeys: string[] = []) => {
  const keys = collectKeyNames(element.raw);

  if (includeKeys.length > 0 && !includeKeys.every((key) => keys.has(key))) {
    return false;
  }

  if (excludeKeys.some((key) => keys.has(key))) {
    return false;
  }

  return true;
};

const matchesTags = (element: DBElement, includeTags: string[] = [], excludeTags: string[] = []) => {
  const tagIds = new Set(element.tagIds ?? []);

  if (includeTags.length > 0 && !includeTags.every((tag) => tagIds.has(tag))) {
    return false;
  }

  if (excludeTags.some((tag) => tagIds.has(tag))) {
    return false;
  }

  return true;
};

const filterElements = (elements: DBElement[], preset: ExportPreset) =>
  elements.filter((element) => {
    const filters = preset.filters;

    return (
      matchesTags(element, filters?.includeTags, filters?.excludeTags) &&
      matchesKeys(element, filters?.includeKeys, filters?.excludeKeys)
    );
  });

const fillPattern = (pattern: string, values: Record<string, string | number>) =>
  pattern.replace(/\{([^}]+)\}/g, (_match, key) => String(values[key] ?? key));

const getTopLevelFragments = (element: DBElement) => {
  if (!isRecord(element.raw)) {
    return [];
  }

  return Object.entries(element.raw).map(([key, value]) => ({
    path: key,
    value,
    sourceId: element.id,
  }));
};

const chooseItem = <T>(
  items: T[],
  index: number,
  mode: 'random' | 'weighted' | 'sequential' = 'random',
) => {
  if (items.length === 0) {
    return null;
  }

  if (mode === 'sequential') {
    return items[index % items.length] ?? null;
  }

  if (mode === 'weighted') {
    return items[Math.min(items.length - 1, Math.floor(Math.random() * Math.random() * items.length))] ?? null;
  }

  return items[Math.floor(Math.random() * items.length)] ?? null;
};

const findFragmentsForSequence = (elements: DBElement[], sequence: KeySequence) => {
  const parentPath = sequence.pathChain[0];

  return elements
    .map((element) => ({
      elementId: element.id,
      parentPath,
      value: getValueByPath(element.raw, parentPath),
    }))
    .filter((entry) => entry.value !== undefined);
};

const buildSequenceBasedItem = (
  elements: DBElement[],
  selectedPresets: KeySequencePreset[],
  itemIndex: number,
  maxBlocksPerElement?: number,
) => {
  const output: Record<string, unknown> = {};
  const sourceElementIds: string[] = [];
  let blockCount = 0;

  for (const preset of selectedPresets) {
    const mode = preset.generationRules?.mode ?? 'random';
    const limit = preset.generationRules?.maxBlocks ?? preset.sequences.length;

    for (let sequenceIndex = 0; sequenceIndex < preset.sequences.length; sequenceIndex += 1) {
      if (blockCount >= (maxBlocksPerElement || Infinity) || blockCount >= limit) {
        break;
      }

      const sequence = preset.sequences[sequenceIndex];
      const matches = findFragmentsForSequence(elements, sequence);
      const selected = chooseItem(matches, itemIndex + sequenceIndex, mode);

      if (!selected) {
        continue;
      }

      setValueByPath(output, selected.parentPath, selected.value);
      sourceElementIds.push(selected.elementId);
      blockCount += 1;
    }
  }

  return {
    id: createTagId(`generated_sequence_${itemIndex}_${sourceElementIds.join('_')}`),
    sourceElementIds: Array.from(new Set(sourceElementIds)),
    content: output,
  };
};

const buildRandomMixItem = (
  elements: DBElement[],
  itemIndex: number,
  maxBlocksPerElement = 4,
) => {
  const fragments = shuffle(elements.flatMap(getTopLevelFragments)).slice(0, maxBlocksPerElement);
  const output: Record<string, unknown> = {};

  fragments.forEach((fragment) => {
    setValueByPath(output, fragment.path, fragment.value);
  });

  return {
    id: createTagId(`generated_mix_${itemIndex}_${fragments.map((fragment) => fragment.sourceId).join('_')}`),
    sourceElementIds: Array.from(new Set(fragments.map((fragment) => fragment.sourceId))),
    content: output,
  };
};

export async function generateExport(
  elements: DBElement[],
  exportPreset: ExportPreset,
  tagRegistry: TagRegistry,
  sequences: KeySequencePreset[],
): Promise<{ fileName: string; content: any }[]> {
  void tagRegistry;

  const filtered = filterElements(elements, exportPreset);
  const parsedPattern = parseCompositionPattern(exportPreset.composition?.pattern);
  const selectedSequencePresets =
    exportPreset.slicing?.useKeySequences && exportPreset.slicing.useKeySequences.length > 0
      ? sequences.filter((preset) => exportPreset.slicing?.useKeySequences?.includes(preset.id))
      : sequences;
  const fileNamePattern = exportPreset.output?.fileNamePattern || '{index}_{id}.json';
  const compositionMode = exportPreset.composition?.mode || 'as-is';

  return Array.from({ length: parsedPattern.files }, (_unused, fileIndex) => {
    const items = Array.from({ length: parsedPattern.items }, (_value, itemIndex) => {
      if (compositionMode === 'random-mix') {
        return buildRandomMixItem(
          filtered,
          fileIndex * parsedPattern.items + itemIndex,
          exportPreset.slicing?.maxBlocksPerElement,
        );
      }

      if (compositionMode === 'sequence-based') {
        return buildSequenceBasedItem(
          filtered,
          selectedSequencePresets,
          fileIndex * parsedPattern.items + itemIndex,
          exportPreset.slicing?.maxBlocksPerElement,
        );
      }

      const source = filtered[(fileIndex * parsedPattern.items + itemIndex) % Math.max(filtered.length, 1)];

      return source
        ? {
            id: source.id,
            sourceElementIds: [source.id],
            content: deepClone(source.raw),
          }
        : {
            id: createTagId(`empty_${fileIndex}_${itemIndex}`),
            sourceElementIds: [],
            content: {},
          };
    });

    const fileId = items[0]?.id || `file_${fileIndex + 1}`;

    return {
      fileName: fillPattern(fileNamePattern, {
        index: fileIndex + 1,
        id: fileId,
      }),
      content: {
        type: 'prompt-db-generated-export',
        exportPresetId: exportPreset.id,
        label: exportPreset.label,
        compositionMode,
        itemCount: items.length,
        items,
      },
    };
  });
}
