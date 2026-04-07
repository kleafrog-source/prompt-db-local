import { useEffect } from 'react';
import { ExportPanel } from '@/components/ExportPanel';
import { ImportPanel } from '@/components/ImportPanel';
import { MMSSRuntimePanel } from '@/components/MMSSRuntimePanel';
import { PromptEditor } from '@/components/PromptEditor';
import { PromptList } from '@/components/PromptList';
import { SequencePresetsPanel } from '@/components/SequencePresetsPanel';
import { TagKeyExplorer } from '@/components/TagKeyExplorer';
import { usePrompts } from '@/hooks/usePrompts';
import { usePromptStore } from '@/store/promptStore';
import type { ElementTagBinding, ExportPreset, KeySequencePreset, TagRegistry } from '@/types/meta';

const App = () => {
  const { filteredPrompts, prompts, selectedPrompt, selectedPromptTags, tagsByPromptId } = usePrompts();
  const filters = usePromptStore((state) => state.filters);
  const selectedPromptId = usePromptStore((state) => state.selectedPromptId);
  const wsStatus = usePromptStore((state) => state.wsStatus);
  const importLog = usePromptStore((state) => state.importLog);
  const tagRegistry = usePromptStore((state) => state.tagRegistry);
  const elementTagBindings = usePromptStore((state) => state.elementTagBindings);
  const keySequencePresets = usePromptStore((state) => state.keySequencePresets);
  const exportPresets = usePromptStore((state) => state.exportPresets);
  const loadPrompts = usePromptStore((state) => state.loadPrompts);
  const loadMetaState = usePromptStore((state) => state.loadMetaState);
  const saveMetaState = usePromptStore((state) => state.saveMetaState);
  const setSelectedPrompt = usePromptStore((state) => state.setSelectedPrompt);
  const setFilters = usePromptStore((state) => state.setFilters);
  const savePrompt = usePromptStore((state) => state.savePrompt);
  const deletePrompt = usePromptStore((state) => state.deletePrompt);
  const importRawJson = usePromptStore((state) => state.importRawJson);
  const resetDatabase = usePromptStore((state) => state.resetDatabase);
  const setWsStatus = usePromptStore((state) => state.setWsStatus);

  useEffect(() => {
    void loadPrompts();
    void loadMetaState();

    if (!window.electronAPI) {
      return;
    }

    void window.electronAPI.getWsStatus().then(setWsStatus);

    const unsubscribeImport = window.electronAPI.onImportedJson((payload) => {
      void importRawJson(payload.rawJson, payload.source).catch((error) => {
        console.error('Failed to import websocket payload', error);
      });
      void window.electronAPI?.getWsStatus().then(setWsStatus);
    });
    const unsubscribeWs = window.electronAPI.onWsStatus((payload) => {
      setWsStatus(payload);
    });

    return () => {
      unsubscribeImport();
      unsubscribeWs();
    };
  }, [importRawJson, loadMetaState, loadPrompts, setWsStatus]);

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

  const handleRunSyncSelfTest = async () => {
    if (!window.electronAPI) {
      return;
    }

    await window.electronAPI.runWsSelfTest();
    const status = await window.electronAPI.getWsStatus();
    setWsStatus(status);
  };

  const handleImportGenerated = async (blocks: any[], intent: string) => {
    // Treat the generated block set as a single import source
    const rawJson = JSON.stringify(blocks);
    await importRawJson(rawJson, `mmss-v3:${intent}`);
  };

  const persistRegistryAndBindings = async (
    nextTagRegistry: TagRegistry,
    nextBindings: ElementTagBinding[],
  ) => {
    await saveMetaState({
      tagRegistry: nextTagRegistry,
      elementTagBindings: nextBindings,
    });
  };

  const persistSequencePresets = async (presets: KeySequencePreset[]) => {
    await saveMetaState({
      keySequencePresets: presets,
    });
  };

  const persistExportPresets = async (presets: ExportPreset[]) => {
    await saveMetaState({
      exportPresets: presets,
    });
  };

  const resolvePromptTags = (promptId: string) =>
    (tagsByPromptId.get(promptId) ?? [])
      .map((tagId) => tagRegistry.tags.find((tag) => tag.id === tagId))
      .filter((tag): tag is (typeof tagRegistry.tags)[number] => tag !== undefined);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
        <p className="eyebrow">Local Prompt Organism</p>
          <h1>Electron prompt laboratory for clean JSON blocks, tags, and batch generation</h1>
        </div>
        <p className="hero-copy">
          A local-first workspace for importing strict JSON fragments, curating tags and sequences,
          and generating clean prompt batches for producer.ai without leaking technical metadata.
        </p>
      </section>

      <section className="layout-grid">
        <PromptList
          prompts={filteredPrompts}
          selectedPromptId={selectedPromptId}
          searchQuery={filters.query}
          resolveTags={resolvePromptTags}
          onSearchChange={(value) => setFilters({ query: value })}
          onSelectPrompt={setSelectedPrompt}
        />

        <div className="content-column">
          <ImportPanel
            wsState={wsStatus.state}
            wsPort={wsStatus.port}
            lastWsMessageAt={wsStatus.lastMessageAt}
            lastWsSource={wsStatus.lastSource}
            importLog={importLog}
            onImportFile={handleImportFile}
            onResetDatabase={resetDatabase}
            onRunSyncSelfTest={handleRunSyncSelfTest}
          />

          <TagKeyExplorer
            prompts={prompts}
            tagRegistry={tagRegistry}
            bindings={elementTagBindings}
            onPersist={persistRegistryAndBindings}
          />

          <SequencePresetsPanel
            prompts={prompts}
            presets={keySequencePresets}
            onPersist={persistSequencePresets}
          />

          <PromptEditor
            prompt={selectedPrompt}
            promptTags={selectedPromptTags}
            onSave={async (draft) => {
              await savePrompt(draft);
            }}
            onDelete={deletePrompt}
          />

          <MMSSRuntimePanel 
            onImportGenerated={handleImportGenerated}
          />

          <ExportPanel
            prompts={prompts}
            tagRegistry={tagRegistry}
            bindings={elementTagBindings}
            sequencePresets={keySequencePresets}
            exportPresets={exportPresets}
            onPersistPresets={persistExportPresets}
          />
        </div>
      </section>
    </main>
  );
};

export default App;
