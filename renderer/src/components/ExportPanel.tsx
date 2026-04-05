import { useMemo, useState } from 'react';
import type { DBElement, ElementTagBinding, ExportPreset, KeySequencePreset, TagRegistry } from '@/types/meta';
import type { PromptRecord } from '@/types/prompt';
import { generateExport, parseCompositionPattern } from '@/utils/exportComposer';
import { createTagId } from '@/utils/tagScanner';

type ExportPanelProps = {
  prompts: PromptRecord[];
  tagRegistry: TagRegistry;
  bindings: ElementTagBinding[];
  sequencePresets: KeySequencePreset[];
  exportPresets: ExportPreset[];
  onPersistPresets: (presets: ExportPreset[]) => Promise<void>;
};

const sanitizeFileName = (value: string) =>
  value
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120) || 'prompt_export';

const createDefaultPreset = (): ExportPreset => ({
  id: 'default_export',
  label: 'Default Export',
  filters: {
    includeTags: [],
    excludeTags: [],
    includeKeys: [],
    excludeKeys: [],
  },
  composition: {
    mode: 'as-is',
    pattern: '3x12 random',
  },
  slicing: {
    useKeySequences: [],
    maxBlocksPerElement: 4,
  },
  output: {
    fileNamePattern: '{index}_{id}.json',
    format: 'json',
  },
});

const toElements = (prompts: PromptRecord[], bindings: ElementTagBinding[]): DBElement[] => {
  const bindingsMap = new Map(bindings.map((binding) => [binding.elementId, binding.tags]));

  return prompts.map((prompt) => ({
    id: prompt.id,
    raw: prompt.json_data,
    tagIds: bindingsMap.get(prompt.id) ?? [],
  }));
};

