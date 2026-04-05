import { describe, expect, it } from 'vitest';
import { parseJsonToPrompts } from '@/utils/parser';

describe('parseJsonToPrompts', () => {
  it('finds nested prompt-like blocks and keeps variables', () => {
    const rawJson = JSON.stringify({
      session: {
        steps: [
          {
            name: 'system intro',
            system: 'Speak to {{audience}} with a {{tone}} tone.',
            variables: ['audience', 'tone'],
          },
          {
            nested: {
              title: 'template card',
              template: 'Summarize {{topic}} in 3 bullets.',
              keywords: ['summary', 'topic'],
            },
          },
        ],
      },
    });

    const prompts = parseJsonToPrompts(rawJson, { source: 'test-import' });

    expect(prompts).toHaveLength(2);
    expect(prompts[0]?.variables).toEqual(['audience', 'tone']);
    expect(prompts[1]?.name).toBe('template card');
    expect(prompts[1]?.keywords).toContain('summary');
    expect(prompts[1]?.source).toBe('test-import');
  });

  it('falls back to importing a plain json object when no prompt keys exist', () => {
    const rawJson = JSON.stringify({
      data: {
        id: 42,
        title: 'not a prompt',
      },
    });

    const prompts = parseJsonToPrompts(rawJson);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.name).toBe('data');
    expect(prompts[0]?.text).toContain('not a prompt');
  });

  it('extracts prompt blocks from mixed text with invalid top-level json', () => {
    const rawText = `
      Session export start
      {"meta":{"session":"abc"}}
      some human note between blocks
      {
        "name": "messy prompt",
        "template": "Create a brief for {{client}} in {{language}}.",
        "variables": [{"name":"client"}, {"name":"language"}]
      }
      trailing commentary that breaks JSON.parse
      {"prompt":"Final cinematic shot with mist and warm backlight","keywords":["cinematic","mist"]}
    `;

    const prompts = parseJsonToPrompts(rawText, { source: 'mixed-doc' });

    expect(prompts).toHaveLength(3);
    expect(prompts[1]?.name).toBe('messy prompt');
    expect(prompts[1]?.variables).toEqual(['client', 'language']);
    expect(prompts[2]?.text).toContain('Final cinematic shot');
    expect(prompts[2]?.keywords).toContain('cinematic');
  });

  it('accepts fuzzy prompt field names like content and instruction', () => {
    const rawJson = JSON.stringify({
      flow: {
        name: 'producer import',
        content: 'Describe the product benefit for {{audience}}.',
        instruction: 'Keep the tone credible and concise.',
      },
    });

    const prompts = parseJsonToPrompts(rawJson);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.text).toContain('Describe the product benefit');
    expect(prompts[0]?.text).toContain('Keep the tone credible');
    expect(prompts[0]?.variables).toContain('audience');
  });

  it('imports plain json fragments even without prompt-specific keys', () => {
    const rawText = `
      Block 17: Quaternion geometry
      {
        "macro_name": "MLGS_QUATERNION_GEOMETRIC_UNITY_v3.0",
        "engine_type": "4D_Vector_Spatializer",
        "processing_rules": {
          "phase_coherence": "Maintain > 0.95 during 4D translations",
          "spatial_fractal": "Recursive delay lines at Golden Ratio intervals"
        }
      }
    `;

    const prompts = parseJsonToPrompts(rawText, { source: 'mixed-doc' });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.name).toBe('MLGS_QUATERNION_GEOMETRIC_UNITY_v3.0');
    expect(prompts[0]?.text).toContain('4D_Vector_Spatializer');
    expect(prompts[0]?.text).toContain('phase_coherence');
  });
});
