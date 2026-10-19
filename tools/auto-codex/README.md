# Codex を自動で動かす（担当 C・D 用、2026-10-19）

「作業を続けて」と打たなくても、3 時間おきに Codex が自分で作業します。

1. main を取り込む（`git pull origin main` か、自分の枝に main を merge）
2. `tools\auto-codex\setup.cmd` をダブルクリック（1 回だけ。管理者は要らない）
3. 止める時は `stop.cmd`

- PC がついていてログインしている間だけ動きます（スリープ中は起きた時に 1 回）。
- 前の回が終わっていなければ重ねません。記録は `tools\auto-codex\run_*.log`。
- Codex の利用枠を使います。
