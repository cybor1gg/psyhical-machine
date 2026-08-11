# Dev launcher: starts MongoDB (portable), the cabinet API, and the Vite dev
# server, then opens the kiosk in the default browser. This is the forerunner
# of the production launcher that Task Scheduler will run at boot on a real
# cabinet (which will launch the browser in --kiosk mode instead).
$root = Split-Path -Parent $PSScriptRoot

# 1. MongoDB (skip if already listening)
$mongo = Get-NetTCPConnection -LocalPort 27018 -State Listen -ErrorAction SilentlyContinue
if (-not $mongo) {
  New-Item -ItemType Directory -Force "$root\data\db" | Out-Null
  Start-Process -FilePath "$root\tools\mongodb-win32-x86_64-windows-8.0.4\bin\mongod.exe" `
    -ArgumentList "--dbpath","$root\data\db","--port","27018","--bind_ip","127.0.0.1","--logpath","$root\data\mongod.log","--logappend" `
    -WindowStyle Hidden
  Start-Sleep -Seconds 4
}

# 2. API
$api = Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue
if (-not $api) {
  Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "$root\api" -WindowStyle Minimized
  Start-Sleep -Seconds 3
}

# 3. Frontend dev server
$web = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $web) {
  Start-Process -FilePath "npm" -ArgumentList "run","dev" -WorkingDirectory "$root\web" -WindowStyle Minimized
  Start-Sleep -Seconds 3
}

Start-Process "http://localhost:3000"
Write-Host "Cabinet dev stack running: mongod :27018, api :5001, web :3000"
