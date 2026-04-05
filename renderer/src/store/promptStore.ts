import { create } from 'zustand';
import { clearPromptsDb, normalizePromptDraft, promptsDb } from '@/db/promptsDb';
import type {
  ElementTagBinding,
  ExportPreset,
  KeySequencePreset,
  PromptDbMetaState,
  TagRegistry,
} from '@/types/meta';
import type { PromptDraft, PromptRecord, PromptSearchFilters } from '@/types/prompt';
import { createEmptyMetaState } from '@/types/meta';
import { parseJsonToPrompts } from '@/utils/parser';

type ImportLogEntry = {
  id: string;
  source: string;
  receivedAt: string;
  count: number;
  status: 'success' | 'empty' | 'error';
  message: string;
};

const createImportLogEntry = (
  source: string,
  receivedAt: string,
  count: number,
  status: ImportLogEntry['status'],
  message: string,
): ImportLogEntry => ({
  id: crypto.randomUUID(),
  source,
  receivedAt,
  count,
  status,
  message,
});

type WsState = {
  port: number;
  state: 'listening' | 'closed' | 'stopped';
  lastMessageAt: string | null;
  lastSource: string;
};

type PromptStore = {
  prompts: PromptRecord[];
  tagRegistry: TagRegistry;
  elementTagBindings: ElementTagBinding[];
  keySequencePresets: KeySequencePreset[];
  exportPresets: ExportPreset[];
  selectedPromptId: string | null;
  filters: PromptSearchFilters;
  wsStatus: WsState;
  importLog: ImportLogEntry[];
  loadPrompts: () => Promise<void>;
  loadMetaState: () => Promise<void>;
  saveMetaState: (next?: Partial<PromptDbMetaState>) => Promise<void>;
  setSelectedPrompt: (promptId: string | null) => void;
  setFilters: (filters: Partial<PromptSearchFilters>) => void;
  savePrompt: (draft: PromptDraft) => Promise<PromptRecord>;
  deletePrompt: (promptId: string) => Promise<void>;
  importRawJson: (rawJson: string, source: string) => Promise<number>;
  resetDatabase: () => Promise<void>;
  setWsStatus: (status: WsState) => void;
  setTagRegistry: (tagRegistry: TagRegistry) => void;
  setElementTagBindings: (bindings: ElementTagBinding[]) => void;
  setKeySequencePresets: (presets: KeySequencePreset[]) => void;
  setExportPresets: (presets: ExportPreset[]) => void;
};

const emptyMeta = createEmptyMetaState();

