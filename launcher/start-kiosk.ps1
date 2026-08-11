# Kiosk launcher: starts the full stack, then opens the casino in a locked
# browser shell — no address bar, no tabs, no browser UI at all. This is the
# script Task Scheduler runs at logon on a real cabinet.
#
# In-page lockdown (zoom, right-click, selection, shortcuts) is handled by the
# web app itself; these flags remove the browser chrome around it.
$root = Split-Path -Parent $PSScriptRoot

# 1. Stack (same logic as start-dev.ps1)
$mongo = Get-NetTCPConnection -LocalPort 27018 -State Listen -ErrorAction SilentlyContinue
if (-not $mongo) {
  New-Item -ItemType Directory -Force "$root\data\db" | Out-Null
  Start-Process -FilePath "$root\tools\mongodb-win32-x86_64-windows-8.0.4\bin\mongod.exe" `
    -ArgumentList "--dbpath","$root\data\db","--port","27018","--bind_ip","127.0.0.1","--logpath","$root\data\mongod.log","--logappend" `
    -WindowStyle Hidden
  Start-Sleep -Seconds 4
}
$api = Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue
if (-not $api) {
  Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "$root\api" -WindowStyle Hidden
  Start-Sleep -Seconds 3
}
# Kiosk serves the PRODUCTION build (vite preview), never the dev server —
# React dev mode is markedly slower and would make swipes stutter.
$web = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $web) {
  if (-not (Test-Path "$root\web\dist\index.html")) {
    Start-Process -FilePath "npx" -ArgumentList "vite","build" -WorkingDirectory "$root\web" -Wait -WindowStyle Hidden
  }
  Start-Process -FilePath "npx" -ArgumentList "vite","preview","--port","3000","--strictPort" -WorkingDirectory "$root\web" -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

# 2. Locked browser shell — Chrome if installed, else Edge (always on Windows)
$kioskFlags = @(
  "--kiosk",                              # fullscreen, no browser UI
  "http://localhost:3000",
  "--incognito",                          # nothing persists between sessions
  "--noerrdialogs",
  "--disable-session-crashed-bubble",     # no "restore pages?" after power cut
  "--disable-pinch",                      # pinch zoom off at the browser level
  "--overscroll-history-navigation=0",    # no back/forward edge swipes
  "--disable-translate",
  "--autoplay-policy=no-user-gesture-required",
  "--check-for-update-interval=604800"
)

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($chrome) {
  Start-Process -FilePath $chrome -ArgumentList $kioskFlags
} else {
  Start-Process -FilePath "msedge.exe" -ArgumentList ($kioskFlags + "--edge-kiosk-type=fullscreen")
}
Write-Host "Cabinet running in kiosk mode. Alt+F4 exits the shell (disable via Windows kiosk/assigned-access policy on production machines)."
