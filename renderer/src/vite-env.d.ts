/// <reference types="vite/client" />

type ImportEnvelope = {
  id: string;
  rawJson: string;
  source: string;
  receivedAt: string;
};

type WsStatus = {
  port: number;
  state: 'listening' | 'closed' | 'stopped';
  lastMessageAt: string | null;
  lastSource: string;
};

type PromptDbMetaState = {
  tagRegistry: {
    tags: Array<{
      id: string;
      label: string;
      color: string;
      type: 'key' | 'value' | 'semantic';
    }>;
  };
  elementTagBindings: Array<{
    elementId: string;
    tags: string[];
  }>;
  keySequencePresets: Array<{
    id: string;
    name: string;
    description?: string;
    sequences: Array<{
      id: string;
      pathChain: string[];
      usageCount: number;
    }>;
    generationRules?: {
      mode: 'random' | 'weighted' | 'sequential';
      maxBlocks?: number;
      allowRepetition?: boolean;
    };
  }>;
  exportPresets: Array<{
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
      mode: 'as-is' | 'random-mix' | 'sequence-based';
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
  }>;
};

type PromptSnapshotRecord = {
  id: string;
  name: string;
  text: string;
  json_data: Record<string, unknown>;
  fingerprint: string;
  variables: string[];
  keywords: string[];
  created_at: string;
  updated_at: string;
  source?: string;
};

interface Window {
  electronAPI?: {
    openJsonFile: () => Promise<Array<{ filePath: string; content: string }> | null>;
    getWsStatus: () => Promise<WsStatus>;
    runWsSelfTest: () => Promise<{ ok: boolean; wsUrl: string; sentAt: string }>;
    loadMetaState: () => Promise<PromptDbMetaState>;
    saveMetaState: (payload: PromptDbMetaState) => Promise<{ directoryPath: string }>;
    clearMetaState: () => Promise<PromptDbMetaState>;
    savePromptSnapshot: (payload: PromptSnapshotRecord[]) => Promise<{
      directoryPath: string;
      count: number;
    }>;
    saveExportFile: (payload: {
      defaultFileName: string;
      content: string;
    }) => Promise<{ filePath: string } | null>;
    exportBatchFiles: (payload: {
      defaultFolderName: string;
      files: Array<{ fileName: string; content: string }>;
    }) => Promise<{ directoryPath: string; count: number } | null>;
    onImportedJson: (callback: (payload: ImportEnvelope) => void) => () => void;
    onWsStatus: (callback: (payload: WsStatus) => void) => () => void;
  };
}
