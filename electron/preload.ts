import { contextBridge, ipcRenderer } from 'electron';

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

type MMSSJobResult = {
  ok: boolean;
  output: string;
  error?: string;
  data?: any;
};

contextBridge.exposeInMainWorld('electronAPI', {
  openJsonFile: async () =>
    ipcRenderer.invoke('dialogs:open-json') as Promise<
      | Array<{
          filePath: string;
          content: string;
        }>
      | null
    >,
  getWsStatus: async () => ipcRenderer.invoke('ws:get-status') as Promise<WsStatus>,
  runWsSelfTest: async () =>
    ipcRenderer.invoke('ws:run-self-test') as Promise<{
      ok: boolean;
      wsUrl: string;
      sentAt: string;
    }>,
  loadMetaState: async () => ipcRenderer.invoke('meta:load-state') as Promise<PromptDbMetaState>,
  saveMetaState: async (payload: PromptDbMetaState) =>
    ipcRenderer.invoke('meta:save-state', payload) as Promise<{
      directoryPath: string;
    }>,
  clearMetaState: async () => ipcRenderer.invoke('meta:clear-state') as Promise<PromptDbMetaState>,
  savePromptSnapshot: async (payload: PromptSnapshotRecord[]) =>
    ipcRenderer.invoke('snapshot:save-prompts', payload) as Promise<{
      directoryPath: string;
      count: number;
    }>,
  saveExportFile: async (payload: { defaultFileName: string; content: string }) =>
    ipcRenderer.invoke('dialogs:save-export-file', payload) as Promise<
      | {
          filePath: string;
        }
      | null
    >,
  exportBatchFiles: async (
    payload: {
      defaultFolderName: string;
      files: Array<{ fileName: string; content: string }>;
    },
  ) =>
    ipcRenderer.invoke('dialogs:export-batch-files', payload) as Promise<
      | {
          directoryPath: string;
          count: number;
        }
      | null
    >,
  onImportedJson: (callback: (payload: ImportEnvelope) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ImportEnvelope) => {
      callback(payload);
    };

    ipcRenderer.on('producer:json-received', listener);

    return () => {
      ipcRenderer.removeListener('producer:json-received', listener);
    };
  },
  onWsStatus: (callback: (payload: WsStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WsStatus) => {
      callback(payload);
    };

    ipcRenderer.on('ws:status', listener);

    return () => {
      ipcRenderer.removeListener('ws:status', listener);
    };
  },
  mmssRunTask: async (payload: { script: string; args: string[] }) =>
    ipcRenderer.invoke('mmss:run-task', payload) as Promise<MMSSJobResult>,
});
