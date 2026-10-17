@echo off
chcp 65001 >nul
setlocal
set "NODE_USE_ENV_PROXY=1"
where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto missing_node
(
  node "%~dp0tools\launch-editor.mjs" %*
  if errorlevel 1 (
    echo.
    echo 起動中にエラーが発生しました。この画面で内容を確認できます。
    pause
    exit /b 1
  )
  echo.
  echo エディターを終了しました。この画面でエラーの内容を確認できます。
  pause
  exit /b 0
)
:missing_node
echo.
echo 初回のみ Node.js 24 LTS 以降のインストールが必要です。
echo https://nodejs.org/ から LTS 版をインストールし、このファイルを再度開いてください。
pause
exit /b 1
