# Power BI Filter Presets

## What it does

Power BI Filter Presets is a Manifest V3 Chrome extension that saves and restores local presets of selected values in embedded Power BI list filters. Presets are scoped to a normalized page URL: origin, path, and query string are kept, while hash fragments are ignored.

## Features

- Save selected filter values, review the captured filters, and choose which ones to include in a preset.
- Apply a saved preset and review the per-filter result, including missing filters or values.
- Create presets manually; edit, rename, and delete existing presets.
- Copy preset JSON for backup or sharing, then paste validated preset JSON to create a preset.
- Open built-in help for the main workflows.
- See a first-launch recommendation to restrict the extension's site access to the portal and embedded Power BI iframe/report domains you use.
- English and Russian interface support, selected from Chrome's locale.

## Install

Download a ZIP release from [GitHub Releases](https://github.com/deadok/PowerBIFilterPresets/releases), then:

1. Extract the ZIP archive.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select the extracted directory that contains `manifest.json`.

CRX packages are intended for controlled developer or enterprise distribution and remain subject to Chrome and platform restrictions.

## Use

1. Open a page that contains an embedded Power BI report and select values in supported list filters.
2. Open the extension and choose **Save current filters**. Review the filters, name the preset, and save it.
3. Later, return to a page with the same normalized URL scope, select the preset, and apply it.
4. Check the result log if a filter or value is missing from the report.

## Privacy and permissions

Presets are stored locally in `chrome.storage.local` and are scoped to a normalized page URL: origin, path, and query string are kept, while hash fragments are ignored.

The extension requests these permissions:

- `storage` to keep presets locally.
- `activeTab` and `scripting` to read and apply filters on the active report page.
- `clipboardRead` to paste preset JSON from the clipboard.

The content script also exposes a developer diagnostics interface on the page through `CustomEvent` handlers and `window.PowerBIFilterPresets` for inspecting preset and filter behavior in DevTools.

The `<all_urls>` content-script match and `all_frames` are intentional: embedded Power BI reports can appear inside frames and on custom or corporate portal hosts. For better privacy, restrict the extension's Chrome Site access to only the specific portal and embedded Power BI iframe/report domains you use.

## Development

```bash
npm ci
npm run build
```

Load the generated `dist/` directory as an unpacked extension. Run checks with:

```bash
npm test
npm run typecheck
```

## Limitations

Only selected values in supported embedded list filters are handled. If a report changes after a preset is saved, applying it can report a missing filter or value.

## License

Licensed under [LICENSE](LICENSE).

---

# Power BI Filter Presets — Русский

## Что делает расширение

Power BI Filter Presets — Chrome-расширение Manifest V3, которое сохраняет и восстанавливает локальные пресеты выбранных значений во встроенных списковых фильтрах Power BI. Пресеты привязаны к нормализованному URL страницы: origin, path и query string сохраняются, а фрагменты hash игнорируются.

## Возможности

- Сохранять выбранные значения фильтров, проверять найденные фильтры и выбирать, какие из них включить в пресет.
- Применять сохранённый пресет и просматривать результат для каждого фильтра, включая отсутствующие фильтры или значения.
- Создавать пресеты вручную, изменять, переименовывать и удалять их.
- Копировать JSON пресета для резервного хранения или передачи, а затем вставлять проверенный JSON для создания пресета.
- Открывать встроенную справку по основным сценариям.
- При первом запуске получать рекомендацию ограничить доступ расширения к сайтам доменами используемых портала и встроенных Power BI iframe/отчётов.
- Использовать английский или русский интерфейс в соответствии с локалью Chrome.

## Установка

Скачайте ZIP-релиз из [GitHub Releases](https://github.com/deadok/PowerBIFilterPresets/releases), затем:

1. Распакуйте ZIP-архив.
2. Откройте в Chrome страницу `chrome://extensions`.
3. Включите **Режим разработчика**.
4. Нажмите **Загрузить распакованное расширение**.
5. Выберите распакованную папку, содержащую `manifest.json`.

CRX-пакеты предназначены для контролируемого распространения среди разработчиков или в корпоративной среде и зависят от ограничений Chrome и используемой платформы.

## Использование

1. Откройте страницу со встроенным отчётом Power BI и выберите значения в поддерживаемых списковых фильтрах.
2. Откройте расширение и нажмите **Сохранить текущие фильтры**. Проверьте фильтры, задайте имя и сохраните пресет.
3. Позже вернитесь к странице с той же нормализованной областью URL, выберите пресет и примените его.
4. Если в отчёте отсутствуют фильтр или значение, проверьте журнал результатов.

## Конфиденциальность и разрешения

Пресеты хранятся локально в `chrome.storage.local` и привязаны к нормализованному URL страницы: origin, path и query string сохраняются, а фрагменты hash игнорируются.

Расширение запрашивает следующие разрешения:

- `storage` — для локального хранения пресетов.
- `activeTab` и `scripting` — для чтения и применения фильтров на активной странице отчёта.
- `clipboardRead` — для вставки JSON пресета из буфера обмена.

Content script также открывает на странице интерфейс разработческой диагностики через обработчики `CustomEvent` и `window.PowerBIFilterPresets`, чтобы проверять поведение пресетов и фильтров в DevTools.

Шаблон content script `<all_urls>` и параметр `all_frames` используются намеренно: встроенные отчёты Power BI могут находиться во фреймах и на пользовательских или корпоративных порталах. Для лучшей конфиденциальности ограничьте доступ расширения к сайтам в Chrome только конкретными доменами используемых портала и встроенных Power BI iframe/отчётов.

## Разработка

```bash
npm ci
npm run build
```

Загрузите созданную папку `dist/` как распакованное расширение. Проверки запускаются так:

```bash
npm test
npm run typecheck
```

## Ограничения

Поддерживаются только выбранные значения во встроенных списковых фильтрах. Если после сохранения пресета отчёт изменился, при применении может появиться результат об отсутствующем фильтре или значении.

## Лицензия

Лицензия: [LICENSE](LICENSE).
