// Φ_total(sessions:ui) — панель управления Producer AI сессиями
// Отображает сессии по аккаунтам, предложения от Mistral, позволяет применять их

import React, { useEffect, useState, useCallback } from 'react';
import {
  useSessionManager,
  type ProducerSession,
  type AutobatchConfig,
} from '@/services/SessionStateManager';
import { applyPhiTotal } from '@/services/MistralService';

interface SessionPanelProps {
  onApplySuggestion?: (suggestion: string, sessionId: string) => void;
  onExportSession?: (session: ProducerSession) => void;
}

export const SessionPanel: React.FC<SessionPanelProps> = ({
  onApplySuggestion,
  onExportSession,
}) => {
  const manager = useSessionManager();
  const [sessions, setSessions] = useState<ProducerSession[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [selectedSession, setSelectedSession] = useState<ProducerSession | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{
    summary: string;
    suggestions: string[];
    tokens?: { prompt: number; completion: number; total: number };
  } | null>(null);

  // Подписка на изменения
  useEffect(() => {
    setSessions(manager.getAllSessions());
    return manager.subscribe((newSessions) => {
      setSessions(newSessions);
    });
  }, [manager]);

  // Получаем уникальные аккаунты
  const accounts = React.useMemo(() => {
    const accountMap = new Map<string, string>();
    sessions.forEach((s) => {
      accountMap.set(s.accountId, s.accountName);
    });
    return Array.from(accountMap.entries()).map(([id, name]) => ({ id, name }));
  }, [sessions]);

  // Фильтруем сессии
  const filteredSessions = React.useMemo(() => {
    if (selectedAccount === 'all') return sessions;
    return sessions.filter((s) => s.accountId === selectedAccount);
  }, [sessions, selectedAccount]);

  // Анализ через Mistral
  const analyzeSession = useCallback(
    async (session: ProducerSession) => {
      setIsAnalyzing(true);
      setSelectedSession(session);

      const context = manager.getSessionContext(session.id);
      if (!context) {
        setIsAnalyzing(false);
        return;
      }

      const response = await applyPhiTotal(
        'producer-session-analysis',
        `Session: ${session.name}\nMessages: ${context.totalMessages}\nRecent:\n${context.recentContext}`,
        'mistral-large-latest'
      );

      if (response.ok && response.data) {
        const content = response.data.choices[0]?.message?.content || '';
        
        // Парсим ответ (предполагаем структуру с Summary и Next Steps)
        const lines = content.split('\n');
        const summaryLines: string[] = [];
        const suggestionLines: string[] = [];
        let inSuggestions = false;

        lines.forEach((line) => {
          if (line.toLowerCase().includes('next step') || line.toLowerCase().includes('suggestion')) {
            inSuggestions = true;
          } else if (inSuggestions && line.trim().startsWith('-')) {
            suggestionLines.push(line.trim().slice(1).trim());
          } else if (!inSuggestions && line.trim()) {
            summaryLines.push(line.trim());
          }
        });

        const summary = summaryLines.join('\n') || content.slice(0, 500);
        const suggestions = suggestionLines.length > 0 ? suggestionLines : [content.slice(0, 200)];

        manager.updateSessionAnalysis(session.id, summary, suggestions);

        setAnalysisResult({
          summary,
          suggestions,
          tokens: response.data.usage ? {
            prompt: response.data.usage.prompt_tokens,
            completion: response.data.usage.completion_tokens,
            total: response.data.usage.total_tokens,
          } : undefined,
        });
      }

      setIsAnalyzing(false);
    },
    [manager]
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Φ_total Sessions</h2>
        <select
          style={styles.select}
          value={selectedAccount}
          onChange={(e) => setSelectedAccount(e.target.value)}
        >
          <option value="all">All Accounts</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name} ({acc.id.slice(0, 8)}...)
            </option>
          ))}
        </select>
      </div>

      <div style={styles.content}>
        {/* Список сессий */}
        <div style={styles.sessionList}>
          {filteredSessions.length === 0 ? (
            <div style={styles.empty}>No sessions yet</div>
          ) : (
            filteredSessions.map((session) => (
              <div
                key={session.id}
                style={{
                  ...styles.sessionCard,
                  ...(selectedSession?.id === session.id ? styles.sessionCardActive : {}),
                }}
                onClick={() => setSelectedSession(session)}
              >
                <div style={styles.sessionHeader}>
                  <span style={styles.sessionName}>{session.name}</span>
                  <span style={styles.messageCount}>{session.messages.length} msgs</span>
                </div>
                <div style={styles.sessionMeta}>
                  <span>{session.accountName}</span>
                  <span>{new Date(session.updatedAt).toLocaleTimeString()}</span>
                </div>
                {session.summary && (
                  <div style={styles.sessionSummary}>{session.summary.slice(0, 100)}...</div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Детали сессии */}
        <div style={styles.sessionDetail}>
          {selectedSession ? (
            <>
              <div style={styles.detailHeader}>
                <h3>{selectedSession.name}</h3>
                <div style={styles.detailActions}>
                  <button
                    style={styles.button}
                    onClick={() => analyzeSession(selectedSession)}
                    disabled={isAnalyzing}
                  >
                    {isAnalyzing ? 'Φ_total(analyzing)...' : 'Φ_total(analyze)'}
                  </button>
                  {onExportSession && (
                    <button
                      style={styles.buttonSecondary}
                      onClick={() => onExportSession(selectedSession)}
                    >
                      Export
                    </button>
                  )}
                </div>
              </div>

              <div style={styles.messagesList}>
                <h4>Messages</h4>
                {selectedSession.messages.map((msg, idx) => (
                  <div key={msg.id} style={styles.message}>
                    <div style={styles.messageHeader}>
                      <span>#{idx + 1}</span>
                      <span style={styles.complexity}>
                        complexity: {(msg.metadata.complexity * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div style={styles.messageContent}>{msg.content.slice(0, 200)}...</div>
                    <div style={styles.messageMeta}>
                      keywords: {msg.metadata.keywords.join(', ')}
                    </div>
                  </div>
                ))}
              </div>

              {/* Результат анализа */}
              {analysisResult && selectedSession.id === selectedSession.id && (
                <div style={styles.analysisResult}>
                  <h4>Φ_total Analysis</h4>
                  <div style={styles.summary}>{analysisResult.summary}</div>
                  <h5>Suggested Next Steps:</h5>
                  <ul style={styles.suggestions}>
                    {analysisResult.suggestions.map((suggestion, idx) => (
                      <li key={idx} style={styles.suggestionItem}>
                        {suggestion}
                        {onApplySuggestion && (
                          <button
                            style={styles.applyButton}
                            onClick={() => onApplySuggestion(suggestion, selectedSession.id)}
                          >
                            Apply
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {analysisResult.tokens && (
                    <div style={styles.tokens}>
                      tokens: {analysisResult.tokens.total} 
                      (prompt: {analysisResult.tokens.prompt}, 
                       completion: {analysisResult.tokens.completion})
                    </div>
                  )}
                </div>
              )}

              {/* Сохранённые предложения сессии */}
              {selectedSession.suggestedNextSteps && !analysisResult && (
                <div style={styles.savedSuggestions}>
                  <h4>Previous Suggestions</h4>
                  <ul>
                    {selectedSession.suggestedNextSteps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div style={styles.emptyDetail}>Select a session to view details</div>
          )}
        </div>
      </div>
    </div>
  );
};

// Autobatch Configuration Panel
export const AutobatchConfigPanel: React.FC = () => {
  const manager = useSessionManager();
  const [configs, setConfigs] = useState<AutobatchConfig[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AutobatchConfig | null>(null);

  useEffect(() => {
    setConfigs(manager.getAutobatchConfigs());
  }, [manager]);

  const saveConfig = (config: AutobatchConfig) => {
    manager.saveAutobatchConfig(config);
    setConfigs(manager.getAutobatchConfigs());
    setIsEditing(false);
    setEditingConfig(null);
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Φ_total Autobatch Settings</h2>
      
      <div style={styles.configList}>
        {configs.length === 0 ? (
          <div style={styles.empty}>No autobatch configs yet</div>
        ) : (
          configs.map((config) => (
            <div key={config.id} style={styles.configCard}>
              <div style={styles.configHeader}>
                <span style={styles.configName}>{config.patternName}</span>
                <span style={config.enabled ? styles.enabled : styles.disabled}>
                  {config.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
              <div style={styles.configMeta}>
                Account: {config.accountId === 'all' ? 'All' : config.accountId.slice(0, 8)}
              </div>
              <div style={styles.configTriggers}>
                Triggers: {Object.entries(config.triggerConditions)
                  .filter(([_, v]) => v !== undefined)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')}
              </div>
              <div style={styles.configActions}>
                <button
                  onClick={() => {
                    setEditingConfig(config);
                    setIsEditing(true);
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    manager.deleteAutobatchConfig(config.id);
                    setConfigs(manager.getAutobatchConfigs());
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <button
        style={styles.createButton}
        onClick={() => {
          setEditingConfig({
            id: `${Date.now()}`,
            accountId: 'all',
            patternName: 'New Pattern',
            enabled: true,
            triggerConditions: { messageCount: 5 },
            mistralPrompt: 'Analyze this session and suggest next steps',
            autoApplySuggestions: false,
            maxSuggestions: 3,
          });
          setIsEditing(true);
        }}
      >
        + Create Autobatch Pattern
      </button>

      {isEditing && editingConfig && (
        <AutobatchEditor
          config={editingConfig}
          onSave={saveConfig}
          onCancel={() => {
            setIsEditing(false);
            setEditingConfig(null);
          }}
        />
      )}
    </div>
  );
};

// Autobatch Editor Component
const AutobatchEditor: React.FC<{
  config: AutobatchConfig;
  onSave: (config: AutobatchConfig) => void;
  onCancel: () => void;
}> = ({ config, onSave, onCancel }) => {
  const [draft, setDraft] = useState<AutobatchConfig>(config);

  return (
    <div style={styles.editorOverlay}>
      <div style={styles.editor}>
        <h3>Edit Autobatch Pattern</h3>
        
        <label>
          Pattern Name:
          <input
            type="text"
            value={draft.patternName}
            onChange={(e) => setDraft({ ...draft, patternName: e.target.value })}
          />
        </label>

        <label>
          Account:
          <select
            value={draft.accountId}
            onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}
          >
            <option value="all">All Accounts</option>
            {/* Здесь можно добавить реальные аккаунты */}
          </select>
        </label>

        <label>
          Trigger: Message Count
          <input
            type="number"
            value={draft.triggerConditions.messageCount || ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                triggerConditions: {
                  ...draft.triggerConditions,
                  messageCount: parseInt(e.target.value) || undefined,
                },
              })
            }
          />
        </label>

        <label>
          Min Complexity (0-1):
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={draft.triggerConditions.minComplexity || ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                triggerConditions: {
                  ...draft.triggerConditions,
                  minComplexity: parseFloat(e.target.value) || undefined,
                },
              })
            }
          />
        </label>

        <label>
          Mistral Prompt:
          <textarea
            rows={4}
            value={draft.mistralPrompt}
            onChange={(e) => setDraft({ ...draft, mistralPrompt: e.target.value })}
          />
        </label>

        <label>
          <input
            type="checkbox"
            checked={draft.autoApplySuggestions}
            onChange={(e) =>
              setDraft({ ...draft, autoApplySuggestions: e.target.checked })
            }
          />
          Auto-apply suggestions
        </label>

        <label>
          Max Suggestions:
          <input
            type="number"
            min="1"
            max="10"
            value={draft.maxSuggestions}
            onChange={(e) =>
              setDraft({ ...draft, maxSuggestions: parseInt(e.target.value) || 3 })
            }
          />
        </label>

        <div style={styles.editorActions}>
          <button onClick={() => onSave(draft)}>Save</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

// Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '20px',
    background: '#1a1a2e',
    color: '#eee',
    borderRadius: '8px',
    minHeight: '400px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  title: {
    margin: 0,
    color: '#00d4aa',
  },
  select: {
    padding: '8px 12px',
    background: '#2a2a4e',
    color: '#eee',
    border: '1px solid #00d4aa',
    borderRadius: '4px',
  },
  content: {
    display: 'flex',
    gap: '20px',
    height: '500px',
  },
  sessionList: {
    flex: '0 0 300px',
    overflowY: 'auto',
    borderRight: '1px solid #333',
    paddingRight: '10px',
  },
  sessionDetail: {
    flex: 1,
    overflowY: 'auto',
    paddingLeft: '10px',
  },
  sessionCard: {
    padding: '12px',
    marginBottom: '10px',
    background: '#2a2a4e',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  sessionCardActive: {
    background: '#3a3a6e',
    border: '1px solid #00d4aa',
  },
  sessionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '6px',
  },
  sessionName: {
    fontWeight: 'bold',
    color: '#fff',
  },
  messageCount: {
    fontSize: '0.85em',
    color: '#888',
  },
  sessionMeta: {
    fontSize: '0.8em',
    color: '#888',
    display: 'flex',
    gap: '10px',
  },
  sessionSummary: {
    marginTop: '8px',
    fontSize: '0.85em',
    color: '#aaa',
    fontStyle: 'italic',
  },
  empty: {
    textAlign: 'center',
    color: '#666',
    padding: '40px',
  },
  emptyDetail: {
    textAlign: 'center',
    color: '#666',
    padding: '100px 40px',
  },
  detailHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  detailActions: {
    display: 'flex',
    gap: '10px',
  },
  button: {
    padding: '8px 16px',
    background: '#00d4aa',
    color: '#1a1a2e',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  buttonSecondary: {
    padding: '8px 16px',
    background: 'transparent',
    color: '#00d4aa',
    border: '1px solid #00d4aa',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  messagesList: {
    marginTop: '20px',
  },
  message: {
    padding: '12px',
    marginBottom: '10px',
    background: '#2a2a4e',
    borderRadius: '4px',
  },
  messageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px',
    fontSize: '0.85em',
    color: '#888',
  },
  complexity: {
    color: '#00d4aa',
  },
  messageContent: {
    color: '#ddd',
    marginBottom: '8px',
  },
  messageMeta: {
    fontSize: '0.8em',
    color: '#666',
  },
  analysisResult: {
    marginTop: '20px',
    padding: '16px',
    background: '#2a2a4e',
    borderRadius: '8px',
    border: '1px solid #00d4aa',
  },
  summary: {
    marginBottom: '16px',
    lineHeight: '1.6',
  },
  suggestions: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  suggestionItem: {
    padding: '8px',
    marginBottom: '8px',
    background: '#1a1a2e',
    borderRadius: '4px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  applyButton: {
    padding: '4px 12px',
    background: '#00d4aa',
    color: '#1a1a2e',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.85em',
  },
  tokens: {
    marginTop: '12px',
    fontSize: '0.8em',
    color: '#666',
  },
  savedSuggestions: {
    marginTop: '20px',
    padding: '12px',
    background: '#2a2a4e',
    borderRadius: '4px',
  },
  configList: {
    marginBottom: '20px',
  },
  configCard: {
    padding: '12px',
    marginBottom: '10px',
    background: '#2a2a4e',
    borderRadius: '6px',
  },
  configHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  configName: {
    fontWeight: 'bold',
  },
  enabled: {
    color: '#00d4aa',
    fontSize: '0.8em',
  },
  disabled: {
    color: '#666',
    fontSize: '0.8em',
  },
  configMeta: {
    fontSize: '0.85em',
    color: '#888',
    marginTop: '4px',
  },
  configTriggers: {
    fontSize: '0.8em',
    color: '#666',
    marginTop: '4px',
  },
  configActions: {
    marginTop: '10px',
    display: 'flex',
    gap: '8px',
  },
  createButton: {
    width: '100%',
    padding: '12px',
    background: '#00d4aa',
    color: '#1a1a2e',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  editorOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  editor: {
    background: '#1a1a2e',
    padding: '24px',
    borderRadius: '8px',
    width: '500px',
    maxHeight: '80vh',
    overflowY: 'auto',
  },
  editorActions: {
    marginTop: '20px',
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
  },
};
