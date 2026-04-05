# Prompt DB Local / Promt Bd Local

## English

Prompt DB Local is a local-first Electron + React workspace for collecting, cleaning, editing, and exporting prompt JSON data. It is designed for teams that receive noisy prompt payloads from browser tooling, curate them in a desktop database, and generate structured export batches for downstream pipelines.

### Core capabilities

- Import prompt-like JSON from local files or websocket events.
- Store prompts locally in IndexedDB through Dexie.
- Edit prompt records manually or through a visual Blockly editor.
- Build batch export presets in Blockly and save them inside the local database.
- Export prompt batches in several formats:
  - `full_bundle`
  - `prompt_cards`
  - `variable_catalog`
  - `keyword_matrix`
  - `runtime_bundle`
- Merge prompts by formula for quick composition workflows.

### Tech stack

- Electron
- React 19
- TypeScript
- Vite
- Dexie / IndexedDB
- Blockly
- Zustand

### Project structure

- `electron/` Electron main process and preload bridge
- `renderer/` React application
- `renderer/src/components/` UI panels and Blockly editors
- `renderer/src/db/` Dexie schema and normalization helpers
- `renderer/src/utils/` parsing, export, merge, and Blockly helpers
- `scripts/` development launch scripts

### Local development

```bash
npm install
npm run dev
```

### Production build

```bash
npm run build
npm start
```

### Batch Generator presets

The Batch Generator now includes a dedicated Blockly builder for export presets. Each preset can store:

- preset name
- file count
- item count
- selection mode
- text filter
- export format
- selected variable keys
- selected output fields

Presets are saved in the local Dexie database and can be reused without re-entering the configuration.

### Export formats

- `full_bundle`: full prompt records with source JSON and selected DB-driven fields
- `prompt_cards`: compact prompt review objects
- `variable_catalog`: groups prompts by variable keys
- `keyword_matrix`: groups prompts by keywords and related variable usage
- `runtime_bundle`: application-oriented payload with selected output fields and variable defaults

## Русский

Prompt DB Local это локальное Electron + React приложение для сбора, очистки, редактирования и экспорта prompt JSON-данных. Приложение подходит для сценария, где команда получает «шумные» JSON-пакеты из браузерных инструментов, сохраняет их в локальную БД и формирует структурированные batch-экспорты для дальнейших пайплайнов.

### Основные возможности

- Импорт prompt-подобного JSON из файлов и websocket-событий.
- Локальное хранение prompt-записей в IndexedDB через Dexie.
- Ручное редактирование и визуальное редактирование через Blockly.
- Визуальная сборка пресетов Batch Generator в Blockly с сохранением в локальной БД.
- Экспорт batch-наборов в нескольких форматах:
  - `full_bundle`
  - `prompt_cards`
  - `variable_catalog`
  - `keyword_matrix`
  - `runtime_bundle`
- Объединение prompt-записей по формуле для быстрых compositing-сценариев.

### Технологический стек

- Electron
- React 19
- TypeScript
- Vite
- Dexie / IndexedDB
- Blockly
- Zustand

### Структура проекта

- `electron/` главный процесс Electron и preload bridge
- `renderer/` React-приложение
- `renderer/src/components/` UI-панели и Blockly-редакторы
- `renderer/src/db/` схема Dexie и нормализация данных
- `renderer/src/utils/` парсинг, экспорт, merge-логика и Blockly-утилиты
- `scripts/` скрипты запуска для разработки

### Локальная разработка

```bash
npm install
npm run dev
```

### Сборка и запуск

```bash
npm run build
npm start
```

### Пресеты Batch Generator

Теперь Batch Generator включает отдельный Blockly-конструктор пресетов экспорта. В каждом пресете можно сохранить:

- имя пресета
- количество файлов
- количество элементов в файле
- режим выборки
- текстовый фильтр
- формат экспорта
- выбранные variable keys
- выбранные output fields

Пресеты сохраняются в локальной базе Dexie и могут повторно использоваться без ручной перенастройки.

### Форматы экспорта

- `full_bundle`: полный экспорт prompt-записей вместе с исходным JSON и выбранными полями из БД
- `prompt_cards`: компактные объекты для просмотра и ревью
- `variable_catalog`: группировка prompt-записей по переменным
- `keyword_matrix`: группировка по ключевым словам и связанным переменным
- `runtime_bundle`: прикладной формат с выбранными выходными полями и дефолтами переменных
