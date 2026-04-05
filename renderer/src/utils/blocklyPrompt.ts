import * as Blockly from 'blockly/core';
import { blocks as defaultBlocklyBlocks } from 'blockly/blocks';
import type { PromptRecord } from '@/types/prompt';

const BLOCK_TYPES = {
  promptTemplate: 'prompt_template',
  variable: 'prompt_variable',
  condition: 'prompt_condition',
  randomChoice: 'prompt_random_choice',
  field: 'prompt_field',
  reference: 'prompt_reference',
} as const;

let blocksRegistered = false;
let promptOptionsProvider: Array<[string, string]> = [['No prompts', '__none__']];

const RESERVED_KEYS = new Set([
  'name',
  'title',
  'id',
  'module_id',
  'macro_name',
  'package_id',
  'system_id',
  'prompt',
  'template',
  'text',
  'system',
  'content',
  'instruction',
  'message',
  'keywords',
  'variables',
  'conditions',
  'random_choices',
  'choices',
]);

const normalizeText = (value: unknown) => (typeof value === 'string' ? value : '');

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
};

const parseFieldValue = (value: string): unknown => {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
};

const setPathValue = (target: Record<string, unknown>, path: string, value: unknown) => {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);

  if (segments.length === 0) {
    return;
  }

  let cursor: Record<string, unknown> = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextValue = cursor[segment];

    if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
      cursor[segment] = {};
    }

    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]] = value;
};

const getPromptText = (json: Record<string, unknown>) => {
  const candidates = [
    normalizeText(json.prompt),
    normalizeText(json.template),
    normalizeText(json.text),
    normalizeText(json.system),
    normalizeText(json.content),
    normalizeText(json.instruction),
    normalizeText(json.message),
  ].filter(Boolean);

  return candidates.join('\n\n');
};

const getPromptMode = (json: Record<string, unknown>) => {
  if (typeof json.prompt === 'string') return 'prompt';
  if (typeof json.template === 'string') return 'template';
  if (typeof json.system === 'string') return 'system';
  if (typeof json.content === 'string') return 'content';
  if (typeof json.message === 'string') return 'message';
  return 'text';
};

const getPromptName = (json: Record<string, unknown>) =>
  normalizeText(json.name) ||
  normalizeText(json.title) ||
  normalizeText(json.id) ||
  normalizeText(json.module_id) ||
  normalizeText(json.macro_name) ||
  'Imported prompt';

const getKeywords = (json: Record<string, unknown>) =>
  Array.isArray(json.keywords)
    ? json.keywords.filter((item): item is string => typeof item === 'string').join(', ')
    : '';

const getVariables = (json: Record<string, unknown>) => {
  const raw = json.variables;

  if (Array.isArray(raw)) {
    return raw
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
            name: normalizeText(record.name),
            value: normalizeText(record.value),
          };
        }

        return {
          name: '',
          value: '',
        };
      })
      .filter((entry) => entry.name);
  }

  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([name, value]) => ({
      name,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
  }

  return [];
};

const getConditions = (json: Record<string, unknown>) =>
  Array.isArray(json.conditions)
    ? json.conditions
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }

          const record = entry as Record<string, unknown>;
          return {
            field: normalizeText(record.field),
            operator: normalizeText(record.operator) || 'equals',
            value: normalizeText(record.value),
            result: normalizeText(record.result),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.field))
    : [];

const getChoices = (json: Record<string, unknown>) => {
  const value = json.random_choices ?? json.choices;

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        return (
          normalizeText(record.text) ||
          normalizeText(record.value) ||
          normalizeText(record.label) ||
          JSON.stringify(entry)
        );
      }

      return '';
    })
    .filter(Boolean);
};

const getGenericFields = (json: Record<string, unknown>) =>
  Object.entries(json)
    .filter(([key]) => !key.startsWith('__') && !RESERVED_KEYS.has(key))
    .map(([key, value]) => ({
      key,
      value:
        typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : stableStringify(value),
    }));

export const setPromptBlocklyReferenceOptions = (prompts: PromptRecord[]) => {
  const options = prompts
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((prompt) => [`${prompt.name} (${prompt.id.slice(0, 8)})`, prompt.id] as [string, string]);

  promptOptionsProvider = options.length > 0 ? options : [['No prompts', '__none__']];
};

export const getPromptReferenceOptions = () => promptOptionsProvider;

