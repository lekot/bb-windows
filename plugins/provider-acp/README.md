# Провайдеры ACP

Плагин подключает агентов по Agent Client Protocol. В Windows-форке основные дополнительные маршруты — **ZCode/GLM**, **DeepSeek через OpenCode** и **DeepSeek Harness**. В коде также остаются другие определения upstream, например Cursor, omp, Grok Build и Hermes Agent; они не входят в перечень проверенных Windows-маршрутов.

[Настройка провайдеров и личной авторизации](../../README.windows.md#providers-and-credentials). [Особенности ZCode](../../docs/windows-zcode.md).

## Пользовательский агент

Настройка `customAgents` содержит JSON-массив. Обязательные поля записи: `id`, `displayName`, `command`. Обычно также задаются `args` и `env`. Провайдер получает ID `acp-<id>`; например `id: "zcode"` создаёт `acp-zcode`.

```powershell
bb plugin config provider-acp
bb provider list --json
```

[Готовая регистрация ZCode для Windows](../../README.windows.md#zcode--glm) строит пути из каталога проекта и переменных окружения. Не добавляйте в примеры реальные ключи или чужие пути.

Список `customAgents` имеет приоритет над устаревшим массивом `customAcpAgents` при совпадении ID. Запись с ID поставляемого агента переопределяет его настройку; сверяйте схему перед изменением. Полный список полей определяется `customAcpAgentSchema` в `src/agents.ts`.

## Устройство плагина

Все агенты используют публичный набор `@get-bb/plugin-sdk/provider-bridge/acp`; собственного альтернативного моста здесь нет. `public-sdk-only.test.ts` проверяет отсутствие импортов приватных пакетов `@bb/*`.

- `server.ts` согласует регистрации поставляемых и пользовательских агентов.
- `src/known-agents.ts` содержит определения поставляемых агентов.
- `src/agents.ts` задаёт схему агента на основе схемы запуска ACP-набора.
- `src/configured-agents.ts` объединяет актуальные и прежние настройки.
- `src/declaration.ts` создаёт регистрацию `bb.providers.register`: ID, название, значок, возможности и параметры запуска `acpLaunchSpec`/`acpDialect`.
- `src/legacy-config.ts` читает устаревшую конфигурацию.
- `src/host.ts` экспортирует ACP-мост и RPC проверки возможностей установленного агента; контракт и проверка находятся в `src/contract.ts` и `src/probe-capabilities.ts`.
- `icons/` содержит значки, объявленные через `bb.branding.experimental_icons` для упаковки.

Реализация ACP-протокола, преобразование событий и особенности отдельных агентов находятся в `packages/provider-bridge-acp`.

## Проверка изменений

```powershell
pnpm exec turbo run typecheck test --filter=bb-plugin-provider-acp
```

После обновления провайдера выполните также реальную проверку [создания тредов](../../README.windows.md#verify). Успешная проверка наличия исполняемого файла не подтверждает авторизацию или ответ модели.
