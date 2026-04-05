import { describe, expect, it } from 'vitest';
import type { PromptRecord } from '@/types/prompt';
import {
  createDefaultBatchPresetConfig,
  createBatchExportPayload,
  parseBatchFormula,
  selectPromptIdsByMode,
} from '@/utils/exportPrompts';

const createPrompt = (overrides: Partial<PromptRecord>): PromptRecord => ({
  id: crypto.randomUUID(),
  name: 'Prompt',
  text: 'Body',
  json_data: { prompt: 'Body' },
  fingerprint: crypto.randomUUID(),
  variables: [],
  keywords: [],
  created_at: '2026-04-04T00:00:00.000Z',
  updated_at: '2026-04-04T00:00:00.000Z',
  ...overrides,
});

describe('exportPrompts', () => {
  it('parses batch formula with files and items', () => {
    expect(parseBatchFormula('6x44 random', 'ordered_name')).toEqual({
      files: 6,
      items: 44,
      mode: 'random',
    });
  });

  it('selects prompts by keyword density', () => {
    const prompts = [
      createPrompt({ id: 'a', keywords: ['one'] }),
      createPrompt({ id: 'b', keywords: ['one', 'two', 'three'] }),
      createPrompt({ id: 'c', keywords: ['one', 'two'] }),
    ];

    expect(selectPromptIdsByMode(prompts, 'keyword_density', 2)).toEqual(['b', 'c']);
  });

  it('creates a batch payload with item count', () => {
    const prompts = [
      createPrompt({ id: 'alpha', name: 'Alpha' }),
      createPrompt({ id: 'beta', name: 'Beta' }),
    ];

    const payload = createBatchExportPayload(prompts, ['alpha', 'beta'], 'ordered_name', 1);

    expect(payload.itemCount).toBe(2);
    expect((payload.items as Array<{ id: string }>).map((item) => item.id)).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('creates a variable catalog export using selected keys', () => {
    const prompts = [
      createPrompt({
        id: 'alpha',
        variables: ['subject'],
        json_data: {
          prompt: 'Body',
          variables: [{ name: 'subject', value: 'forest' }],
        },
      }),
    ];

    const payload = createBatchExportPayload(
      prompts,
      ['alpha'],
      'ordered_name',
      1,
      'variable_catalog',
      ['subject'],
    );

    expect(payload.items).toEqual([
      {
        variableKey: 'subject',
        promptCount: 1,
        prompts: [
          {
            id: 'alpha',
            name: 'Prompt',
            source: '',
            value: 'forest',
          },
        ],
      },
    ]);
  });

  it('builds a runtime bundle with selected output fields', () => {
    const prompts = [
      createPrompt({
        id: 'alpha',
        name: 'Alpha',
        json_data: {
          prompt: 'Body',
          meta: {
            category: 'cinematic',
          },
          variables: [{ name: 'subject', value: 'forest' }],
        },
      }),
    ];

    const payload = createBatchExportPayload(
      prompts,
      ['alpha'],
      'ordered_name',
      1,
      'runtime_bundle',
      ['subject'],
      ['name', 'meta.category'],
    );

    expect(payload.items).toEqual([
      {
        id: 'alpha',
        runtime: {
          name: 'Alpha',
          'meta.category': 'cinematic',
        },
        variableDefaults: {
          subject: 'forest',
        },
      },
    ]);
  });

  it('creates the default batch preset config', () => {
    expect(createDefaultBatchPresetConfig()).toMatchObject({
      presetName: 'Default batch preset',
      files: 3,
      items: 12,
      mode: 'random',
      exportFormat: 'full_bundle',
    });
  });
});
