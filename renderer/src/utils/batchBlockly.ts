import * as Blockly from 'blockly/core';
import { blocks as defaultBlocklyBlocks } from 'blockly/blocks';
import type { BatchPresetConfig } from '@/types/batchPreset';
import type { PromptRecord } from '@/types/prompt';
import { EXPORT_FORMATS, EXPORT_MODES, createDefaultBatchPresetConfig } from '@/utils/exportPrompts';

const BLOCK_TYPES = {
  config: 'batch_config',
  variableKey: 'batch_variable_key',
  outputField: 'batch_output_field',
} as const;

let blocksRegistered = false;

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const collectJsonPaths = (value: unknown, prefix = '', result = new Set<string>(), depth = 0) => {
  if (!value || typeof value !== 'object' || depth > 4) {
    return result;
  }

  if (Array.isArray(value)) {
    return result;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('__')) {
      continue;
    }

    const path = prefix ? `${prefix}.${key}` : key;
    result.add(path);
    collectJsonPaths(entry, path, result, depth + 1);
  }

  return result;
};

export const getBatchVariableKeyOptions = (prompts: PromptRecord[]) =>
  Array.from(
    new Set(
      prompts.flatMap((prompt) => {
        const names = [...prompt.variables];
        const rawVariables = prompt.json_data.variables;

        if (Array.isArray(rawVariables)) {
          for (const entry of rawVariables) {
            if (typeof entry === 'string' && entry.trim()) {
              names.push(entry.trim());
            } else if (
              entry &&
              typeof entry === 'object' &&
              typeof (entry as { name?: unknown }).name === 'string'
            ) {
              names.push(((entry as { name: string }).name || '').trim());
            }
          }
        } else if (rawVariables && typeof rawVariables === 'object') {
          names.push(...Object.keys(rawVariables as Record<string, unknown>));
        }

        return names.filter(Boolean);
      }),
    ),
  ).sort((left, right) => left.localeCompare(right));

export const getBatchOutputFieldOptions = (prompts: PromptRecord[]) =>
  Array.from(
    new Set([
      'id',
      'name',
      'text',
      'source',
      'created_at',
      'updated_at',
      'keywords',
      'variables',
      ...prompts.flatMap((prompt) => [...collectJsonPaths(prompt.json_data)]),
    ]),
  ).sort((left, right) => left.localeCompare(right));

export const registerBatchBlocklyBlocks = () => {
  if (blocksRegistered) {
    return;
  }

  Blockly.common.defineBlocks(defaultBlocklyBlocks);

  Blockly.common.defineBlocksWithJsonArray([
    {
      type: BLOCK_TYPES.config,
      message0: 'Batch preset %1 files %2 items %3 mode %4 filter %5 format %6',
      args0: [
        { type: 'field_input', name: 'PRESET_NAME', text: 'Default batch preset' },
        { type: 'field_number', name: 'FILES', value: 3, min: 1, precision: 1 },
        { type: 'field_number', name: 'ITEMS', value: 12, min: 1, precision: 1 },
        {
          type: 'field_dropdown',
          name: 'MODE',
          options: EXPORT_MODES.map((mode) => [mode, mode]),
        },
        { type: 'field_input', name: 'QUERY', text: '' },
        {
          type: 'field_dropdown',
          name: 'EXPORT_FORMAT',
          options: EXPORT_FORMATS.map((entry) => [entry.label, entry.key]),
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 168,
    },
    {
      type: BLOCK_TYPES.variableKey,
      message0: 'Variable key %1',
      args0: [{ type: 'field_input', name: 'KEY', text: 'subject' }],
      previousStatement: null,
      nextStatement: null,
      colour: 228,
    },
    {
      type: BLOCK_TYPES.outputField,
      message0: 'Output field %1',
      args0: [{ type: 'field_input', name: 'FIELD', text: 'text' }],
      previousStatement: null,
      nextStatement: null,
      colour: 36,
    },
  ]);

  blocksRegistered = true;
};

export const createBatchBlocklyToolbox = (
  prompts: PromptRecord[],
): Blockly.utils.toolbox.ToolboxDefinition => {
  const variableKeys = getBatchVariableKeyOptions(prompts);
  const outputFields = getBatchOutputFieldOptions(prompts);

  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Batch Config',
        colour: '#3d7a57',
        contents: [{ kind: 'block', type: BLOCK_TYPES.config }],
      },
      {
        kind: 'category',
        name: 'Variable Keys',
        colour: '#4b71b0',
        contents:
          variableKeys.length > 0
            ? variableKeys.slice(0, 120).map((key) => ({
                kind: 'block',
                type: BLOCK_TYPES.variableKey,
                fields: {
                  KEY: key,
                },
              }))
            : [{ kind: 'label', text: 'Import prompts to collect variable keys' }],
      },
      {
        kind: 'category',
        name: 'Output Fields',
        colour: '#8d6a3b',
        contents:
          outputFields.length > 0
            ? outputFields.slice(0, 150).map((field) => ({
                kind: 'block',
                type: BLOCK_TYPES.outputField,
                fields: {
                  FIELD: field,
                },
              }))
            : [{ kind: 'label', text: 'No field paths detected yet' }],
      },
    ],
  };
};

