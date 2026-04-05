import type { PromptRecord } from '@/types/prompt';

type PromptListProps = {
  prompts: PromptRecord[];
  selectedPromptId: string | null;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelectPrompt: (promptId: string) => void;
};

export const PromptList = ({
  prompts,
  selectedPromptId,
  searchQuery,
  onSearchChange,
  onSelectPrompt,
}: PromptListProps) => (
  <section className="panel">
    <div className="panel-heading">
      <div>
        <p className="eyebrow">Prompt Index</p>
        <h2>Library</h2>
      </div>
      <span className="badge">{prompts.length}</span>
    </div>

    <label className="field">
      <span>Search</span>
      <input
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="keyword, title, variable"
      />
    </label>

    <div className="prompt-list">
      {prompts.map((prompt) => (
        <button
          type="button"
          key={prompt.id}
          className={prompt.id === selectedPromptId ? 'prompt-card is-active' : 'prompt-card'}
          onClick={() => onSelectPrompt(prompt.id)}
        >
          <strong>{prompt.name}</strong>
          <span>{prompt.text.slice(0, 120) || 'No text yet'}</span>
          <small>{prompt.keywords.slice(0, 4).join(' • ')}</small>
        </button>
      ))}

      {prompts.length === 0 ? (
        <div className="empty-state">
          <strong>No prompts yet</strong>
          <span>Import a JSON file or send a payload from the Chrome extension.</span>
        </div>
      ) : null}
    </div>
  </section>
);
