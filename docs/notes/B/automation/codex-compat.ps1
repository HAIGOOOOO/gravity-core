#requires -Version 7.0
# 共有の予約へ渡すCLI入口。旧引数にも対応し、対話を待たずに起動する。
# 本体のrun.ps1が持つ停止印・重複防止・ログ・作業フォルダの処理はそのまま通す。
$ErrorActionPreference = 'Stop'
$command = Get-Command codex.exe -ErrorAction SilentlyContinue
if ($command) {
  $executable = $command.Source
} else {
  # 予約の環境にアプリのPATHが無い場合は、設定時に確かめた実行ファイルを使う。
  # 予約のPATHにgitが無い時も、確認済みの実行ファイルを読めるようにする。
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
  $cache = Join-Path $repoRoot '.git/gravity-core-codex-executable.txt'
  $executable = (Get-Content -LiteralPath $cache -Encoding UTF8 -Raw).Trim()
}
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw 'Codex executable is missing. Reconfigure the scheduled task.'
}
$forwarded = foreach ($argument in $args) {
  if ($argument -eq '--full-auto') { '--approve-for-me' } else { $argument }
}
# 予約ではコンソールを介さず、標準入力を閉じて起動する。
# 出力とエラーを並行に読み、片方のバッファが埋まって止まる事を防ぐ。
$startInfo = [Diagnostics.ProcessStartInfo]::new($executable)
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.WorkingDirectory = (Get-Location).Path
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
$startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
foreach ($argument in $forwarded) { $startInfo.ArgumentList.Add([string]$argument) }
$cliProcess = [Diagnostics.Process]::new()
$cliProcess.StartInfo = $startInfo
[void]$cliProcess.Start()
$cliProcess.StandardInput.Close()
$readOutput = $cliProcess.StandardOutput.ReadToEndAsync()
$readError = $cliProcess.StandardError.ReadToEndAsync()
$cliProcess.WaitForExit()
$readOutput.GetAwaiter().GetResult()
$readError.GetAwaiter().GetResult()
$global:LASTEXITCODE = $cliProcess.ExitCode
$cliProcess.Dispose()
