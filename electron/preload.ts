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
});
