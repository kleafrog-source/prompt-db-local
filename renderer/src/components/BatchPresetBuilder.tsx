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

const serializeConfig = (value: BatchPresetConfig) => JSON.stringify(value);

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
  const cleanupRef = useRef<(() => void) | null>(null);
  const isApplyingXmlRef = useRef(false);
  const onConfigChangeRef = useRef(onConfigChange);
  const configRef = useRef(config);
  const promptsRef = useRef(prompts);
  const lastSyncedConfigRef = useRef(serializeConfig(config));
  const lastSyncedXmlRef = useRef(workspaceXml);
  const [jsonSnapshot, setJsonSnapshot] = useState(JSON.stringify(config, null, 2));
  const [status, setStatus] = useState('Preset workspace ready');

  useEffect(() => {
    onConfigChangeRef.current = onConfigChange;
  }, [onConfigChange]);

  useEffect(() => {
    configRef.current = config;
    setJsonSnapshot(JSON.stringify(config, null, 2));
  }, [config]);

  useEffect(() => {
    promptsRef.current = prompts;
  }, [prompts]);

  const loadXmlIntoWorkspace = (xmlText: string, nextConfig: BatchPresetConfig, nextStatus: string) => {
    const workspace = workspaceRef.current;

    if (!workspace) {
      return;
    }

    try {
      isApplyingXmlRef.current = true;
      workspace.clear();
      Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xmlText), workspace);
      Blockly.svgResize(workspace);
      setJsonSnapshot(JSON.stringify(nextConfig, null, 2));
      lastSyncedConfigRef.current = serializeConfig(nextConfig);
      lastSyncedXmlRef.current = xmlText;
      setStatus(nextStatus);
    } finally {
      isApplyingXmlRef.current = false;
    }
  };

  const syncFromWorkspace = () => {
    const workspace = workspaceRef.current;

    if (!workspace || isApplyingXmlRef.current) {
      return;
    }

    const nextConfig = workspaceToBatchPresetConfig(workspace, configRef.current);
    const nextXml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
    const serializedConfig = serializeConfig(nextConfig);

    setJsonSnapshot(JSON.stringify(nextConfig, null, 2));

    if (
      serializedConfig === lastSyncedConfigRef.current &&
      nextXml === lastSyncedXmlRef.current
    ) {
      return;
    }

    lastSyncedConfigRef.current = serializedConfig;
    lastSyncedXmlRef.current = nextXml;
    onConfigChangeRef.current(nextConfig, nextXml);
    setStatus('Batch preset synchronized');
  };

  const refreshToolboxFromDatabase = () => {
    const workspace = workspaceRef.current;

    if (!workspace) {
      return;
    }

    workspace.updateToolbox(createBatchBlocklyToolbox(promptsRef.current));
    Blockly.svgResize(workspace);
    setStatus('Blockly database options refreshed');
  };

  const applyCurrentConfigToBlockly = () => {
    const xmlText = workspaceXml || batchPresetToWorkspaceXml(configRef.current);
    loadXmlIntoWorkspace(xmlText, configRef.current, 'Applied current config to Blockly');
  };

  useLayoutEffect(() => {
    registerBatchBlocklyBlocks();

    const host = blocklyHostRef.current;
    const stage = blocklyStageRef.current;

    if (!host || !stage || workspaceRef.current) {
      return;
    }

    let disposed = false;

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
        toolbox: createBatchBlocklyToolbox(promptsRef.current),
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

      const handleWorkspaceChange = (event: Blockly.Events.Abstract) => {
        if (isApplyingXmlRef.current) {
          return;
        }

        if ('isUiEvent' in event && event.isUiEvent) {
          return;
        }

        if (
          event.type === Blockly.Events.FINISHED_LOADING ||
          event.type === Blockly.Events.TOOLBOX_ITEM_SELECT ||
          event.type === Blockly.Events.VIEWPORT_CHANGE ||
          event.type === Blockly.Events.CLICK
        ) {
          return;
        }

        syncFromWorkspace();
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
      workspace.addChangeListener(handleWorkspaceChange);
      window.addEventListener('resize', resize);
      resize();

      const initialXml = workspaceXml || batchPresetToWorkspaceXml(configRef.current);
      loadXmlIntoWorkspace(initialXml, configRef.current, 'Preset workspace ready');

      cleanupRef.current = () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', resize);
        workspace.removeChangeListener(handleWorkspaceChange);
        workspace.dispose();
        workspaceRef.current = null;
      };
    };

    window.requestAnimationFrame(mount);

    return () => {
      disposed = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!workspaceRef.current || (!selectedPresetId && !workspaceXml)) {
      return;
    }

    const nextConfig = configRef.current;
    const nextXml = workspaceXml || batchPresetToWorkspaceXml(nextConfig);
    loadXmlIntoWorkspace(
      nextXml,
      nextConfig,
      nextConfig.presetName ? `Loaded preset graph for "${nextConfig.presetName}"` : 'Preset graph loaded',
    );
  }, [selectedPresetId, workspaceXml]);

  const handleLoadJson = () => {
    try {
      const parsed = JSON.parse(jsonSnapshot) as BatchPresetConfig;
      const normalized: BatchPresetConfig = {
        ...configRef.current,
        ...parsed,
        variableKeys: Array.isArray(parsed.variableKeys) ? parsed.variableKeys : [],
        outputFields: Array.isArray(parsed.outputFields) ? parsed.outputFields : [],
      };
      const xmlText = batchPresetToWorkspaceXml(normalized);

      loadXmlIntoWorkspace(xmlText, normalized, 'Loaded JSON config into Batch Blockly');
      onConfigChangeRef.current(normalized, xmlText);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to parse preset JSON');
    }
  };

  const handleSavePreset = async () => {
    const workspace = workspaceRef.current;

    if (!workspace) {
      return;
    }

    const xmlText = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
    await onSavePreset(xmlText);
    setStatus(`Saved preset "${configRef.current.presetName}"`);
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
        Batch Blockly no longer auto-refreshes from every UI event. Use manual actions when you
        want to reload DB-driven options or apply the current form configuration into the canvas.
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
          <button type="button" className="secondary-button" onClick={applyCurrentConfigToBlockly}>
            Apply form to Blockly
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={refreshToolboxFromDatabase}
          >
            Refresh DB options
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
