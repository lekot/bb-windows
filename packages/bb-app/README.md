# Пакет bb-app в Windows-форке

Пакет содержит общий runtime, CLI и Node SDK. Нативный Windows-запуск этого форка выполняется через PowerShell-сценарии из корня репозитория.

**`npx bb-app@latest` скачивает пакет upstream из npm, а не эту сборку.** Для установки форка используйте [основную инструкцию](../../README.windows.md#install).

## Запуск и остановка

Из корня уже установленного репозитория, в PowerShell 7:

```powershell
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Start
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Status
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Stop
```

Интерфейс по умолчанию доступен на **http://127.0.0.1:38886**. Host-daemon использует порт 38887. Лаунчер работает скрыто, контролирует повторный запуск и восстанавливает упавшие процессы. Данные сохраняются в `%LOCALAPPDATA%\BBWindows`.

Для другого экземпляра передавайте одинаковый `-DataDir` при запуске, проверке состояния, остановке и обновлении. Порты и переменные окружения задаются по [инструкции Windows](../../README.windows.md#start-and-stop).

## CLI

CLI обращается к уже работающему серверу:

```powershell
& .\apps\host-daemon\dist\bb.cmd --help
$env:PATH = (Join-Path $PWD 'apps/host-daemon/dist') + ';' + $env:PATH
$env:BB_SERVER_URL = 'http://127.0.0.1:38886'
$env:BB_HOST_DAEMON_PORT = '38887'
bb status --json
```

Обёртка `bb.cmd` запускает CLI. Управление фоновыми процессами выполняет `bb.ps1`.

## Node SDK

В Node-проекте, подключённом к собранному пакету этой рабочей области:

```ts
import { BBSdk } from "bb-app";

const bb = new BBSdk({ baseUrl: "http://127.0.0.1:38886" });
const thread = await bb.threads.spawn({
  projectId: "proj_personal",
  environment: { type: "host", workspace: { type: "personal" } },
  prompt: "Кратко опиши мои активные задачи в bb.",
});
await bb.threads.wait({ threadId: String(thread.id), status: "idle" });
console.log(await bb.threads.output({ threadId: String(thread.id) }));
```

Пример создаёт реальный тред и расходует квоту настроенного провайдера. Без явного `baseUrl` SDK использует общую с CLI конфигурацию, в том числе `BB_SERVER_URL`. Запускаемые из bb процессы получают адрес своего сервера через окружение.

## Провайдеры и конфигурация

В Windows-форке проверены Codex, Claude Code, ZCode/GLM через ACP, DeepSeek через OpenCode и DeepSeek Harness. [Установка и авторизация](../../README.windows.md#providers-and-credentials), [настройка ACP](../../plugins/provider-acp/README.md).

У каждого пользователя должны быть собственные учётные данные. Передавайте личный файл окружения через `-EnvFile`, храните его вне Git и перезапускайте экземпляр после изменения стартовых переменных. Не переносите чужую базу, историю, ключи или каталоги авторизации.

Для обновления используйте `scripts/windows/update.ps1`, а не обновление пакета upstream в npm. [Обновление и синхронизация](../../README.windows.md#update-and-integrate-upstream).

## Дополнительные инструкции

- [Поддержка платформ и ограничения](../../docs/platform-support.md).
- [Рабочие копии Git и хуки окружения](../../docs/worktrees.md).
- [Результаты Windows-проверок](../../docs/windows-fork-audit.md).
- [Основной README форка](../../README.md).
