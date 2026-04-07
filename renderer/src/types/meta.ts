export type DBElementId = string;

export type DBElement = {
  id: DBElementId;
  raw: unknown;
  tagIds?: string[];
};

export type Tag = {
  id: string;
  label: string;
  color: string;
  type: 'key' | 'value' | 'semantic';
};

export type TagRegistry = {
  tags: Tag[];
};

export type KeyPath = string;

export type KeySequence = {
  id: string;
  pathChain: KeyPath[];
  usageCount: number;
};

export type KeySequencePreset = {
  id: string;
  name: string;
  description?: string;
  sequences: KeySequence[];
  generationRules?: {
    mode: 'random' | 'weighted' | 'sequential';
    maxBlocks?: number;
    allowRepetition?: boolean;
  };
};

export type ElementTagBinding = {
  elementId: DBElementId;
  tags: string[];
};

export type ExportPreset = {
  id: string;
  label: string;
  description?: string;
  filters?: {
    includeTags?: string[];
    excludeTags?: string[];
    includeKeys?: string[];
    excludeKeys?: string[];
  };
  composition?: {
    mode: 'as-is' | 'random-mix' | 'sequence-based' | 'mmss-v3';
    pattern?: string;
  };
  slicing?: {
    useKeySequences?: string[];
    maxBlocksPerElement?: number;
  };
  output?: {
    fileNamePattern: string;
    format: 'json';
  };
};

export type PromptDbMetaState = {
  tagRegistry: TagRegistry;
  elementTagBindings: ElementTagBinding[];
  keySequencePresets: KeySequencePreset[];
  exportPresets: ExportPreset[];
};

export type FrequencyEntry = {
  value: string;
  count: number;
};

export const createEmptyMetaState = (): PromptDbMetaState => ({
  tagRegistry: {
    tags: [],
  },
  elementTagBindings: [],
  keySequencePresets: [],
  exportPresets: [],
});
