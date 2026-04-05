import { useEffect, useMemo, useState } from 'react';
import { BatchPresetBuilder } from '@/components/BatchPresetBuilder';
import type { BatchPresetConfig } from '@/types/batchPreset';
import type { PromptRecord } from '@/types/prompt';
import { usePromptStore } from '@/store/promptStore';
import {
  EXPORT_FORMATS,
  EXPORT_MODES,
  createBatchExportPayload,
  createDefaultBatchPresetConfig,
  formatBatchFormula,
  parseBatchFormula,
  selectPromptIdsByMode,
  type ExportMode,
} from '@/utils/exportPrompts';

type ExportPanelProps = {
  prompts: PromptRecord[];
};

const sanitizeFileName = (value: string) =>
  value
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'prompt_export';

const createConfigFromFormula = (
  formula: string,
  mode: ExportMode,
  current: BatchPresetConfig,
): BatchPresetConfig => {
  const parsed = parseBatchFormula(formula, mode);

  return {
    ...current,
    files: parsed.files,
    items: parsed.items,
    mode: parsed.mode,
  };
};

export const ExportPanel = ({ prompts }: ExportPanelProps) => {
  const batchPresets = usePromptStore((state) => state.batchPresets);
  const saveBatchPreset = usePromptStore((state) => state.saveBatchPreset);
  const deleteBatchPreset = usePromptStore((state) => state.deleteBatchPreset);
  const [config, setConfig] = useState<BatchPresetConfig>(createDefaultBatchPresetConfig);
  const [formula, setFormula] = useState('3x12 random');
  const [mode, setMode] = useState<ExportMode>('random');
  const [status, setStatus] = useState('Ready for batch export');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [blocklyXml, setBlocklyXml] = useState('');

  useEffect(() => {
    setFormula(formatBatchFormula(config.files, config.items, config.mode));
    setMode(config.mode);
  }, [config.files, config.items, config.mode]);

  const scopedPrompts = useMemo(() => {
    const normalizedQuery = config.query.trim().toLowerCase();

    if (!normalizedQuery) {
      return prompts;
    }

    return prompts.filter((prompt) => {
      const haystack = [
        prompt.name,
        prompt.text,
        prompt.keywords.join(' '),
        prompt.variables.join(' '),
      ]
        .join('\n')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [config.query, prompts]);

  const previewPayload = useMemo(() => {
    const ids = selectPromptIdsByMode(scopedPrompts, config.mode, config.items);

    return createBatchExportPayload(
      scopedPrompts,
      ids,
      config.mode,
      1,
      config.exportFormat,
      config.variableKeys,
      config.outputFields,
    );
  }, [config, scopedPrompts]);

  const activeFormat = EXPORT_FORMATS.find((entry) => entry.key === config.exportFormat);

  const handleConfigChange = (nextConfig: BatchPresetConfig, nextBlocklyXml: string) => {
    setConfig(nextConfig);
    setBlocklyXml(nextBlocklyXml);
    setSelectedPresetId(null);
  };

  const handleApplyFormula = (nextFormula: string, nextMode: ExportMode) => {
    setFormula(nextFormula);
    setMode(nextMode);
    setConfig((current) => createConfigFromFormula(nextFormula, nextMode, current));
  };

  const handleSelectPreset = (presetId: string | null) => {
    setSelectedPresetId(presetId);

    if (!presetId) {
      setStatus('Switched to unsaved workspace');
      return;
    }

    const preset = batchPresets.find((entry) => entry.id === presetId);

    if (!preset) {
      return;
    }

    setConfig({
      presetName: preset.presetName,
      files: preset.files,
      items: preset.items,
      mode: preset.mode,
      query: preset.query,
      exportFormat: preset.exportFormat,
      variableKeys: preset.variableKeys,
      outputFields: preset.outputFields,
    });
    setBlocklyXml(preset.blocklyXml);
    setStatus(`Loaded preset "${preset.presetName}"`);
  };

  const handleSavePreset = async (nextBlocklyXml: string) => {
    const saved = await saveBatchPreset({
      id: selectedPresetId ?? undefined,
      ...config,
      blocklyXml: nextBlocklyXml || blocklyXml,
    });

    setSelectedPresetId(saved.id);
    setBlocklyXml(saved.blocklyXml);
    setStatus(`Preset "${saved.presetName}" saved`);
  };

  const handleDeletePreset = async (presetId: string) => {
    const preset = batchPresets.find((entry) => entry.id === presetId);
    await deleteBatchPreset(presetId);
    setSelectedPresetId(null);
    setStatus(preset ? `Deleted preset "${preset.presetName}"` : 'Preset deleted');
  };

  const handleExportSingle = async () => {
    if (!window.electronAPI) {
      setStatus('Electron bridge is unavailable');
      return;
    }

    const payload = JSON.stringify(previewPayload, null, 2);
    const fileName = `prompt_export__${config.exportFormat}__${config.mode}__${previewPayload.itemCount}.json`;
    const result = await window.electronAPI.saveExportFile({
      defaultFileName: sanitizeFileName(fileName),
      content: payload,
    });

    if (!result) {
      setStatus('Single export cancelled');
      return;
    }

    setStatus(`Saved export file to ${result.filePath}`);
  };

  const handleExportBatch = async () => {
    if (!window.electronAPI) {
      setStatus('Electron bridge is unavailable');
      return;
    }

    const files = Array.from({ length: config.files }, (_value, index) => {
      const ids = selectPromptIdsByMode(scopedPrompts, config.mode, config.items);
      const payload = createBatchExportPayload(
        scopedPrompts,
        ids,
        config.mode,
        index + 1,
        config.exportFormat,
        config.variableKeys,
        config.outputFields,
      );

      return {
        fileName: sanitizeFileName(
          `batch_${String(index + 1).padStart(2, '0')}__${config.exportFormat}__${config.mode}__${payload.itemCount}.json`,
        ),
        content: JSON.stringify(payload, null, 2),
      };
    });

    const result = await window.electronAPI.exportBatchFiles({
      defaultFolderName: sanitizeFileName(
        `prompt_batch_${config.files}x${config.items}_${config.exportFormat}_${config.mode}_${Date.now()}`,
      ),
      files,
    });

    if (!result) {
      setStatus('Batch export cancelled');
      return;
    }

    setStatus(`Exported ${result.count} file(s) to ${result.directoryPath}`);
  };

  return (
    <>
      <BatchPresetBuilder
        prompts={prompts}
        config={config}
        workspaceXml={blocklyXml}
        presets={batchPresets}
        selectedPresetId={selectedPresetId}
        onConfigChange={handleConfigChange}
        onSelectPreset={handleSelectPreset}
        onSavePreset={handleSavePreset}
        onDeletePreset={handleDeletePreset}
      />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Export</p>
            <h2>Batch Generator</h2>
          </div>
          <span className="badge">{status}</span>
        </div>

        <p className="panel-copy">
          Build Electron-native export batches from the current database. Blockly presets control
          the active batch formula, export format, filter scope, variable-key selection, and output
          fields.
        </p>

        <div className="editor-grid">
          <label className="field">
            <span>Batch formula</span>
            <input
              value={formula}
              onChange={(event) => handleApplyFormula(event.target.value, mode)}
            />
          </label>

          <label className="field">
            <span>Selection mode</span>
            <select
              value={mode}
              onChange={(event) => handleApplyFormula(formula, event.target.value as ExportMode)}
            >
              {EXPORT_MODES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          <label className="field field-full">
            <span>Preset name</span>
            <input
              value={config.presetName}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  presetName: event.target.value,
                }))
              }
            />
          </label>

          <label className="field field-full">
            <span>Optional filter by name, text, keyword, or variable</span>
            <input
              value={config.query}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  query: event.target.value,
                }))
              }
              placeholder="cinematic, hook, system, persona..."
            />
          </label>

          <label className="field">
            <span>Export format</span>
            <select
              value={config.exportFormat}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  exportFormat: event.target.value as BatchPresetConfig['exportFormat'],
                }))
              }
            >
              {EXPORT_FORMATS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Variable keys included in export</span>
            <input
              value={config.variableKeys.join(', ')}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  variableKeys: event.target.value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                }))
              }
              placeholder="subject, style, audience"
            />
          </label>

          <label className="field field-full">
            <span>Output fields included in export</span>
            <input
              value={config.outputFields.join(', ')}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  outputFields: event.target.value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                }))
              }
              placeholder="name, text, keywords, json_data.meta.category"
            />
          </label>
        </div>

        <div className="button-row">
          <button type="button" className="secondary-button" onClick={() => void handleExportSingle()}>
            Save preview JSON
          </button>
          <button type="button" className="primary-button" onClick={() => void handleExportBatch()}>
            Export batch folder
          </button>
        </div>

        <div className="export-stats">
          <span>{scopedPrompts.length} prompts in current export scope</span>
          <span>{config.files} file(s)</span>
          <span>{config.items} JSON item(s) per file</span>
          <span>{previewPayload.itemCount} item(s) in preview</span>
          <span>{activeFormat?.label ?? config.exportFormat}</span>
        </div>

        <p className="panel-copy compact-copy">
          {activeFormat?.description ?? 'Custom export format selected.'}
        </p>

        <label className="field field-full">
          <span>Preview payload</span>
          <textarea value={JSON.stringify(previewPayload, null, 2)} readOnly rows={16} />
        </label>
      </section>
    </>
  );
};