const splitCsv = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export const ExportPanel = ({
  prompts,
  tagRegistry,
  bindings,
  sequencePresets,
  exportPresets,
  onPersistPresets,
}: ExportPanelProps) => {
  const [draft, setDraft] = useState<ExportPreset>(createDefaultPreset);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [previewJson, setPreviewJson] = useState('');
  const [status, setStatus] = useState('Export presets ready');

  const elements = useMemo(() => toElements(prompts, bindings), [prompts, bindings]);
  const patternInfo = parseCompositionPattern(draft.composition?.pattern);

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);

    if (!presetId) {
      setDraft(createDefaultPreset());
      setStatus('Switched to unsaved export preset');
      return;
    }

    const preset = exportPresets.find((entry) => entry.id === presetId);

    if (!preset) {
      return;
    }

    setDraft(preset);
    setStatus(`Loaded export preset "${preset.label}"`);
  };

  const handleSavePreset = async () => {
    const nextPreset = {
      ...draft,
      id: draft.id || createTagId(draft.label || `export_${exportPresets.length + 1}`),
    };

    await onPersistPresets(
      [...exportPresets.filter((preset) => preset.id !== nextPreset.id), nextPreset].sort((left, right) =>
        left.label.localeCompare(right.label),
      ),
    );
    setDraft(nextPreset);
    setSelectedPresetId(nextPreset.id);
    setStatus(`Saved export preset "${nextPreset.label}"`);
  };

  const handleDeletePreset = async () => {
    if (!selectedPresetId) {
      return;
    }

    const preset = exportPresets.find((entry) => entry.id === selectedPresetId);
    await onPersistPresets(exportPresets.filter((entry) => entry.id !== selectedPresetId));
    setSelectedPresetId('');
    setDraft(createDefaultPreset());
    setStatus(preset ? `Deleted export preset "${preset.label}"` : 'Deleted export preset');
  };

  const handleUpdatePreview = async () => {
    const files = await generateExport(elements, draft, tagRegistry, sequencePresets);
    setPreviewJson(JSON.stringify(files[0]?.content ?? {}, null, 2));
    setStatus(`Preview updated for ${files.length} file(s)`);
  };

  const handleExport = async () => {
    if (!window.electronAPI) {
      setStatus('Electron bridge is unavailable');
      return;
    }

    const files = await generateExport(elements, draft, tagRegistry, sequencePresets);
    const result = await window.electronAPI.exportBatchFiles({
      defaultFolderName: sanitizeFileName(
        `${draft.label}_${draft.composition?.mode || 'as_is'}_${Date.now()}`,
      ),
      files: files.map((file) => ({
        fileName: sanitizeFileName(file.fileName),
        content: JSON.stringify(file.content, null, 2),
      })),
    });

    if (!result) {
      setStatus('Export cancelled');
      return;
    }

    setStatus(`Exported ${result.count} generated file(s) to ${result.directoryPath}`);
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Composer</p>
          <h2>Export Presets</h2>
        </div>
        <span className="badge">{status}</span>
      </div>

      <p className="panel-copy">
        Build exports from tags, keys, and saved sequence presets. This panel replaces the old
        visual batch generator with a tag/sequence-driven flow.
      </p>

      <div className="editor-grid">
        <label className="field">
          <span>Saved preset</span>
          <select value={selectedPresetId} onChange={(event) => handleSelectPreset(event.target.value)}>
            <option value="">Unsaved preset</option>
            {exportPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Preset label</span>
          <input
            value={draft.label}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                label: event.target.value,
                id: current.id || createTagId(event.target.value),
              }))
            }
          />
        </label>

        <label className="field field-full">
          <span>Description</span>
          <textarea
            value={draft.description ?? ''}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            rows={3}
          />
        </label>

        <label className="field">
          <span>Composition mode</span>
          <select
            value={draft.composition?.mode ?? 'as-is'}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                composition: {
                  ...current.composition,
                  mode: event.target.value as NonNullable<ExportPreset['composition']>['mode'],
                },
              }))
            }
          >
            <option value="as-is">as-is</option>
            <option value="random-mix">random-mix</option>
            <option value="sequence-based">sequence-based</option>
          </select>
        </label>

        <label className="field">
          <span>Pattern</span>
          <input
            value={draft.composition?.pattern ?? ''}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                composition: {
                  mode: current.composition?.mode ?? 'as-is',
                  pattern: event.target.value,
                },
              }))
            }
            placeholder="6x12 random"
          />
        </label>

        <label className="field">
          <span>Include tags</span>
          <input
            value={(draft.filters?.includeTags ?? []).join(', ')}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                filters: {
                  ...current.filters,
                  includeTags: splitCsv(event.target.value),
                },
              }))
            }
            placeholder={tagRegistry.tags.slice(0, 4).map((tag) => tag.id).join(', ')}
          />
        </label>

        <label className="field">
          <span>Exclude tags</span>
          <input
            value={(draft.filters?.excludeTags ?? []).join(', ')}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                filters: {
                  ...current.filters,
                  excludeTags: splitCsv(event.target.value),
                },
              }))
            }
          />
        </label>

        <label className="field">
          <span>Include keys</span>
          <input
            value={(draft.filters?.includeKeys ?? []).join(', ')}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                filters: {
                  ...current.filters,
                  includeKeys: splitCsv(event.target.value),
                },
              }))
            }
          />
        </label>

        <label className="field">
          <span>Exclude keys</span>
          <input
            value={(draft.filters?.excludeKeys ?? []).join(', ')}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                filters: {
                  ...current.filters,
                  excludeKeys: splitCsv(event.target.value),
                },
              }))
            }
          />
        </label>

        <label className="field">
          <span>Max blocks per element</span>
          <input
            type="number"
            min={1}
            value={draft.slicing?.maxBlocksPerElement ?? 4}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                slicing: {
                  ...current.slicing,
                  maxBlocksPerElement: Math.max(1, Number(event.target.value) || 1),
                },
              }))
            }
          />
        </label>

        <label className="field">
          <span>File name pattern</span>
          <input
            value={draft.output?.fileNamePattern ?? '{index}_{id}.json'}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                output: {
                  fileNamePattern: event.target.value,
                  format: 'json',
                },
              }))
            }
          />
        </label>

        <label className="field field-full">
          <span>Sequence presets used for sequence-based mode</span>
          <div className="check-grid">
            {sequencePresets.map((preset) => {
              const checked = draft.slicing?.useKeySequences?.includes(preset.id) ?? false;

              return (
                <label key={preset.id} className="check-card">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setDraft((current) => {
                        const currentIds = new Set(current.slicing?.useKeySequences ?? []);

                        if (currentIds.has(preset.id)) {
                          currentIds.delete(preset.id);
                        } else {
                          currentIds.add(preset.id);
                        }

                        return {
                          ...current,
                          slicing: {
                            ...current.slicing,
                            useKeySequences: [...currentIds],
                          },
                        };
                      })
                    }
                  />
                  <span>{preset.name}</span>
                </label>
              );
            })}
          </div>
        </label>
      </div>

      <div className="button-row">
        <button type="button" className="secondary-button" onClick={() => void handleSavePreset()}>
          Save preset
        </button>
        <button type="button" className="secondary-button" onClick={() => void handleDeletePreset()} disabled={!selectedPresetId}>
          Delete preset
        </button>
        <button type="button" className="secondary-button" onClick={() => void handleUpdatePreview()}>
          Update preview
        </button>
        <button type="button" className="primary-button" onClick={() => void handleExport()}>
          Export generated files
        </button>
      </div>

      <div className="export-stats">
        <span>{elements.length} DB elements available</span>
        <span>{patternInfo.files} file(s)</span>
        <span>{patternInfo.items} item(s) per file</span>
        <span>{draft.composition?.mode ?? 'as-is'}</span>
      </div>

      <label className="field field-full">
        <span>Preview payload</span>
        <textarea
          value={previewJson || 'Preview is not generated yet. Click "Update preview".'}
          readOnly
          rows={16}
        />
      </label>
    </section>
  );
};
