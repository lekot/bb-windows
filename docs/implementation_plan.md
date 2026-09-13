# План развертывания bb-windows и интеграции Antigravity

Развертывание нативного Windows-форка [zr54211/bb-windows](https://github.com/zr54211/bb-windows) (bb без WSL) на машине с Windows x64 и подключение **Google Antigravity** в качестве полноценного провайдера агентов через Agent Client Protocol (ACP).

## User Review Required

> [!IMPORTANT]
> **PowerShell 7 (pwsh)**: Скрипты `bb-windows` (`check.ps1`, `install.ps1`, `bb.ps1`) требуют PowerShell 7 (`#requires -Version 7.0`). Сейчас в системе установлен Windows PowerShell 5.1. Мы скачаем и распакуем портативную версию PowerShell 7 (`v7.6.6-win-x64`) в папку пользователя (`~/.powershell/7`) и добавим в `PATH`, чтобы не требовать прав администратора.
>
> **Официальный ACP-сервер Antigravity**: Для интеграции используется официальный дистрибутив `agy_acp_server.exe` (Google Antigravity ACP Server v1.1.1 для Windows x86_64, ~468 МБ), который обеспечивает взаимодействие по стандартному Agent Client Protocol через stdio.

## Архитектура решения

```mermaid
graph TD
    User([Пользователь / Браузер]) -->|HTTP 38886| BBServer[bb Server (Node.js/Vite)]
    BBServer -->|RPC 38887| BBDaemon[bb Host Daemon]
    BBDaemon -->|Supervisor JobObject| BBSupervisor[bb.ps1 Supervisor]
    BBDaemon -->|ACP stdio Bridge| AntigravityPlugin[bb-plugin-google-antigravity-acp]
    AntigravityPlugin -->|Process Spawning| AGYServer[agy_acp_server.exe]
    AGYServer -->|Gemini/Antigravity APIs| GoogleModels[Gemini 3.5/3.8 Flash & Pro]
```

## Предлагаемые этапы

### 1. Подготовка окружения Windows
- Проверить наличие `node.exe` (уже установлен v24.14.0).
- Обновить `pnpm` до закрепленной в проекте версии 9.15.0 (`npm install -g pnpm@9.15.0`).
- Скачать и распаковать портативный релиз PowerShell 7.x (`win-x64.zip`) в `C:\Users\Максим\.powershell\7`, добавить в `PATH` текущей сессии и пользователя.
- Проверить запуск `pwsh.exe -v`.

---

### 2. Клонирование и проверка bb-windows
- Клонировать репозиторий `https://github.com/zr54211/bb-windows.git` в `c:\reps\bb-windows`.
- Запустить `pwsh -NoProfile -File scripts/windows/check.ps1` и убедиться в успешном прохождении всех базовых проверок.

---

### 3. Интеграция провайдера Google Antigravity
Поддержка Antigravity будет добавлена двумя взаимодополняющими путями:
1. **Плагин провайдера**:
   - Интегрировать плагин `provider-google-antigravity-acp` (на базе проверенного протокола [bb-plugin-antigravity-acp](https://github.com/rawizhere/bb-plugin-antigravity-acp)) непосредственно в дерево плагинов `plugins/provider-google-antigravity-acp`.
   - Плагин регистрирует провайдера `acp-antigravity` с брендовым SVG-значком, поддержкой моделей `gemini-3.8-flash`, `gemini-3.5-flash`, `gemini-3.1-pro` с уровнями reasoning, а также команды управления `bb google-antigravity-acp install/status`.
2. **ACP-сервер Antigravity**:
   - Скачать официальный Windows x64 релиз `agy-acp-server-agy_acp_server_1.1.1-windows-x86_64.zip` из Google CDN (`https://dl.google.com/agy-extensions/releases/windows/...`).
   - Распаковать `agy_acp_server.exe` и вспомогательный бинарник `localharness_external.exe` в `C:\Users\Максим\.local\opt\agy-acp-server\bin` и сделать симлинк/копию в `C:\Users\Максим\.local\bin`.
   - Проверить handshake: запуск `agy_acp_server.exe` с отправкой JSON-RPC инициализации ACP.

---

### 4. Сборка и установка bb
- В каталоге `c:\reps\bb-windows` выполнить:
  ```powershell
  pwsh -NoProfile -File scripts/windows/install.ps1
  ```
- Скрипт установит зависимости с замороженным локфайлом и выполнит предсборку серверной части и host-daemon.

---

### 5. Запуск и верификация
- Запустить службу:
  ```powershell
  pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Start
  ```
- Проверить статус:
  ```powershell
  pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Status
  ```
- Проверить список провайдеров через CLI:
  ```powershell
  & .\apps\host-daemon\dist\bb.cmd provider list --json
  ```
  Убедиться, что `acp-antigravity` присутствует в списке провайдеров со статусом доступности.
- Проверить доступность веб-интерфейса `http://127.0.0.1:38886`.
- Корректно завершить работу:
  ```powershell
  pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Stop
  ```

## План верификации

### Автоматические проверки
- Запуск `pwsh -File scripts/windows/check.ps1` -> вывод `Dependencies OK`.
- Проверка handshake ACP сервера: отправка `{"jsonrpc":"2.0","id":1,"method":"initialize",...}` и получение валидного ответа протокола.
- Проверка `bb provider list --json` -> наличие провайдера `acp-antigravity`.

### Ручная проверка
- Открытие веб-интерфейса `http://127.0.0.1:38886` в браузере, проверка наличия провайдера Antigravity в интерфейсе выбора агентов.