const getGlobalVariableOptions = (prompts: PromptRecord[]) => {
  const values = new Set<string>();

  for (const prompt of prompts) {
    for (const variable of prompt.variables) {
      const normalized = String(variable || '').trim();

      if (normalized) {
        values.add(normalized);
      }
    }

    const rawVariables = prompt.json_data.variables;

    if (Array.isArray(rawVariables)) {
      for (const entry of rawVariables) {
        if (typeof entry === 'string' && entry.trim()) {
          values.add(entry.trim());
        } else if (
          entry &&
          typeof entry === 'object' &&
          typeof (entry as { name?: unknown }).name === 'string' &&
          (entry as { name: string }).name.trim()
        ) {
          values.add((entry as { name: string }).name.trim());
        }
      }
    }
  }

  return [...values].sort((left, right) => left.localeCompare(right));
};

const collectJsonPaths = (value: unknown, prefix = '', result = new Set<string>(), depth = 0) => {
  if (!value || typeof value !== 'object' || depth > 4) {
    return result;
  }

  if (Array.isArray(value)) {
    result.add(prefix ? `${prefix}[]` : 'items[]');

    for (const item of value.slice(0, 8)) {
      collectJsonPaths(item, prefix ? `${prefix}[]` : 'items[]', result, depth + 1);
    }

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

const getGlobalFieldOptions = (prompts: PromptRecord[]) =>
  prompts
    .flatMap((prompt) => [...collectJsonPaths(prompt.json_data)])
    .filter((path) => !path.endsWith('[]') && !RESERVED_KEYS.has(path))
    .filter((path, index, list) => list.indexOf(path) === index)
    .sort((left, right) => left.localeCompare(right));

export const registerPromptBlocklyBlocks = () => {
  if (blocksRegistered) {
    return;
  }

  Blockly.common.defineBlocks(defaultBlocklyBlocks);

  Blockly.fieldRegistry.register(
    'prompt_reference_dropdown',
    class PromptReferenceDropdown extends Blockly.FieldDropdown {
      constructor() {
        super(() => getPromptReferenceOptions());
      }
    },
  );

  Blockly.common.defineBlocksWithJsonArray([
    {
      type: BLOCK_TYPES.promptTemplate,
      message0: 'PromptTemplate name %1 mode %2 text %3 keywords %4',
      args0: [
        { type: 'field_input', name: 'NAME', text: 'Imported prompt' },
        {
          type: 'field_dropdown',
          name: 'MODE',
          options: [
            ['prompt', 'prompt'],
            ['template', 'template'],
            ['text', 'text'],
            ['system', 'system'],
            ['content', 'content'],
            ['message', 'message'],
          ],
        },
        { type: 'field_input', name: 'TEXT', text: '' },
        { type: 'field_input', name: 'KEYWORDS', text: '' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 150,
    },
    {
      type: BLOCK_TYPES.variable,
      message0: 'Variable name %1 value %2',
      args0: [
        { type: 'field_input', name: 'NAME', text: 'variable_name' },
        { type: 'field_input', name: 'VALUE', text: '' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 210,
    },
    {
      type: BLOCK_TYPES.condition,
      message0: 'Condition field %1 operator %2 value %3 result %4',
      args0: [
        { type: 'field_input', name: 'FIELD', text: 'audience' },
        {
          type: 'field_dropdown',
          name: 'OPERATOR',
          options: [
            ['equals', 'equals'],
            ['contains', 'contains'],
            ['not_equals', 'not_equals'],
            ['starts_with', 'starts_with'],
          ],
        },
        { type: 'field_input', name: 'VALUE', text: '' },
        { type: 'field_input', name: 'RESULT', text: '' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 25,
    },
    {
      type: BLOCK_TYPES.randomChoice,
      message0: 'RandomChoice A %1 B %2 C %3',
      args0: [
        { type: 'field_input', name: 'OPTION_A', text: '' },
        { type: 'field_input', name: 'OPTION_B', text: '' },
        { type: 'field_input', name: 'OPTION_C', text: '' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 300,
    },
    {
      type: BLOCK_TYPES.field,
      message0: 'Field key %1 value %2',
      args0: [
        { type: 'field_input', name: 'KEY', text: 'meta.description' },
        { type: 'field_input', name: 'VALUE', text: '' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 55,
    },
    {
      type: BLOCK_TYPES.reference,
      message0: 'Reference prompt %1 mode %2',
      args0: [
        { type: 'field_prompt_reference_dropdown', name: 'PROMPT_ID' },
        {
          type: 'field_dropdown',
          name: 'REFERENCE_MODE',
          options: [
            ['include_json', 'include_json'],
            ['include_text', 'include_text'],
            ['include_keywords', 'include_keywords'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 340,
    },
  ]);

  blocksRegistered = true;
};

export const createPromptBlocklyToolbox = (
  prompts: PromptRecord[],
): Blockly.utils.toolbox.ToolboxDefinition => {
  const globalVariables = getGlobalVariableOptions(prompts);
  const globalFields = getGlobalFieldOptions(prompts);

  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Prompt Schema',
        colour: '#3d7a57',
        contents: [
          { kind: 'block', type: BLOCK_TYPES.promptTemplate },
          { kind: 'block', type: BLOCK_TYPES.variable },
          { kind: 'block', type: BLOCK_TYPES.condition },
          { kind: 'block', type: BLOCK_TYPES.randomChoice },
          { kind: 'block', type: BLOCK_TYPES.field },
          { kind: 'block', type: BLOCK_TYPES.reference },
        ],
      },
      {
        kind: 'category',
        name: 'Global Variables',
        colour: '#4b71b0',
        contents:
          globalVariables.length > 0
            ? globalVariables.map((variable) => ({
                kind: 'block',
                type: BLOCK_TYPES.variable,
                fields: {
                  NAME: variable,
                  VALUE: '',
                },
              }))
            : [{ kind: 'label', text: 'No variables found in database yet' }],
      },
      {
        kind: 'category',
        name: 'Global Fields',
        colour: '#8d6a3b',
        contents:
          globalFields.length > 0
            ? globalFields.slice(0, 80).map((field) => ({
                kind: 'block',
                type: BLOCK_TYPES.field,
                fields: {
                  KEY: field,
                  VALUE: '',
                },
              }))
            : [{ kind: 'label', text: 'No shared JSON fields found yet' }],
      },
      {
        kind: 'category',
        name: 'Prompt References',
        colour: '#8f538b',
        contents:
          prompts.length > 0
            ? prompts.slice(0, 120).map((prompt) => ({
                kind: 'block',
                type: BLOCK_TYPES.reference,
                fields: {
                  PROMPT_ID: prompt.id,
                  REFERENCE_MODE: 'include_json',
                },
              }))
            : [{ kind: 'label', text: 'Import prompts first to enable references' }],
      },
    ],
  };
};

export const promptJsonToWorkspaceXml = (json: Record<string, unknown>) => {
  const blocks: string[] = [];
  let y = 24;

  blocks.push(`
    <block type="${BLOCK_TYPES.promptTemplate}" x="24" y="${y}">
      <field name="NAME">${escapeXml(getPromptName(json))}</field>
      <field name="MODE">${escapeXml(getPromptMode(json))}</field>
      <field name="TEXT">${escapeXml(getPromptText(json))}</field>
      <field name="KEYWORDS">${escapeXml(getKeywords(json))}</field>
    </block>
  `);

  y += 148;

  for (const variable of getVariables(json)) {
    blocks.push(`
      <block type="${BLOCK_TYPES.variable}" x="24" y="${y}">
        <field name="NAME">${escapeXml(variable.name)}</field>
        <field name="VALUE">${escapeXml(variable.value)}</field>
      </block>
    `);
    y += 92;
  }

  for (const field of getGenericFields(json)) {
    blocks.push(`
      <block type="${BLOCK_TYPES.field}" x="420" y="${y}">
        <field name="KEY">${escapeXml(field.key)}</field>
        <field name="VALUE">${escapeXml(field.value)}</field>
      </block>
    `);
    y += 92;
  }

  for (const condition of getConditions(json)) {
    blocks.push(`
      <block type="${BLOCK_TYPES.condition}" x="760" y="${y}">
        <field name="FIELD">${escapeXml(condition.field)}</field>
        <field name="OPERATOR">${escapeXml(condition.operator)}</field>
        <field name="VALUE">${escapeXml(condition.value)}</field>
        <field name="RESULT">${escapeXml(condition.result)}</field>
      </block>
    `);
    y += 120;
  }

  const choices = getChoices(json);

  if (choices.length > 0) {
    for (let index = 0; index < choices.length; index += 3) {
      blocks.push(`
        <block type="${BLOCK_TYPES.randomChoice}" x="1120" y="${24 + index * 36}">
          <field name="OPTION_A">${escapeXml(choices[index] ?? '')}</field>
          <field name="OPTION_B">${escapeXml(choices[index + 1] ?? '')}</field>
          <field name="OPTION_C">${escapeXml(choices[index + 2] ?? '')}</field>
        </block>
      `);
    }
  }

  return `<xml xmlns="https://developers.google.com/blockly/xml">${blocks.join('')}</xml>`;
};

const getFieldValue = (block: Blockly.Block, fieldName: string) => block.getFieldValue(fieldName) ?? '';

export const workspaceToPromptJson = (
  workspace: Blockly.Workspace,
  baseJson: Record<string, unknown>,
  prompts: PromptRecord[],
) => {
  const nextJson: Record<string, unknown> = {
    ...baseJson,
  };
  const variables: Array<string | { name: string; value: string }> = [];
  const conditions: Array<{
    field: string;
    operator: string;
    value: string;
    result: string;
  }> = [];
  const randomChoices: string[] = [];
  const references: Array<{
    promptId: string;
    mode: string;
  }> = [];

  const blocks = workspace.getTopBlocks(true);

  for (const block of blocks) {
    switch (block.type) {
      case BLOCK_TYPES.promptTemplate: {
        const mode = getFieldValue(block, 'MODE') || 'text';
        const name = getFieldValue(block, 'NAME').trim();
        const text = getFieldValue(block, 'TEXT');
        const keywords = getFieldValue(block, 'KEYWORDS')
          .split(',')
          .map((entry: string) => entry.trim())
          .filter(Boolean);

        nextJson.name = name || 'Imported prompt';
        nextJson[mode] = text;
        nextJson.keywords = keywords;
        break;
      }
      case BLOCK_TYPES.variable: {
        const name = getFieldValue(block, 'NAME').trim();
        const value = getFieldValue(block, 'VALUE').trim();

        if (name) {
          variables.push(value ? { name, value } : name);
        }

        break;
      }
      case BLOCK_TYPES.condition: {
        const field = getFieldValue(block, 'FIELD').trim();

        if (!field) {
          break;
        }

        conditions.push({
          field,
          operator: getFieldValue(block, 'OPERATOR') || 'equals',
          value: getFieldValue(block, 'VALUE').trim(),
          result: getFieldValue(block, 'RESULT').trim(),
        });
        break;
      }
      case BLOCK_TYPES.randomChoice: {
        randomChoices.push(
          ...[
            getFieldValue(block, 'OPTION_A').trim(),
            getFieldValue(block, 'OPTION_B').trim(),
            getFieldValue(block, 'OPTION_C').trim(),
          ].filter(Boolean),
        );
        break;
      }
      case BLOCK_TYPES.field: {
        const key = getFieldValue(block, 'KEY').trim();
        const value = getFieldValue(block, 'VALUE');

        if (key) {
          setPathValue(nextJson, key, parseFieldValue(value));
        }

        break;
      }
      case BLOCK_TYPES.reference: {
        const promptId = getFieldValue(block, 'PROMPT_ID');
        const mode = getFieldValue(block, 'REFERENCE_MODE') || 'include_json';

        if (!promptId || promptId === '__none__') {
          break;
        }

        const referencedPrompt = prompts.find((entry) => entry.id === promptId);

        if (!referencedPrompt) {
          break;
        }

        references.push({ promptId, mode });

        if (!Array.isArray(nextJson.linked_prompt_ids)) {
          nextJson.linked_prompt_ids = [];
        }

        (nextJson.linked_prompt_ids as string[]).push(promptId);

        if (mode === 'include_text') {
          const existingText = normalizeText(nextJson.text);
          nextJson.text = [existingText, referencedPrompt.text].filter(Boolean).join('\n\n');
        }

        if (mode === 'include_keywords') {
          const existing = Array.isArray(nextJson.keywords) ? nextJson.keywords : [];
          nextJson.keywords = Array.from(
            new Set([
              ...existing.filter((entry): entry is string => typeof entry === 'string'),
              ...referencedPrompt.keywords,
            ]),
          );
        }

        if (mode === 'include_json') {
          if (!Array.isArray(nextJson.referenced_prompts)) {
            nextJson.referenced_prompts = [];
          }

          (nextJson.referenced_prompts as unknown[]).push({
            id: referencedPrompt.id,
            name: referencedPrompt.name,
            json_data: referencedPrompt.json_data,
          });
        }

        break;
      }
      default:
        break;
    }
  }

  if (variables.length > 0) {
    nextJson.variables = variables;
  } else {
    delete nextJson.variables;
  }

  if (conditions.length > 0) {
    nextJson.conditions = conditions;
  } else {
    delete nextJson.conditions;
  }

  if (randomChoices.length > 0) {
    nextJson.random_choices = randomChoices;
  } else {
    delete nextJson.random_choices;
  }

  if (references.length > 0) {
    nextJson.blockly_references = references;
  } else {
    delete nextJson.blockly_references;
    delete nextJson.linked_prompt_ids;
    delete nextJson.referenced_prompts;
  }

  return nextJson;
};
