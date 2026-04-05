import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import type { PromptDraft, PromptRecord } from '@/types/prompt';
import {
  createPromptBlocklyToolbox,
  promptJsonToWorkspaceXml,
  registerPromptBlocklyBlocks,
  setPromptBlocklyReferenceOptions,
  workspaceToPromptJson,
} from '@/utils/blocklyPrompt';
import { extractKeywords } from '@/utils/keywords';

type BlocklyEditorProps = {
  prompt: PromptRecord | null;
  prompts: PromptRecord[];
  onSave: (payload: PromptDraft) => Promise<unknown>;
};

const derivePromptDraftFromJson = (
  prompt: PromptRecord | null,
  json: Record<string, unknown>,
): PromptDraft => {
  const textCandidates = [
    json.prompt,
    json.template,
    json.text,
    json.system,
    json.content,
    json.instruction,
    json.message,
  ].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  const text = textCandidates.join('\n\n');
  const variablesValue = json.variables;
  const variables = Array.isArray(variablesValue)
    ? variablesValue
        .map((entry) => {
          if (typeof entry === 'string') return entry.trim();
          if (entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string') {
            return ((entry as { name: string }).name).trim();
          }
          return '';
        })
        .filter(Boolean)
    : variablesValue && typeof variablesValue === 'object'
      ? Object.keys(variablesValue as Record<string, unknown>)
      : [];
  const keywords = Array.isArray(json.keywords)
    ? json.keywords.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.toLowerCase())
    : extractKeywords(text);

  return {
    id: prompt?.id,
    name:
      (typeof json.name === 'string' && json.name.trim()) ||
      (typeof json.title === 'string' && json.title.trim()) ||
      prompt?.name ||
      'Imported prompt',
    text: text || prompt?.text || '',
    json_data: json,
    variables,
    keywords,
    source: prompt?.source,
  };
};

