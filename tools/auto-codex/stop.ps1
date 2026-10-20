# 予約を消して、自動の作業を止める。
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = 'GravityCore_Codex_' + $env:USERNAME
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
Set-Content -Path (Join-Path $here 'STOP.txt') -Value 'stop' -Encoding utf8
Write-Host '止めました。もう一度動かす時は setup.cmd。'
Read-Host 'Enter で閉じる'
