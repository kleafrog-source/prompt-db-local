import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

type ImportEnvelope = {
  id: string;
  rawJson: string;
  source: string;
  receivedAt: string;
};

const WS_PORT = 3001;
const pendingImports: ImportEnvelope[] = [];
let mainWindow: BrowserWindow | null = null;
let websocketServer: WebSocketServer | null = null;

const createEnvelope = (rawJson: string, source = 'unknown'): ImportEnvelope => ({
  id: crypto.randomUUID(),
  rawJson,
  source,
  receivedAt: new Date().toISOString(),
});

const broadcastImport = (payload: ImportEnvelope) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('producer:json-received', payload);
    return;
  }

  pendingImports.push(payload);
};

const flushPendingImports = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  while (pendingImports.length > 0) {
    const nextPayload = pendingImports.shift();

    if (nextPayload) {
      mainWindow.webContents.send('producer:json-received', nextPayload);
    }
  }
};

const startWebSocketServer = () => {
  websocketServer = new WebSocketServer({ port: WS_PORT });

  websocketServer.on('connection', (socket: WebSocket) => {
    socket.on('message', (message: RawData) => {
      const raw = message.toString();

      try {
        const parsed = JSON.parse(raw) as { payload?: unknown; source?: string };
        const rawJson =
          typeof parsed.payload === 'string'
            ? parsed.payload
            : JSON.stringify(parsed.payload ?? parsed);

        broadcastImport(createEnvelope(rawJson, parsed.source ?? 'ws-client'));
      } catch {
        broadcastImport(createEnvelope(raw, 'ws-client'));
      }
    });
  });

  websocketServer.on('listening', () => {
    mainWindow?.webContents.send('ws:status', {
      port: WS_PORT,
      state: 'listening',
    });
  });

  websocketServer.on('close', () => {
    mainWindow?.webContents.send('ws:status', {
      port: WS_PORT,
      state: 'closed',
    });
  });
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: '#f4f0e8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('did-finish-load', flushPendingImports);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
  }
};

ipcMain.handle('dialogs:open-json', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Supported files', extensions: ['json', 'md', 'txt'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Text', extensions: ['txt'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const files = await Promise.all(
    result.filePaths.map(async (filePath) => ({
      filePath,
      content: await readFile(filePath, 'utf-8'),
    })),
  );

  return files;
});

ipcMain.handle('ws:get-status', async () => ({
  port: WS_PORT,
  state: websocketServer ? 'listening' : 'stopped',
}));

ipcMain.handle(
  'dialogs:save-export-file',
  async (_event, payload: { defaultFileName: string; content: string }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: payload.defaultFileName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    await writeFile(result.filePath, payload.content, 'utf-8');

    return {
      filePath: result.filePath,
    };
  },
);

ipcMain.handle(
  'dialogs:export-batch-files',
  async (
    _event,
    payload: {
      defaultFolderName: string;
      files: Array<{ fileName: string; content: string }>;
    },
  ) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const rootDir = result.filePaths[0];
    const targetDir = path.join(rootDir, payload.defaultFolderName);
    await mkdir(targetDir, { recursive: true });

    await Promise.all(
      payload.files.map((file) =>
        writeFile(path.join(targetDir, file.fileName), file.content, 'utf-8'),
      ),
    );

    return {
      directoryPath: targetDir,
      count: payload.files.length,
    };
  },
);

app.whenReady().then(async () => {
  await createWindow();
  startWebSocketServer();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  websocketServer?.close();
});
