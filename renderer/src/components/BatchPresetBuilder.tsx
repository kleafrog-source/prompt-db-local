import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import type { BatchPresetConfig, BatchPresetRecord } from '@/types/batchPreset';
import type { PromptRecord } from '@/types/prompt';
import {
  batchPresetToWorkspaceXml,
  createBatchBlocklyToolbox,
  registerBatchBlocklyBlocks,
  workspaceToBatchPresetConfig,
} from '@/utils/batchBlockly';

type BatchPresetBuilderProps = {
  prompts: PromptRecord[];
  config: BatchPresetConfig;
  workspaceXml: string;
  presets: BatchPresetRecord[];
  selectedPresetId: string | null;
  onConfigChange: (config: BatchPresetConfig, blocklyXml: string) => void;
  onSelectPreset: (presetId: string | null) => void;
  onSavePreset: (blocklyXml: string) => Promise<void>;
  onDeletePreset: (presetId: string) => Promise<void>;
};

export const BatchPresetBuilder = ({
  prompts,
  config,
  workspaceXml,
  presets,
  selectedPresetId,
  onConfigChange,
  onSelectPreset,
  onSavePreset,
  onDeletePreset,
}: BatchPresetBuilderProps) => {
  const blocklyHostRef = useRef<HTMLDivElement | null>(null);
  const blocklyStageRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const isApplyingXmlRef = useRef(false);
  const [jsonSnapshot, setJsonSnapshot] = useState(JSON.stringify(config, null, 2));
  const [status, setStatus] = useState('Preset workspace ready');

  useLayoutEffect(() => {
    registerBatchBlocklyBlocks();

    const host = blocklyHostRef.current;
    const stage = blocklyStageRef.current;

    if (!host || !stage || workspaceRef.current) {
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | undefined;

    const mount = () => {
      if (disposed || workspaceRef.current) {
        return;
      }

      const rect = host.getBoundingClientRect();

      if (rect.width < 40 || rect.height < 40) {
        window.requestAnimationFrame(mount);
        return;
      }

      const workspace = Blockly.inject(host, {
        toolbox: createBatchBlocklyToolbox(prompts),
        trashcan: true,
        renderer: 'geras',
        move: {
          wheel: true,
          drag: true,
        },
        zoom: {
          controls: true,
          wheel: true,
          startScale: 0.9,
          maxScale: 1.7,
          minScale: 0.45,
          scaleSpeed: 1.14,
        },
      });

      workspaceRef.current = workspace;

      const sync = () => {
        if (isApplyingXmlRef.current) {
          return;
        }

        const nextConfig = workspaceToBatchPresetConfig(workspace, config);
        const xmlText = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));

        setJsonSnapshot(JSON.stringify(nextConfig, null, 2));
        onConfigChange(nextConfig, xmlText);
        setStatus('Batch preset synchronized');
      };

      const resize = () => {
        window.requestAnimationFrame(() => {
          if (workspaceRef.current) {
            Blockly.svgResize(workspace);
          }
        });
      };

      const resizeObserver = new ResizeObserver(() => {
        resize();
      });

      resizeObserver.observe(stage);
      resizeObserver.observe(host);
      workspace.addChangeListener(sync);
      window.addEventListener('resize', resize);
      resize();

      cleanup = () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', resize);
        workspace.removeChangeListener(sync);
        workspace.dispose();
        workspaceRef.current = null;
      };
    };

    window.requestAnimationFrame(mount);

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [config, onConfigChange, prompts]);

  useEffect(() => {
    const workspace = workspaceRef.current;

    if (!workspace) {
      return;
    }

    workspace.updateToolbox(createBatchBlocklyToolbox(prompts));
    Blockly.svgResize(workspace);
  }, [prompts]);

  useEffect(() => {
    const workspace = workspaceRef.current;

    if (!workspace) {
      setJsonSnapshot(JSON.stringify(config, null, 2));
      return;
    }

    const xmlText = workspaceXml || batchPresetToWorkspaceXml(config);

    try {
      isApplyingXmlRef.current = true;
      workspace.clear();
      Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xmlText), workspace);
      Blockly.svgResize(workspace);
      setJsonSnapshot(JSON.stringify(config, null, 2));
      setStatus(config.presetName ? `Loaded preset graph for "${config.presetName}"` : 'Preset graph loaded');
    } finally {
      isApplyingXmlRef.current = false;
    }
  }, [config, workspaceXml]);

  const handleLoadJson = () => {
    const workspace = workspaceRef.current;

    if (!workspace) {
      return;
    }

    try {
      const parsed = JSON.parse(jsonSnapshot) as BatchPresetConfig;
      const normalized: BatchPresetConfig = {
        ...config,
        ...parsed,
        variableKeys: Array.isArray(parsed.variableKeys) ? parsed.variableKeys : [],
        outputFields: Array.isArray(parsed.outputFields) ? parsed.outputFields : [],
      };
      const xmlText = batchPresetToWorkspaceXml(normalized);

      isApplyingXmlRef.current = true;
      workspace.clear();
      Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xmlText), workspace);
      Blockly.svgResize(workspace);
      onConfigChange(normalized, xmlText);
      setStatus('Loaded JSON config into Batch Blockly');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to parse preset JSON');
    } finally {
      isApplyingXmlRef.current = false;
    }
  };

  const handleSavePreset = async () => {
    const workspace = workspaceRef.current;

    if (!workspace) {
      return;
    }

    const xmlText = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
    await onSavePreset(xmlText);
    setStatus(`Saved preset "${config.presetName}"`);
  };

  return (
    <section className="panel blockly-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Blockly</p>
          <h2>Batch Preset Builder</h2>
        </div>
        <span className="badge">{status}</span>
      </div>

      <p className="panel-copy">
        Build export presets visually. The workspace stays synchronized with the current batch
        settings, variable keys, and output fields discovered in the local prompt database.
      </p>

      <div className="editor-grid">
        <label className="field">
          <span>Saved presets</span>
          <select
            value={selectedPresetId ?? ''}
            onChange={(event) => onSelectPreset(event.target.value || null)}
          >
            <option value="">Unsaved workspace</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.presetName}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Current preset name</span>
          <input value={config.presetName} readOnly />
        </label>
      </div>

      <div className="blockly-shell">
        <div ref={blocklyStageRef} className="blockly-stage blockly-stage-compact">
          <div ref={blocklyHostRef} className="blockly-canvas" />
        </div>

        <label className="field field-full">
          <span>Preset JSON snapshot</span>
          <textarea
            value={jsonSnapshot}
            onChange={(event) => setJsonSnapshot(event.target.value)}
            rows={12}
          />
        </label>

        <div className="button-row">
          <button type="button" className="secondary-button" onClick={handleLoadJson}>
            Load JSON into Batch Blockly
          </button>
          <button type="button" className="secondary-button" onClick={() => void handleSavePreset()}>
            Save preset
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void (selectedPresetId ? onDeletePreset(selectedPresetId) : Promise.resolve())}
            disabled={!selectedPresetId}
          >
            Delete preset
          </button>
        </div>
      </div>
    </section>
  );
};
