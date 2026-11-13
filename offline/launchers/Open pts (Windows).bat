@echo off
rem Opens pts in its own window (Chrome or Edge app mode), or else in your default browser.
setlocal
set "PAGE=%~dp0pts.html"
set "URL=file:///%PAGE:\=/%"
for %%B in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do if exist %%B (
  start "" %%B --app="%URL%"
  exit /b
)
start "" "%PAGE%"
