# bb-windows

Доработки bb для нативной работы на Windows без WSL: запуск сервера и host-daemon, подключение Codex, Claude Code, ZCode/GLM и DeepSeek, инструменты для работы с локальным ПК и проектами.

## Подключение провайдеров

| Провайдер | Что поддерживает Windows-форк |
| --- | --- |
| **Codex** | Запуск через нативный CLI, создание тредов, работа с нативными сессиями и историей |
| **Claude Code** | Подключение нативного CLI, создание тредов и работа с сессиями на Windows |
| **ZCode / GLM** | ACP-адаптер с Windows-патчем: выбор модели и reasoning, восстановление настроек сессии, работа с нативной историей |
| **DeepSeek через OpenCode** | Подключение через ACP с моделями и авторизацией из локальной конфигурации OpenCode |
| **DeepSeek через Harness** | Отдельный ACP-маршрут; поиск `dsh.cmd` через PATH или заданный путь, ключ через `DEEPSEEK_API_KEY` |

Проверено создание новых тредов и получение ответов через все пять маршрутов. Для Codex дополнительно проверено появление ответа в уже открытом чате без обновления страницы. В форке сохранены доработки подготовки окружений, создания тредов и доставки событий в чат.

Каждый пользователь подключает собственные аккаунты. [Установка и настройка провайдеров](README.windows.md#providers-and-credentials), [подробности адаптера ZCode](docs/windows-zcode.md).

## Доработки под Windows

- Нативные server и host-daemon без WSL.
- Скрытый запуск через PowerShell, один supervisor на каталог данных, один server и host-daemon на экземпляр.
- Восстановление после падения сервера, daemon или runtime; штатная остановка с завершением дочерних процессов.
- Исправленная обёртка `bb.cmd`: запускает CLI и не переключается на daemon при неполной сборке.
- Исправления запуска Node-команд, npm для плагинов и завершения CLI после HTTP-ошибок на Windows.
- Сценарии проверки зависимостей, установки, запуска, остановки и обновления.
- Локальный доступ по умолчанию; LAN включается отдельно. Данные и логи хранятся вне Git.

## Выбранные инструменты и интерфейс

- **[PC Control](plugins/pc-control/README.md)** — показатели ПК, процессы и программы; компактная плашка не перекрывает отправку сообщения.
- **[Workspace Explorer](plugins/workspace-explorer/README.md)** — просмотр файлов проекта.
- **[Windows Screen](plugins/windows-screen/README.md)** — снимок экрана Windows по запросу из панели, CLI или инструмента агента.
- **[Markdown](plugins/monaco-editor/README.md)** — просмотр файлов и предпросмотр в редакторе Monaco.
- **[Git Graph](plugins/git-graph/README.md)** — граф коммитов локального проекта.
- **Лимиты провайдеров** — нижняя плашка в боковой панели.
- **Темы и типографика** — наши профили оформления; Fact, Frutiger, Crassula, Magistral и PT Mono включены в сборку вместе с Inter, Golos Text и JetBrains Mono.

## Установка и запуск

Нужны Windows x64, PowerShell 7, Git, Node.js 22.19+ и pnpm 9.15.0. Команды выполняются в PowerShell 7:

```powershell
npm install --global pnpm@9.15.0
git clone https://github.com/zr54211/bb-windows.git bb-windows
cd bb-windows
pwsh -NoProfile -File scripts/windows/check.ps1
pwsh -NoProfile -File scripts/windows/install.ps1
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Start
```

Открыть **http://127.0.0.1:38886**.

```powershell
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Status
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Stop
```

Обновление из этого репозитория:

```powershell
pwsh -NoProfile -File scripts/windows/update.ps1 -Remote origin -Branch main
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Start
```

[Полная инструкция: CLI, конфигурация, провайдеры, отдельные экземпляры и обновление](README.windows.md).

## Основа и лицензия

Основа — [get-bb/bb](https://github.com/get-bb/bb). Сохранены история upstream и [лицензия MIT](LICENSE). Этот репозиторий распространяет Windows-доработки; пакеты и desktop-релизы upstream выпускаются отдельно.
