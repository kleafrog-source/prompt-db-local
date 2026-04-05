import { create } from 'zustand';
import type { BatchPresetDraft, BatchPresetRecord } from '@/types/batchPreset';
import {
  clearPromptsDb,
  normalizeBatchPresetDraft,
  normalizePromptDraft,
  promptsDb,
} from '@/db/promptsDb';
import type { PromptDraft, PromptRecord, PromptSearchFilters } from '@/types/prompt';
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
};

type PromptStore = {
  prompts: PromptRecord[];
  batchPresets: BatchPresetRecord[];
  selectedPromptId: string | null;
  filters: PromptSearchFilters;
  wsStatus: WsState;
  importLog: ImportLogEntry[];
  loadPrompts: () => Promise<void>;
  loadBatchPresets: () => Promise<void>;
  setSelectedPrompt: (promptId: string | null) => void;
  setFilters: (filters: Partial<PromptSearchFilters>) => void;
  savePrompt: (draft: PromptDraft) => Promise<PromptRecord>;
  saveBatchPreset: (draft: BatchPresetDraft) => Promise<BatchPresetRecord>;
  deleteBatchPreset: (presetId: string) => Promise<void>;
  deletePrompt: (promptId: string) => Promise<void>;
  importRawJson: (rawJson: string, source: string) => Promise<number>;
  resetDatabase: () => Promise<void>;
  setWsStatus: (status: WsState) => void;
};

export const usePromptStore = create<PromptStore>((set, get) => ({
  prompts: [],
  batchPresets: [],
  selectedPromptId: null,
  filters: {
    query: '',
  },
  wsStatus: {
    port: 3001,
    state: 'stopped',
  },
  importLog: [],
  loadPrompts: async () => {
    const prompts = await promptsDb.prompts.orderBy('updated_at').reverse().toArray();

    set((state) => ({
      prompts,
      selectedPromptId:
        state.selectedPromptId && prompts.some((prompt) => prompt.id === state.selectedPromptId)
          ? state.selectedPromptId
          : prompts[0]?.id ?? null,
    }));
  },
  loadBatchPresets: async () => {
    const batchPresets = await promptsDb.batchPresets.orderBy('updated_at').reverse().toArray();

    set({
      batchPresets,
    });
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
  saveBatchPreset: async (draft) => {
    const batchPreset = normalizeBatchPresetDraft(draft);

    await promptsDb.batchPresets.put(batchPreset);
    await get().loadBatchPresets();
    return batchPreset;
  },
  deleteBatchPreset: async (presetId) => {
    await promptsDb.batchPresets.delete(presetId);
    await get().loadBatchPresets();
  },
  deletePrompt: async (promptId) => {
    await promptsDb.prompts.delete(promptId);
    await get().loadPrompts();
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
    set({
      prompts: [],
      batchPresets: [],
      selectedPromptId: null,
      importLog: [
        createImportLogEntry(
          'local-database',
          new Date().toISOString(),
          0,
          'success',
          'Cleared all prompts from the current local database.',
        ),
      ],
    });
  },
  setWsStatus: (wsStatus) => set({ wsStatus }),
}));
