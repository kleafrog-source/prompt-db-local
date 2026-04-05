type ImportPanelProps = {
  wsState: string;
  wsPort: number;
  importLog: Array<{
    id: string;
    source: string;
    receivedAt: string;
    count: number;
    status: 'success' | 'empty' | 'error';
    message: string;
  }>;
  onImportFile: () => Promise<void>;
  onResetDatabase: () => Promise<void>;
};

export const ImportPanel = ({
  wsState,
  wsPort,
  importLog,
  onImportFile,
  onResetDatabase,
}: ImportPanelProps) => (
  <section className="panel accent-panel">
    <div className="panel-heading">
      <div>
        <p className="eyebrow">Ingress</p>
        <h2>Import Flow</h2>
      </div>
      <span className={`badge badge-${wsState}`}>WS {wsState}</span>
    </div>

    <p className="panel-copy">
      Electron listens on <code>ws://localhost:{wsPort}</code> and forwards payloads from the
      Chrome extension into IndexedDB.
    </p>

    <div className="button-row">
      <button type="button" className="primary-button" onClick={() => void onImportFile()}>
        Import JSON file
      </button>
      <button type="button" className="secondary-button" onClick={() => void onResetDatabase()}>
        Clear local DB
      </button>
    </div>

    <div className="log-list">
      {importLog.map((entry) => (
        <article key={entry.id} className={`log-entry log-entry-${entry.status}`}>
          <strong>{entry.source}</strong>
          <span>{entry.message}</span>
          <small>{new Date(entry.receivedAt).toLocaleString()}</small>
        </article>
      ))}

      {importLog.length === 0 ? (
        <div className="empty-inline">
          Import history will appear here after the first file or websocket payload.
        </div>
      ) : null}
    </div>
  </section>
);
