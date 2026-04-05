import { useEffect, useState } from 'react';
import type { PromptRecord } from '@/types/prompt';

type PromptEditorProps = {
  prompt: PromptRecord | null;
  onSave: (payload: {
    id?: string;
    name: string;
    text: string;
    json_data: Record<string, unknown>;
    variables: string[];
    keywords: string[];
    source?: string;
  }) => Promise<void>;
  onDelete: (promptId: string) => Promise<void>;
};

export const PromptEditor = ({ prompt, onSave, onDelete }: PromptEditorProps) => {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [jsonText, setJsonText] = useState('{}');
  const [variables, setVariables] = useState('');
  const [keywords, setKeywords] = useState('');

  useEffect(() => {
    if (!prompt) {
      setName('');
      setText('');
      setJsonText('{}');
      setVariables('');
      setKeywords('');
      return;
    }

    setName(prompt.name);
    setText(prompt.text);
    setJsonText(JSON.stringify(prompt.json_data, null, 2));
    setVariables(prompt.variables.join(', '));
    setKeywords(prompt.keywords.join(', '));
  }, [prompt]);

  const handleSave = async () => {
    const parsedJson = JSON.parse(jsonText) as Record<string, unknown>;

    await onSave({
      id: prompt?.id,
      name,
      text,
      json_data: parsedJson,
      variables: variables
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      keywords: keywords
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
      source: prompt?.source,
    });
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Editor</p>
          <h2>Prompt Detail</h2>
        </div>
      </div>

      <div className="editor-grid">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        <label className="field">
          <span>Variables</span>
          <input
            value={variables}
            onChange={(event) => setVariables(event.target.value)}
            placeholder="topic, tone, audience"
          />
        </label>

        <label className="field field-full">
          <span>Text</span>
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} />
        </label>

        <label className="field">
          <span>Keywords</span>
          <input value={keywords} onChange={(event) => setKeywords(event.target.value)} />
        </label>

        <label className="field field-full">
          <span>JSON payload</span>
          <textarea
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
            rows={14}
          />
        </label>
      </div>

      <div className="button-row">
        <button type="button" className="primary-button" onClick={() => void handleSave()}>
          Save prompt
        </button>
        {prompt ? (
          <button type="button" className="secondary-button" onClick={() => void onDelete(prompt.id)}>
            Delete
          </button>
        ) : null}
      </div>
    </section>
  );
};