export const batchPresetToWorkspaceXml = (config: BatchPresetConfig) => {
  const blocks: string[] = [
    `
      <block type="${BLOCK_TYPES.config}" x="24" y="24">
        <field name="PRESET_NAME">${escapeXml(config.presetName)}</field>
        <field name="FILES">${config.files}</field>
        <field name="ITEMS">${config.items}</field>
        <field name="MODE">${escapeXml(config.mode)}</field>
        <field name="QUERY">${escapeXml(config.query)}</field>
        <field name="EXPORT_FORMAT">${escapeXml(config.exportFormat)}</field>
      </block>
    `,
  ];

  config.variableKeys.forEach((key, index) => {
    blocks.push(`
      <block type="${BLOCK_TYPES.variableKey}" x="24" y="${120 + index * 72}">
        <field name="KEY">${escapeXml(key)}</field>
      </block>
    `);
  });

  config.outputFields.forEach((field, index) => {
    blocks.push(`
      <block type="${BLOCK_TYPES.outputField}" x="360" y="${120 + index * 72}">
        <field name="FIELD">${escapeXml(field)}</field>
      </block>
    `);
  });

  return `<xml xmlns="https://developers.google.com/blockly/xml">${blocks.join('')}</xml>`;
};

const getFieldValue = (block: Blockly.Block, fieldName: string) => block.getFieldValue(fieldName) ?? '';

export const workspaceToBatchPresetConfig = (
  workspace: Blockly.Workspace,
  baseConfig: BatchPresetConfig = createDefaultBatchPresetConfig(),
): BatchPresetConfig => {
  const nextConfig: BatchPresetConfig = {
    ...baseConfig,
    variableKeys: [],
    outputFields: [],
  };

  for (const block of workspace.getTopBlocks(true)) {
    if (block.type === BLOCK_TYPES.config) {
      nextConfig.presetName = getFieldValue(block, 'PRESET_NAME').trim() || baseConfig.presetName;
      nextConfig.files = Math.max(1, Number(getFieldValue(block, 'FILES')) || baseConfig.files);
      nextConfig.items = Math.max(1, Number(getFieldValue(block, 'ITEMS')) || baseConfig.items);
      nextConfig.mode = (getFieldValue(block, 'MODE') || baseConfig.mode) as BatchPresetConfig['mode'];
      nextConfig.query = getFieldValue(block, 'QUERY').trim();
      nextConfig.exportFormat = (
        getFieldValue(block, 'EXPORT_FORMAT') || baseConfig.exportFormat
      ) as BatchPresetConfig['exportFormat'];
      continue;
    }

    if (block.type === BLOCK_TYPES.variableKey) {
      const key = getFieldValue(block, 'KEY').trim();

      if (key) {
        nextConfig.variableKeys.push(key);
      }

      continue;
    }

    if (block.type === BLOCK_TYPES.outputField) {
      const field = getFieldValue(block, 'FIELD').trim();

      if (field) {
        nextConfig.outputFields.push(field);
      }
    }
  }

  nextConfig.variableKeys = Array.from(new Set(nextConfig.variableKeys));
  nextConfig.outputFields = Array.from(new Set(nextConfig.outputFields));

  return nextConfig;
};
