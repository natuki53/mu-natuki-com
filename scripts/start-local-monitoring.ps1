param(
    [string]$Python,
    [string]$Node
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Python) { $Python = Join-Path $root '.local\venv\Scripts\python.exe' }
if (-not $Node) { $Node = (Get-Command node -ErrorAction Stop).Source }
$logs = Join-Path $root '.local\monitoring-runtime'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
foreach ($item in @(
    @{Port=18765; Exe=$Python; Args=@('-B',"`"$root\server\local_live_monitoring.py`"",'--config',"`"$root\.local\live-monitoring.json`""); Name='api'; Check='/healthz'},
    @{Port=4178; Exe=$Node; Args=@("`"$root\node_modules\vite\bin\vite.js`"",'--config',"`"$root\vite.monitoring.config.js`""); Name='ui'; Check='/admin/'}
)) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $item.Port -ErrorAction SilentlyContinue
    if (-not $listener) {
        Start-Process -FilePath $item.Exe -ArgumentList $item.Args -WorkingDirectory $root -WindowStyle Hidden `
            -RedirectStandardOutput "$logs\$($item.Name).out.log" -RedirectStandardError "$logs\$($item.Name).err.log" | Out-Null
    }
    $healthy = $false
    for ($i=0; $i -lt 20; $i++) {
        try {
            $response = Invoke-WebRequest "http://127.0.0.1:$($item.Port)$($item.Check)" -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $healthy=$true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $healthy) { throw "$($item.Name) failed its health check; inspect $logs" }
}
$session = Invoke-RestMethod 'http://127.0.0.1:18765/api/admin/v1/session'
$data = Invoke-RestMethod 'http://127.0.0.1:18765/api/admin/v1/monitoring'
if ($data.mode -ne 'local-live' -or $data.readOnly -ne $true) { throw 'Unexpected API on the preview port' }
Write-Output 'Ready: http://127.0.0.1:4178/admin/ (local live, read-only; first collection may take a minute)'