export const usePromptStore = create<PromptStore>((set, get) => ({
  prompts: [],
  tagRegistry: emptyMeta.tagRegistry,
  elementTagBindings: emptyMeta.elementTagBindings,
  keySequencePresets: emptyMeta.keySequencePresets,
  exportPresets: emptyMeta.exportPresets,
  selectedPromptId: null,
  filters: {
    query: '',
  },
  wsStatus: {
    port: 3001,
    state: 'stopped',
    lastMessageAt: null,
    lastSource: 'none',
  },
  importLog: [],
  loadPrompts: async () => {
    const prompts = await promptsDb.prompts.orderBy('updated_at').reverse().toArray();

    if (window.electronAPI) {
      await window.electronAPI.savePromptSnapshot(prompts);
    }

    set((state) => ({
      prompts,
      selectedPromptId:
        state.selectedPromptId && prompts.some((prompt) => prompt.id === state.selectedPromptId)
          ? state.selectedPromptId
          : prompts[0]?.id ?? null,
    }));
  },
  loadMetaState: async () => {
    if (!window.electronAPI) {
      return;
    }

    const metaState = (await window.electronAPI.loadMetaState()) as PromptDbMetaState;

    set({
      tagRegistry: metaState.tagRegistry,
      elementTagBindings: metaState.elementTagBindings,
      keySequencePresets: metaState.keySequencePresets,
      exportPresets: metaState.exportPresets,
    });
  },
  saveMetaState: async (next) => {
    if (!window.electronAPI) {
      return;
    }

    const current = get();
    const payload: PromptDbMetaState = {
      tagRegistry: next?.tagRegistry ?? current.tagRegistry,
      elementTagBindings: next?.elementTagBindings ?? current.elementTagBindings,
      keySequencePresets: next?.keySequencePresets ?? current.keySequencePresets,
      exportPresets: next?.exportPresets ?? current.exportPresets,
    };

    await window.electronAPI.saveMetaState(payload);
    set(payload);
  },
  setSelectedPrompt: (selectedPromptId) => set({ selectedPromptId }),
  setFilters: (filters) =>
    set((state) => ({
      filters: {
        ...state.filters,
        ...filters,
      },
    })),
  savePrompt: async (draft) => {
    const prompt = normalizePromptDraft(draft);

    await promptsDb.prompts.put(prompt);
    await get().loadPrompts();
    set({ selectedPromptId: prompt.id });
    return prompt;
  },
  deletePrompt: async (promptId) => {
    await promptsDb.prompts.delete(promptId);
    await get().loadPrompts();
    set((state) => ({
      elementTagBindings: state.elementTagBindings.filter((binding) => binding.elementId !== promptId),
    }));
    await get().saveMetaState({
      elementTagBindings: get().elementTagBindings.filter((binding) => binding.elementId !== promptId),
    });
  },
  importRawJson: async (rawJson, source) => {
    const receivedAt = new Date().toISOString();

    try {
      const parsed = parseJsonToPrompts(rawJson, { source });
      const normalized = parsed.map((draft) => normalizePromptDraft(draft));
      const seenFingerprints = new Set<string>();
      const uniqueBatch = normalized.filter((prompt) => {
        if (seenFingerprints.has(prompt.fingerprint)) {
          return false;
        }

        seenFingerprints.add(prompt.fingerprint);
        return true;
      });
      const existingRecords =
        uniqueBatch.length > 0
          ? await promptsDb.prompts
              .where('fingerprint')
              .anyOf(uniqueBatch.map((prompt) => prompt.fingerprint))
              .toArray()
          : [];
      const existingFingerprints = new Set(existingRecords.map((prompt) => prompt.fingerprint));
      const promptsToInsert = uniqueBatch.filter(
        (prompt) => !existingFingerprints.has(prompt.fingerprint),
      );
      const duplicateCount = normalized.length - promptsToInsert.length;

      if (promptsToInsert.length > 0) {
        await promptsDb.prompts.bulkPut(promptsToInsert);
        await get().loadPrompts();
      }

      set((state) => ({
        importLog: [
          createImportLogEntry(
            source,
            receivedAt,
            promptsToInsert.length,
            promptsToInsert.length > 0 ? 'success' : 'empty',
            promptsToInsert.length > 0
              ? `Imported ${promptsToInsert.length} prompt${promptsToInsert.length === 1 ? '' : 's'}${duplicateCount > 0 ? `, skipped ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'}` : ''}.`
              : duplicateCount > 0
                ? `Skipped ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'}; no new prompts were added.`
                : 'No prompt-like or JSON fragment blocks were found in this payload.',
          ),
          ...state.importLog,
        ].slice(0, 12),
      }));

      return promptsToInsert.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown import error';

      set((state) => ({
        importLog: [
          createImportLogEntry(source, receivedAt, 0, 'error', message),
          ...state.importLog,
        ].slice(0, 12),
      }));

      throw error;
    }
  },
  resetDatabase: async () => {
    await clearPromptsDb();

    if (window.electronAPI) {
      await window.electronAPI.clearMetaState();
      await window.electronAPI.savePromptSnapshot([]);
    }

    set({
      prompts: [],
      tagRegistry: emptyMeta.tagRegistry,
      elementTagBindings: emptyMeta.elementTagBindings,
      keySequencePresets: emptyMeta.keySequencePresets,
      exportPresets: emptyMeta.exportPresets,
      selectedPromptId: null,
      importLog: [
        createImportLogEntry(
          'local-database',
          new Date().toISOString(),
          0,
          'success',
          'Cleared prompts and .prompt-db-meta state.',
        ),
      ],
    });
  },
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setTagRegistry: (tagRegistry) => set({ tagRegistry }),
  setElementTagBindings: (elementTagBindings) => set({ elementTagBindings }),
  setKeySequencePresets: (keySequencePresets) => set({ keySequencePresets }),
  setExportPresets: (exportPresets) => set({ exportPresets }),
}));
