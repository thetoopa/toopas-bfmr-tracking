$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Python = "C:\Users\coope\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$Server = Join-Path $Root "server.py"
$LogDir = Join-Path $Root "logs"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Root
& $Python $Server *>> (Join-Path $LogDir "server.combined.log")
