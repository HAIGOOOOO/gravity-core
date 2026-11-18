# 旧予約の--full-autoだけを、このPCのCLIが受け付ける自動審査へ置き換える。
# 本体のrun.ps1が持つ停止印・重複防止・ログ・作業フォルダの処理はそのまま通す。
$ErrorActionPreference = 'Stop'
$command = Get-Command codex.exe -ErrorAction SilentlyContinue
if ($command) {
  $executable = $command.Source
} else {
  # 予約の環境にアプリのPATHが無い場合は、設定時に確かめた実行ファイルを使う。
  $cache = git rev-parse --git-path gravity-core-codex-executable.txt
  $executable = (Get-Content -LiteralPath $cache -Encoding UTF8 -Raw).Trim()
}
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw 'Codex executable is missing. Reconfigure the scheduled task.'
}
$forwarded = foreach ($argument in $args) {
  if ($argument -eq '--full-auto') { '--approve-for-me' } else { $argument }
}
& $executable @forwarded
exit $LASTEXITCODE
