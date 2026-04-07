import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Server as HttpServer } from 'node:http';
import path from 'node:path';
import WebSocket, { WebSocketServer, type RawData, type WebSocket as ServerWebSocket } from 'ws';
import { HTTP_API_PORT, startHttpApiServer } from './httpApi';
import {
  clearMetaState,
  loadMetaState,
  saveMetaState,
  savePromptSnapshot,
  type PromptDbMetaState,
  type PromptSnapshotRecord,
} from './metaStore';

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
let httpApiServer: HttpServer | null = null;
let lastWsMessageAt: string | null = null;
let lastWsSource = 'none';

const createEnvelope = (rawJson: string, source = 'unknown'): ImportEnvelope => ({
  id: crypto.randomUUID(),
  rawJson,
  source,
  receivedAt: new Date().toISOString(),
});

const broadcastImport = (payload: ImportEnvelope) => {
  lastWsMessageAt = payload.receivedAt;
  lastWsSource = payload.source;

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

  websocketServer.on('connection', (socket: ServerWebSocket) => {
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
      lastMessageAt: lastWsMessageAt,
      lastSource: lastWsSource,
    });
  });

  websocketServer.on('close', () => {
    mainWindow?.webContents.send('ws:status', {
      port: WS_PORT,
      state: 'closed',
      lastMessageAt: lastWsMessageAt,
      lastSource: lastWsSource,
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
  lastMessageAt: lastWsMessageAt,
  lastSource: lastWsSource,
}));

ipcMain.handle('meta:load-state', async () => loadMetaState());

ipcMain.handle('meta:save-state', async (_event, payload: PromptDbMetaState) => saveMetaState(payload));

ipcMain.handle('meta:clear-state', async () => clearMetaState());

ipcMain.handle('snapshot:save-prompts', async (_event, payload: PromptSnapshotRecord[]) =>
  savePromptSnapshot(payload),
);

ipcMain.handle('ws:run-self-test', async () => {
  const payload = JSON.stringify({
    source: 'producer.ai-extension:self-test',
    payload: {
      name: 'extension sync self test',
      prompt: 'Confirm websocket pipeline for {{system}}.',
      variables: ['system'],
      keywords: ['self-test', 'extension', 'ws'],
      meta: {
        generatedAt: new Date().toISOString(),
      },
    },
  });

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

    socket.on('open', () => {
      socket.send(payload);
      socket.close();
      resolve();
    });

    socket.on('error', (error) => {
      reject(error);
    });
  });

  return {
    ok: true,
    wsUrl: `ws://127.0.0.1:${WS_PORT}`,
    sentAt: new Date().toISOString(),
  };
});

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

ipcMain.handle(
  'mmss:run-task',
  async (_event, payload: { script: string; args: string[] }) => {
    return new Promise((resolve) => {
      const appPath = app.getAppPath();
      // Ensure we are in the prompt-db-local directory
      const workingDir = appPath.endsWith('prompt-db-local') 
        ? appPath 
        : path.join(appPath, 'prompt-db-local');
      
      const scriptPath = path.join(workingDir, payload.script);
      
      console.log(`Running Python task: ${scriptPath} in ${workingDir}`);

      // Try 'python' then 'python3'
      let pythonExecutable = 'python';
      
      const startProcess = (exe: string) => {
        const pythonProcess = spawn(exe, [scriptPath, ...payload.args], {
          cwd: workingDir,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });

        let output = '';
        let error = '';

        pythonProcess.stdout.on('data', (data) => {
          output += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          error += data.toString();
        });

        pythonProcess.on('error', (err) => {
          if (exe === 'python') {
            console.log('python not found, trying python3');
            startProcess('python3');
          } else {
            resolve({ ok: false, output: '', error: `Failed to start Python: ${err.message}` });
          }
        });

        pythonProcess.on('close', (code) => {
          if (code === 0) {
            try {
              const lines = output.trim().split('\n');
              const lastLine = lines[lines.length - 1];
              const data = JSON.parse(lastLine);
              resolve({ ok: true, output, data });
            } catch {
              resolve({ ok: true, output });
            }
          } else {
            resolve({ ok: false, output, error: error || `Exit code ${code}` });
          }
        });
      };

      startProcess(pythonExecutable);
    });
  },
);

app.whenReady().then(async () => {
  await createWindow();
  startWebSocketServer();
  httpApiServer = await startHttpApiServer(HTTP_API_PORT);

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
  httpApiServer?.close();
});
