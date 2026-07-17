# ============================================================
# Talking Head Console - Windows 启动器
#   拉起本地控制台服务(若未运行)→ 默认浏览器打开控制台
# 用法: powershell -ExecutionPolicy Bypass -File scripts/make-shortcut.ps1
# ============================================================
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Port = if ($env:CONSOLE_PORT) { [int]$env:CONSOLE_PORT } else { 4870 }
$Url = "http://127.0.0.1:$Port"

function Test-Port {
    param([int]$P)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect("127.0.0.1", $P)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

if (-not (Test-Port $Port)) {
    $logDir = Join-Path $Root "console\logs"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $server = Join-Path $Root "console\server.mjs"
    Write-Host "启动控制台服务: node $server"
    Start-Process -FilePath "node" -ArgumentList "`"$server`"" -WorkingDirectory $Root -WindowStyle Hidden

    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-Port $Port) { break }
    }
}

if (Test-Port $Port) {
    Write-Host "打开控制台: $Url"
    Start-Process $Url
} else {
    Write-Error "控制台服务未能在 10 秒内就绪,请检查 console\logs 下日志。"
    exit 1
}
