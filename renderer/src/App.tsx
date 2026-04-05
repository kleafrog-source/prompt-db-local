import { useEffect } from 'react';
import { BlocklyEditor } from '@/components/BlocklyEditor';
import { ExportPanel } from '@/components/ExportPanel';
import { ImportPanel } from '@/components/ImportPanel';
import { MergePanel } from '@/components/MergePanel';
import { PromptEditor } from '@/components/PromptEditor';
import { PromptList } from '@/components/PromptList';
import { usePrompts } from '@/hooks/usePrompts';
import { usePromptStore } from '@/store/promptStore';

const App = () => {
  const { filteredPrompts, prompts, selectedPrompt } = usePrompts();
  const filters = usePromptStore((state) => state.filters);
  const selectedPromptId = usePromptStore((state) => state.selectedPromptId);
  const wsStatus = usePromptStore((state) => state.wsStatus);
  const importLog = usePromptStore((state) => state.importLog);
  const loadPrompts = usePromptStore((state) => state.loadPrompts);
  const loadBatchPresets = usePromptStore((state) => state.loadBatchPresets);
  const setSelectedPrompt = usePromptStore((state) => state.setSelectedPrompt);
  const setFilters = usePromptStore((state) => state.setFilters);
  const savePrompt = usePromptStore((state) => state.savePrompt);
  const deletePrompt = usePromptStore((state) => state.deletePrompt);
  const importRawJson = usePromptStore((state) => state.importRawJson);
  const resetDatabase = usePromptStore((state) => state.resetDatabase);
  const setWsStatus = usePromptStore((state) => state.setWsStatus);

  useEffect(() => {
    void loadPrompts();
    void loadBatchPresets();

    if (!window.electronAPI) {
      return;
    }

    void window.electronAPI.getWsStatus().then(setWsStatus);

    const unsubscribeImport = window.electronAPI.onImportedJson((payload) => {
      void importRawJson(payload.rawJson, payload.source).catch((error) => {
        console.error('Failed to import websocket payload', error);
      });
    });
    const unsubscribeWs = window.electronAPI.onWsStatus((payload) => {
      setWsStatus(payload);
    });

    return () => {
      unsubscribeImport();
      unsubscribeWs();
    };
  }, [importRawJson, loadBatchPresets, loadPrompts, setWsStatus]);

  const handleImportFile = async () => {
    const results = await window.electronAPI?.openJsonFile();

    if (!results || results.length === 0) {
      return;
    }

    try {
      for (const result of results) {
        await importRawJson(result.content, result.filePath);
      }
    } catch (error) {
      console.error('Failed to import file', error);
    }
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Local Prompt Organism</p>
          <h1>Electron + React + IndexedDB prompt laboratory</h1>
        </div>
        <p className="hero-copy">
          A local-first workspace for parsing messy JSON, curating prompts, and accepting imports
          from a Chrome extension over websocket.
        </p>
      </section>

      <section className="layout-grid">
        <PromptList
          prompts={filteredPrompts}
          selectedPromptId={selectedPromptId}
          searchQuery={filters.query}
          onSearchChange={(value) => setFilters({ query: value })}
          onSelectPrompt={setSelectedPrompt}
        />

        <div className="content-column">
          <ImportPanel
            wsState={wsStatus.state}
            wsPort={wsStatus.port}
            importLog={importLog}
            onImportFile={handleImportFile}
            onResetDatabase={resetDatabase}
          />

          <PromptEditor
            prompt={selectedPrompt}
            onSave={async (draft) => {
              await savePrompt({
                ...draft,
                json_data: draft.json_data,
              });
            }}
            onDelete={deletePrompt}
          />

          <BlocklyEditor
            prompt={selectedPrompt}
            prompts={prompts}
            onSave={savePrompt}
          />
          <ExportPanel prompts={prompts} />
          <MergePanel prompts={prompts} />
        </div>
      </section>
    </main>
  );
};

export default App;
