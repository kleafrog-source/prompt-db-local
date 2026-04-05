import type { ExportFormatKey, ExportMode } from '@/utils/exportPrompts';

export type BatchPresetConfig = {
  presetName: string;
  files: number;
  items: number;
  mode: ExportMode;
  query: string;
  exportFormat: ExportFormatKey;
  variableKeys: string[];
  outputFields: string[];
};

export type BatchPresetRecord = BatchPresetConfig & {
  id: string;
  blocklyXml: string;
  created_at: string;
  updated_at: string;
};

export type BatchPresetDraft = Partial<BatchPresetRecord> & BatchPresetConfig;
