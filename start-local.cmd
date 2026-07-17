@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js / npm。请先安装 Node.js 20 或更高版本。
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo [准备] 首次运行，正在安装依赖...
  call npm.cmd ci
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查上方输出。
    pause
    exit /b 1
  )
)

echo [启动] Litematica Material Studio
echo [地址] http://127.0.0.1:5173/
echo [提示] 保持此窗口开启；关闭窗口或按 Ctrl+C 可停止本地服务器。

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:5173/'"
call npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort

if errorlevel 1 (
  echo [错误] 启动失败；端口 5173 可能已被占用。
  pause
)
