export type DBElementId = string;

export type DBElement = {
  id: DBElementId;
  raw: unknown;
  tagIds?: string[];
};

export type Tag = {
  id: string;
  label: string;
  color: string;
  type: 'key' | 'value' | 'semantic';
};

export type TagRegistry = {
  tags: Tag[];
};

export type KeyPath = string;

// Φ_total(rule_types) — типы для rule-engine mode
export type RuleLogic = 'must_include_layers' | 'min_domains' | 'conditional_requirement';

export type Rule = {
  name: string;
  logic: RuleLogic;
  value?: number[] | number;
  if?: Record<string, unknown>;
  then?: Record<string, unknown>;
};

export type RuleSet = {
  composition_rules: Rule[];
};

export type KeySequence = {
  id: string;
  pathChain: KeyPath[];
  usageCount: number;
};

export type KeySequencePreset = {
  id: string;
  name: string;
  description?: string;
  sequences: KeySequence[];
  generationRules?: {
    mode: 'random' | 'weighted' | 'sequential';
    maxBlocks?: number;
    allowRepetition?: boolean;
  };
};

export type ElementTagBinding = {
  elementId: DBElementId;
  tags: string[];
};

export type ExportPreset = {
  id: string;
  label: string;
  description?: string;
  filters?: {
    includeTags?: string[];
    excludeTags?: string[];
    includeKeys?: string[];
    excludeKeys?: string[];
  };
  /**
   * =============================================================================
   * COMPOSITION MODE IMPLEMENTATION ROADMAP
   * =============================================================================
   * 
   * Current Status (из meta.ts:55-68):
   * Реализовано добавление новых режимов композиции в систему builder_v3.py
   * 
   * IMPLEMENTED MODES:
   * - 'as-is' | 'random-mix' | 'sequence-based' | 'mmss-v3' - базовые режимы
   * 
   * PLANNED MODES (в порядке приоритета):
   * 1. 'rule-engine' - Генерация на основе правил композиции
   *    - Python: system/rule_engine.py
   *    - UI: ExportPanel.tsx компонент выбора правил
   *    - Интеграция: MMSSRuntimeService.ts bridge
   * 
   * 2. 'self-rule-engine' - Самоэволюция правил генерации
   *    - Python: system/self_rule_engine.py
   *    - Алгоритм: алгоритмы создают сами себя
   *    - Логика: MMSS (Mutation | Model | Semantic | Strategy)
   * 
   * 3. 'mutation-engine' - Генерация через мутации блоков
   *    - Python: system/mutation_engine.py (уже существует)
   *    - Интеграция: добавить как composition mode
   * 
   * 4. 'mmss-v4' - Расширенная версия с графом связей
   *    - Улучшенный семантический поиск
   *    - Cross-domain relationships
   * 
   * 5. 'F-Final' - Финальная версия алгоритма
   *    - Объединение всех предыдущих режимов
   *    - Self-evolving meta-algorithm
   * 
   * IMPLEMENTATION PLAN:
   * 
   * Phase 1: Rule Engine Integration
   * - [ ] Добавить mode: 'rule-engine' в тип composition.mode
   * - [ ] Реализовать handleRuleEngineMode в exportComposer.ts
   * - [ ] Добавить UI компонент RuleSelector в ExportPanel
   * - [ ] Интеграция с system/rule_engine.py через MMSSRuntimeService
   * - [ ] Тестирование с существующими блоками
   * 
   * Phase 2: Self-Rule Evolution
   * - [ ] Добавить mode: 'self-rule-engine'
   * - [ ] Реализовать систему памяти успешных правил
   * - [ ] Алгоритм мутации правил (rule mutation)
   * - [ ] Интеграция с system/self_rule_engine.py
   * - [ ] Feedback loop: результаты → новые правила
   * 
   * Phase 3: Full Mutation Engine
   * - [ ] Интеграция system/mutation_engine.py как composition mode
   * - [ ] Параметризация mutation rate из UI
   * - [ ] Crossover + Mutation pipeline
   * 
   * Phase 4: MMSS-V4 & F-Final
   * - [ ] Граф связей между блоками
   * - [ ] Multi-modal semantic search
   * - [ ] Ensemble methods
   * - [ ] Meta-learning layer
   * 
   * SYNCHRONIZATION ARCHITECTURE:
   * 
   * ┌─────────────────────────────────────────────────────────────────┐
   * │                    ТРЁХУРОВНЕВАЯ СИНХРОНИЗАЦИЯ                   │
   * ├─────────────────────────────────────────────────────────────────┤
   * │                                                                 │
   * │  LAYER 1: UI (React)                                            │
   *  │  - ExportPanel.tsx: выбор mode, настройка параметров          │
   *  │  - TagKeyExplorer.tsx: теги для фильтрации                    │
   *  │  - MMSSRuntimePanel.tsx: Python bridge                        │
   *  │                    ↓ IPC (Electron)                             │
   *  │  LAYER 2: Main Process (Node.js)                               │
   *  │  - main.ts: mmss:run-task handler                              │
   *  │  - metaStore.ts: сохранение реестров                          │
   *  │                    ↓ spawn                                     │
   *  │  LAYER 3: Python Processing                                   │
   *  │  - builder_v3.py: основной builder с mode routing            │
   *  │  - rule_engine.py: валидация и генерация по правилам          │
   *  │  - self_rule_engine.py: эволюция правил                        │
   *  │  - mutation_engine.py: генетические операции                   │
   *  │                                                                 │
   *  └─────────────────────────────────────────────────────────────────┘
   * 
   * DATABASE SYNC STRATEGY:
   * 
   * 1. UI Layer → Main Process:
   *    - ExportPreset сохраняется через meta:save-state
   *    - TagRegistry синхронизируется с element bindings
   * 
   * 2. Main Process → Python:
   *    - JSON payload через spawn python
   *    - Args: mode, config, block_index_path
   * 
   * 3. Python → Main Process:
   *    - stdout: JSON result
   *    - stderr: логи и ошибки
   *    - generated_blocks/ для новых блоков
   * 
   * 4. Python ↔ Database:
   *    - Чтение: database/blocks/, database/system/
   *    - Запись: database/system/generated_blocks/
   *    - Индексация: block_index_v3.json
   * 
   * MMSS LOGIC (Алгоритмы создают сами себя):
   * 
   * Описание процесса (из meta.ts:68):
   * "Алгоритмы создают сами себя и выявляют лучшие варианты 
   *  на основе логики MMSS - Mutation | Model | Semantic | Strategy"
   * 
   * Суть:
   * - Mutation: создаём вариации существующих алгоритмов
   * - Model: оцениваем результаты по модели качества
   * - Semantic: учитываем семантическое соответствие intent
   * - Strategy: развиваем стратегии отбора и комбинирования
   * 
   * Это не точка, а процесс:
   * Поколение 1 → Оценка → Отбор → Мутация → Поколение 2 → ...
   * 
   * =============================================================================
   */
  composition?: {
    mode: 'as-is' | 'random-mix' | 'sequence-based' | 'mmss-v3' | 'rule-engine' | 'self-rule-engine' | 'mutation-engine' | 'mmss-v4' | 'F-Final' | 'Φ_total';
    pattern?: string;
    rules?: RuleSet; // Для rule-engine и self-rule-engine modes
  };
  slicing?: {
    useKeySequences?: string[];
    maxBlocksPerElement?: number;
  };
  output?: {
    fileNamePattern: string;
    format: 'json';
  };
};

export type PromptDbMetaState = {
  tagRegistry: TagRegistry;
  elementTagBindings: ElementTagBinding[];
  keySequencePresets: KeySequencePreset[];
  exportPresets: ExportPreset[];
};

export type FrequencyEntry = {
  value: string;
  count: number;
};

export const createEmptyMetaState = (): PromptDbMetaState => ({
  tagRegistry: {
    tags: [],
  },
  elementTagBindings: [],
  keySequencePresets: [],
  exportPresets: [],
});
