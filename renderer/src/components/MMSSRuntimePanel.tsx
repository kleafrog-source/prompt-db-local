import React, { useState } from 'react';
import { MMSSRuntimeService } from '../utils/MMSSRuntimeService';
import { MMSSBuilderConfig, MMSSRuntimeResult, MMSSJobStatus, MMSSDomain } from '../types/mmss';

export const MMSSRuntimePanel: React.FC<{
  onImportGenerated: (blocks: any[], intent: string) => Promise<void>;
}> = ({ onImportGenerated }) => {
  const [status, setStatus] = useState<MMSSJobStatus>('idle');
  const [output, setOutput] = useState<string>('');
  const [result, setResult] = useState<MMSSRuntimeResult | null>(null);
  
  const [config, setConfig] = useState<MMSSBuilderConfig>({
    intent: 'industrial hypnotic techno',
    domains: ['Rhythm', 'Timbre', 'Space', 'Logic'],
    layers: [1, 2, 3],
    max_blocks: 10,
    temperature: 0.55,
    runs: 8,
    allow_mutation: true,
    allow_crossover: true
  });

  const runTask = async (taskName: string, taskFn: () => Promise<any>) => {
    setStatus('running');
    setOutput(`Running ${taskName}...`);
    try {
      const res = await taskFn();
      setOutput(res.output || (res.ok ? 'Success' : 'Error'));
      if (res.ok) {
        setStatus('success');
        if (res.data) setResult(res.data);
      } else {
        setStatus('error');
      }
    } catch (err: any) {
      setStatus('error');
      setOutput(err.message);
    }
  };

  const handleRunBuilder = () => runTask('Builder V3', () => MMSSRuntimeService.runBuilderV3(config));

  return (
    <div className="panel mmss-v3-panel">
      <header className="panel-header">
        <h2 className="panel-title">MMSS Runtime V3</h2>
        <div className={`status-badge status-${status}`}>{status.toUpperCase()}</div>
      </header>

      <div className="panel-content grid-2">
        <div className="tool-section">
          <h3>Build Tools</h3>
          <div className="button-group-vertical">
            <button onClick={() => runTask('Transform', MMSSRuntimeService.runTransform)}>Rebuild Blocks</button>
            <button onClick={() => runTask('Indexer', MMSSRuntimeService.runIndexerV3)}>Rebuild Index</button>
            <button onClick={() => runTask('Embeddings', MMSSRuntimeService.runEmbeddings)}>Build Embeddings</button>
            <button onClick={() => runTask('Graph', MMSSRuntimeService.runGraphV3)}>Build Graph</button>
            <button onClick={() => runTask('Mutation', MMSSRuntimeService.runMutation)}>Generate Mutations</button>
            <button onClick={() => runTask('Crossover', MMSSRuntimeService.runCrossover)}>Generate Crossovers</button>
            <button onClick={() => runTask('Self Rules', MMSSRuntimeService.runSelfRules)}>Generate Self Rules</button>
          </div>
        </div>

        <div className="config-section">
          <h3>Builder Configuration</h3>
          <div className="form-group">
            <label>Intent</label>
            <input 
              type="text" 
              value={config.intent} 
              onChange={e => setConfig({...config, intent: e.target.value})}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Max Blocks</label>
              <input 
                type="number" 
                value={config.max_blocks} 
                onChange={e => setConfig({...config, max_blocks: parseInt(e.target.value)})}
              />
            </div>
            <div className="form-group">
              <label>Temperature</label>
              <input 
                type="number" step="0.1"
                value={config.temperature} 
                onChange={e => setConfig({...config, temperature: parseFloat(e.target.value)})}
              />
            </div>
          </div>
          <button className="btn-primary" onClick={handleRunBuilder}>Run MMSS V3 Builder</button>
        </div>
      </div>

      {output && (
        <div className="output-console">
          <pre>{output}</pre>
        </div>
      )}

      {result && (
        <div className="result-preview">
          <h3>Generation Result</h3>
          <div className="result-meta">
            <span>Blocks: {result.meta.block_count}</span>
            <span>Score: {result.meta.run_score}</span>
            <span className={result.meta.validation.valid ? 'text-success' : 'text-error'}>
              {result.meta.validation.valid ? '✓ Valid' : '✗ Invalid'}
            </span>
          </div>
          <button 
            className="btn-secondary"
            onClick={() => onImportGenerated(result.blocks, result.meta.intent)}
          >
            Import to Prompt Database
          </button>
        </div>
      )}
    </div>
  );
};
