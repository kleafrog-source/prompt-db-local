# Prompt DB Local / Promt Bd Local

## English

Prompt DB Local is a local-first Electron + React application for importing large mixed JSON payloads, storing prompt-like blocks locally, scanning them for reusable tags and key chains, and generating new export files from saved presets.

### Core capabilities

- Import prompt-like JSON from files or from the Chrome extension over `ws://127.0.0.1:3001`.
- Store imported prompt records in IndexedDB through Dexie.
- Persist service metadata in `.prompt-db-meta/` JSON files through Electron:
  - `tag-registry.json`
  - `element-tag-bindings.json`
  - `key-sequence-presets.json`
  - `export-presets.json`
- Scan the DB for:
  - frequent keys
  - normalized short values
  - reusable nested key sequences
- Curate a global tag registry and apply tags back to DB elements.
- Save sequence presets and export presets.
- Generate exports in three modes:
  - `as-is`
  - `random-mix`
  - `sequence-based`

### Main UI panels

- `Import Flow`: file import, websocket status, and websocket self-test
- `Tag & Key Explorer`: key/value scan, registry editing, tag application
- `Sequence Presets`: sequence extraction and preset saving
- `Prompt Detail`: manual editing of the selected prompt JSON
- `Export Presets`: tag/key/sequence-based export generation

### Tech stack

- Electron
- React 19
- TypeScript
- Vite
- Dexie / IndexedDB
- Zustand
- WebSocket (`ws`)

### Project structure

- `electron/` Electron main process, preload bridge, meta file storage
- `renderer/src/components/` application panels
- `renderer/src/db/` Dexie prompt storage
- `renderer/src/store/` Zustand store
- `renderer/src/types/` prompt and metadata types
- `renderer/src/utils/tagScanner.ts` DB key/value scanner
- `renderer/src/utils/tagRegistry.ts` tag registry and binding engine
- `renderer/src/utils/keySequenceEngine.ts` path and sequence extraction
- `renderer/src/utils/exportComposer.ts` generated export composition
- `extension/` Chrome extension for producer.ai page extraction

### Development

```bash
npm install
npm run dev
```

### Build and run

```bash
npm run build
npm start
```

### Extension sync

The Chrome extension sends extracted payloads to the local app through websocket. The Electron UI now includes a websocket self-test so the sync pipeline can be verified even without manually pushing data from the browser popup.

## Русский

Prompt DB Local это локальное Electron + React приложение для импорта больших смешанных JSON-пакетов, хранения prompt-подобных блоков, анализа их структуры и генерации новых экспортов на основе тегов, последовательностей ключей и сохранённых пресетов.

### Основные возможности

- Импорт prompt-подобного JSON из файлов и из Chrome extension через `ws://127.0.0.1:3001`.
- Хранение импортированных prompt-записей в IndexedDB через Dexie.
- Хранение служебных метаданных в JSON-файлах `.prompt-db-meta/` через Electron:
  - `tag-registry.json`
  - `element-tag-bindings.json`
  - `key-sequence-presets.json`
  - `export-presets.json`
- Сканирование базы для поиска:
  - часто встречающихся ключей
  - нормализованных коротких значений
  - повторяющихся вложенных последовательностей ключей
- Ведение глобального реестра тегов и применение тегов к элементам БД.
- Сохранение sequence presets и export presets.
- Генерация экспортов в трёх режимах:
  - `as-is`
  - `random-mix`
  - `sequence-based`

### Основные панели интерфейса

- `Import Flow`: импорт файлов, статус websocket и self-test канала
- `Tag & Key Explorer`: сканирование ключей/значений, редактирование registry, применение тегов
- `Sequence Presets`: извлечение последовательностей и сохранение пресетов
- `Prompt Detail`: ручное редактирование выбранного prompt JSON
- `Export Presets`: генерация экспортов по тегам, ключам и последовательностям

### Технологии

- Electron
- React 19
- TypeScript
- Vite
- Dexie / IndexedDB
- Zustand
- WebSocket (`ws`)

### Структура проекта

- `electron/` главный процесс Electron, preload bridge, файловое meta-хранилище
- `renderer/src/components/` панели приложения
- `renderer/src/db/` хранилище prompt-записей на Dexie
- `renderer/src/store/` Zustand store
- `renderer/src/types/` типы prompt и meta-структур
- `renderer/src/utils/tagScanner.ts` сканер ключей и значений БД
- `renderer/src/utils/tagRegistry.ts` реестр тегов и движок привязок
- `renderer/src/utils/keySequenceEngine.ts` извлечение путей и последовательностей
- `renderer/src/utils/exportComposer.ts` генератор новых export-файлов
- `extension/` Chrome extension для извлечения данных со страниц producer.ai

### Разработка

```bash
npm install
npm run dev
```

### Сборка и запуск

```bash
npm run build
npm start
```

### Синхронизация extension

Chrome extension отправляет извлечённые данные в локальное приложение через websocket. В Electron UI теперь есть websocket self-test, поэтому канал синхронизации можно проверить даже без ручной отправки из popup extension.