export const BlocklyEditor = ({ prompt, prompts, onSave }: BlocklyEditorProps) => {
  const blocklyHostRef = useRef<HTMLDivElement | null>(null);
  const blocklyStageRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const baseJsonRef = useRef<Record<string, unknown>>({});
  const isApplyingXmlRef = useRef(false);
  const [jsonSnapshot, setJsonSnapshot] = useState('{}');
  const [editorStatus, setEditorStatus] = useState('Ready');

  useEffect(() => {
    setPromptBlocklyReferenceOptions(prompts);
  }, [prompts]);

  useLayoutEffect(() => {
    registerPromptBlocklyBlocks();

    const host = blocklyHostRef.current;
    const stage = blocklyStageRef.current;

    if (!host || !stage || workspaceRef.current) {
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | undefined;
    let attempts = 0;

    const mountWhenReady = () => {
      if (disposed || workspaceRef.current) {
        return;
      }

      const rect = host.getBoundingClientRect();

      if (rect.width < 40 || rect.height < 40) {
        attempts += 1;

        if (attempts < 30) {
          window.requestAnimationFrame(mountWhenReady);
        } else {
          setEditorStatus(`Blockly container size is ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }

        return;
      }

      try {
        const workspace = Blockly.inject(host, {
          toolbox: createPromptBlocklyToolbox(prompts),
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
            maxScale: 1.8,
            minScale: 0.45,
            scaleSpeed: 1.15,
          },
        });

        workspaceRef.current = workspace;

        const syncFromWorkspace = () => {
          if (isApplyingXmlRef.current) {
            return;
          }

          const nextJson = workspaceToPromptJson(workspace, baseJsonRef.current, prompts);
          setJsonSnapshot(JSON.stringify(nextJson, null, 2));
          setEditorStatus('Workspace synchronized');
        };

        const resizeWorkspace = () => {
          window.requestAnimationFrame(() => {
            if (!workspaceRef.current) {
              return;
            }

            Blockly.svgResize(workspace);
          });
        };

        const resizeObserver = new ResizeObserver(() => {
          resizeWorkspace();
        });

        resizeObserver.observe(stage);
        resizeObserver.observe(host);
        workspace.addChangeListener(syncFromWorkspace);
        window.addEventListener('resize', resizeWorkspace);
        resizeWorkspace();
        setEditorStatus(`Blockly workspace mounted (${Math.round(rect.width)}x${Math.round(rect.height)})`);

        cleanup = () => {
          resizeObserver.disconnect();
          window.removeEventListener('resize', resizeWorkspace);
          workspace.removeChangeListener(syncFromWorkspace);
          workspace.dispose();
          workspaceRef.current = null;
        };
      } catch (error) {
        setEditorStatus(error instanceof Error ? error.message : 'Failed to mount Blockly');
      }
    };

    window.requestAnimationFrame(mountWhenReady);

    return () => {
      disposed = true;
      cleanup?.();
    }
  }, [prompts]);

  useEffect(() => {
    const workspace = workspaceRef.current;

    if (!workspace) {
      return;
    }

    workspace.updateToolbox(createPromptBlocklyToolbox(prompts));
    Blockly.svgResize(workspace);
  }, [prompts]);

  useEffect(() => {
    const workspace = workspaceRef.current;

    if (!workspace) {
      return;
    }

    const nextJson = (prompt?.json_data ?? {}) as Record<string, unknown>;
    baseJsonRef.current = nextJson;

    const xmlText = promptJsonToWorkspaceXml(nextJson);

    try {
      isApplyingXmlRef.current = true;
      workspace.clear();
      Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xmlText), workspace);
      Blockly.svgResize(workspace);
      setJsonSnapshot(JSON.stringify(nextJson, null, 2));
      setEditorStatus(prompt ? `Loaded "${prompt.name}" into Blockly` : 'Workspace reset');
    } finally {
      isApplyingXmlRef.current = false;
    }
  }, [prompt]);

  const handleLoadJsonIntoWorkspace = () => {
    const workspace = workspaceRef.current;

    if (!workspace) {
      return;
    }

    try {
      const parsed = JSON.parse(jsonSnapshot) as Record<string, unknown>;
      baseJsonRef.current = parsed;
      const xmlText = promptJsonToWorkspaceXml(parsed);

      isApplyingXmlRef.current = true;
      workspace.clear();
      Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xmlText), workspace);
      Blockly.svgResize(workspace);
      setEditorStatus('Loaded JSON snapshot into Blockly');
    } catch (error) {
      setEditorStatus(error instanceof Error ? error.message : 'Failed to parse JSON snapshot');
    } finally {
      isApplyingXmlRef.current = false;
    }
  };

  const handleSaveBlocklyResult = async () => {
    try {
      const parsed = JSON.parse(jsonSnapshot) as Record<string, unknown>;
      const draft = derivePromptDraftFromJson(prompt, parsed);
      await onSave(draft);
      setEditorStatus(`Saved "${draft.name}" from Blockly`);
    } catch (error) {
      setEditorStatus(error instanceof Error ? error.message : 'Failed to save Blockly result');
    }
  };

  return (
    <section className="panel blockly-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Blockly</p>
          <h2>Visual Prompt Editor</h2>
        </div>
        <span className="badge">{editorStatus}</span>
      </div>

      <p className="panel-copy">
        The workspace is live. It loads the selected prompt JSON into custom blocks and generates a
        synchronized JSON snapshot back from the block graph.
      </p>

      <div className="blockly-shell">
        <div ref={blocklyStageRef} className="blockly-stage">
          <div ref={blocklyHostRef} className="blockly-canvas" />
        </div>

        <label className="field field-full">
          <span>Generated prompt JSON</span>
          <textarea
            value={jsonSnapshot}
            onChange={(event) => setJsonSnapshot(event.target.value)}
            rows={14}
          />
        </label>

        <div className="button-row">
          <button type="button" className="secondary-button" onClick={handleLoadJsonIntoWorkspace}>
            Load JSON into Blockly
          </button>
          <button type="button" className="primary-button" onClick={() => void handleSaveBlocklyResult()}>
            Save Blockly changes
          </button>
        </div>
      </div>
    </section>
  );
};
