#requires -Version 7.0
# 予約から、手元で確認したPowerShell・実行環境を使って共有の起動処理を呼ぶ。
param([string]$Runner = '')
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$runtimeFile = Join-Path $repoRoot '.git/auto-codex-runtime.json'
$runtimeConfig = Get-Content -LiteralPath $runtimeFile -Encoding UTF8 -Raw | ConvertFrom-Json
$env:PATH = $runtimeConfig.path
$OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
} catch {
  # コンソールが無い環境でも、標準入力の終端とUTF-8のログ出力は維持する。
}
if (-not $Runner) { $Runner = Join-Path $repoRoot 'tools/auto-codex/run.ps1' }
Set-Location -LiteralPath $repoRoot
& $Runner -Codex (Join-Path $PSScriptRoot 'codex-compat.ps1')
# 共有のfinallyが片づけを終えた後で、予約へCLIの終了コードを返す。
exit $LASTEXITCODE
