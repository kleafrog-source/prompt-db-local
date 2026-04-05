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
};

interface Window {
  electronAPI?: {
    openJsonFile: () => Promise<Array<{ filePath: string; content: string }> | null>;
    getWsStatus: () => Promise<WsStatus>;
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
