# Результаты развертывания bb-windows и интеграции Google Antigravity

Нативный форк [bb-windows](https://github.com/zr54211/bb-windows) (bb без WSL на Windows x64) успешно развернут, скомпилирован и запущен. В систему интегрирована полноценная поддержка **Google Antigravity** в качестве ACP-провайдера.

---

## 1. Что было сделано

### Окружение и зависимости
- **PowerShell 7 (pwsh)**: Развернут портативный `PowerShell 7.6.6` в `C:\Users\Максим\.powershell\7\pwsh.exe` и прописан в пользовательский `PATH`. Это позволило соблюсти требование скриптов `bb-windows` (`#requires -Version 7.0`) без необходимости повышать привилегии администратора.
- **pnpm**: Зафиксирован на версии `9.15.0`.
- **Node.js**: `v24.14.0`.

### Бинарники Google Antigravity ACP
- Загружен и распакован официальный дистрибутив `agy_acp_server_1.1.1-windows-x86_64` в `C:\Users\Максим\.local\opt\agy-acp-server\bin`.
- Бинарники `agy_acp_server.exe` (430 МБ) и `localharness_external.exe` (130 МБ) мгновенно залинкованы в `C:\Users\Максим\.local\bin` через NTFS hardlinks.

### Плагин `provider-google-antigravity-acp`
- Плагин интегрирован в каталог `plugins/provider-google-antigravity-acp`.
- Зарегистрирован в `plugins/bb-official.json` и `apps/server/src/services/plugins/builtin-registry.ts`.
- Адаптирован под Windows-тайминги самораспаковки PyInstaller (~20 сек) и добавлена поддержка фолбэка моделей до первичной авторизации пользователя.
- Сгенерирован `.bundled-runtime` и пересобраны `@bb/bundled-plugins`, `@bb/server`, `@bb/host-daemon`.

---

## 2. Верификация работы

### Проверка статуса провайдера через CLI
```bash
& "c:\reps\bb-windows\apps\host-daemon\dist\bb.cmd" google-antigravity-acp status
```
**Вывод:**
```text
providerId:    acp-antigravity
displayName:   Google Antigravity
command:       agy_acp_server.exe
launchArgs:    (none)
target:        this machine (server)
platform:      win32 x86_64
binary:        C:\Users\Максим\.local\bin\agy_acp_server.exe
harnessPath:   C:\Users\Максим\.local\opt\agy-acp-server\localharness_external.exe
installDir:    ~/.local/opt/agy-acp-server
binDir:        ~/.local/bin

Ready. The provider appears in `bb provider list` when the bridge health probe passes.
```

### Список провайдеров в BB
```bash
& "c:\reps\bb-windows\apps\host-daemon\dist\bb.cmd" provider list
```
**Вывод:**
```text
ID                    Name              
--------------------  ------------------
codex                 Codex             
claude-code           Claude Code       
pi                    Pi                
acp-cursor            Cursor            
acp-opencode          DeepSeek          
acp-deepseek-harness  DeepSeek Harness  
acp-antigravity       Google Antigravity
```

### Каталог моделей Google Antigravity
```bash
& "c:\reps\bb-windows\apps\host-daemon\dist\bb.cmd" provider models acp-antigravity
```
**Вывод:**
```text
Models for acp-antigravity:

Model             Name              Default
----------------  ----------------  -------
gemini-3.8-flash  Gemini 3.8 Flash  *
----------------  ----------------  -------
gemini-3.7-flash  Gemini 3.7 Flash
----------------  ----------------  -------
gemini-3.6-flash  Gemini 3.6 Flash
----------------  ----------------  -------
gemini-3.1-pro    Gemini 3.1 Pro
```

### Веб-интерфейс BB
- **Адрес:** [http://127.0.0.1:38886](http://127.0.0.1:38886)
- **Статус:** `HTTP/1.1 200 OK`
- Сервер и Host Daemon активны на портах `38886` и `38887`.

---

## 3. Управление сервером

- **Запуск:**
  ```powershell
  pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Supervise
  ```
- **Проверка статуса:**
  ```powershell
  pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Status
  ```
- **Остановка:**
  ```powershell
  pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Stop
  ```
- **CLI-команды:**
  ```cmd
  c:\reps\bb-windows\apps\host-daemon\dist\bb.cmd status
  c:\reps\bb-windows\apps\host-daemon\dist\bb.cmd provider list
  c:\reps\bb-windows\apps\host-daemon\dist\bb.cmd thread spawn --provider acp-antigravity --prompt "Привет"
  ```
