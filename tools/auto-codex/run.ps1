# 予約から呼ばれる。Codex に「作業を続けて」を 1 回だけ打つ。
param([string]$Codex = 'codex')
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here '..\..')
$log = Join-Path $here ("run_" + (Get-Date -Format 'yyyyMMdd_HHmm') + '.log')

# 止める印。STOP.txt があれば何もしない
if (Test-Path (Join-Path $here 'STOP.txt')) { exit 0 }

# 前の回がまだ動いていたら重ねない（6 時間より古い印は捨てる）
$lock = Join-Path $here 'RUNNING.txt'
if (Test-Path $lock) {
  if ((Get-Item $lock).LastWriteTime -gt (Get-Date).AddHours(-6)) { exit 0 }
}
Set-Content -Path $lock -Value (Get-Date -Format 's') -Encoding utf8
try {
  Set-Location $repo
  "start $(Get-Date -Format 's') in $repo" | Out-File $log -Encoding utf8
  & $Codex exec --full-auto -c sandbox_workspace_write.network_access=true '作業を続けて。終わったら進み具合と 6 行の報告を書き、自分の枝に push して終える。質問して止まらない。' *>> $log
  "end $(Get-Date -Format 's') code $LASTEXITCODE" | Out-File $log -Append -Encoding utf8
} finally {
  Remove-Item $lock -ErrorAction SilentlyContinue
}
