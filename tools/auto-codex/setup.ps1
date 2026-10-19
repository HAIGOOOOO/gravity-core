# 1 回だけ走らせる。3 時間おきに Codex が自分で「作業を続けて」をやる予約を作る（管理者は要らない）。
param([int]$Hours = 3)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cmd = Get-Command codex -ErrorAction SilentlyContinue
if (-not $cmd) { Write-Host 'codex が見つかりません。先に Codex CLI を入れてログインしてください。'; Read-Host 'Enter で閉じる'; exit 1 }
$codex = $cmd.Source
$name = 'GravityCore_Codex_' + $env:USERNAME
$run = Join-Path $here 'run.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$run`" -Codex `"$codex`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours $Hours)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 5)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Remove-Item (Join-Path $here 'STOP.txt') -ErrorAction SilentlyContinue
Write-Host "できました。2 分後から $Hours 時間おきに Codex が自分で作業します（予約の名前: $name）。"
Write-Host '止める時は stop.cmd をダブルクリック。記録は tools\auto-codex\run_*.log'
Read-Host 'Enter で閉じる'
