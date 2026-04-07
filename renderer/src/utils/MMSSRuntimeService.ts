import { MMSSBuilderConfig, MMSSJobResult } from '../types/mmss';

declare global {
  interface Window {
    electronAPI: {
      mmssRunTask: (payload: { script: string; args: string[] }) => Promise<MMSSJobResult>;
    };
  }
}

export const MMSSRuntimeService = {
  async runTransform(): Promise<MMSSJobResult> {
    return window.electronAPI.mmssRunTask({
      script: 'transform_blocks.py',
      args: []
    });
  },

  async runIndexerV3(): Promise<MMSSJobResult> {
    return window.electronAPI.mmssRunTask({
      script: 'system/indexer_v3.py',
      args: []
    });
  },

  async runEmbeddings(): Promise<MMSSJobResult> {
    return window.electronAPI.mmssRunTask({
      script: 'system/embedding_builder.py',
      args: []
    });
  },

  async runGraphV3(): Promise<MMSSJobResult> {
    return window.electronAPI.mmssRunTask({
      script: 'system/graph_builder_v3.py',
      args: []
    });
  },

  async runMutation(): Promise<MMSSJobResult> {
    return window.electronAPI.mmssRunTask({
      script: 'system/mutation_engine.py',
      args: []
    });
  },

  async runCrossover(): Promise<MMSSJobResult> {
    return window.electronAPI.mmssRunTask({
      script: 'system/crossover_engine.py',
      args: []
    });
  },

  async runSelfRules(): Promise<MMSSJobResult> {
    return window.electronAPI.mmssRunTask({
      script: 'system/self_rule_engine.py',
      args: []
    });
  },

  async runBuilderV3(config: MMSSBuilderConfig): Promise<MMSSJobResult> {
    const args = [
      '--intent', config.intent,
      '--domains', config.domains.join(','),
      '--layers', config.layers.join(','),
      '--max_blocks', config.max_blocks.toString(),
      '--temperature', config.temperature.toString(),
      '--runs', config.runs.toString()
    ];

    return window.electronAPI.mmssRunTask({
      script: 'system/builder_v3.py',
      args
    });
  }
};
