# SPEC — hoshi-kazoe

## 19. 星かぞえ (`hoshi-kazoe`) — カメラ×光害
- **一行**: 夜空を撮ると、写った星の数から空の暗さ(ボートルスケール)を推定する。
- **核**: 「ここは都会の空か」を星の数で言う。田舎都会センサーの夜空版。
- **技術**: Vite+素のJS / 長時間露光できないため複数フレームを重ねる / 星の検出は純粋関数
- **公開**: Vercel
- **難所**: スマホのブラウザでは露光を制御できない → 写る星が少なすぎる可能性が高い。実現性は要調査。

---

# 共通ルール(アプリ20本量産フェーズ)

- **規模**: 1〜2日で「公開まで」行ける範囲に絞る。上の仕様で一点突破し、機能を足さない。
- **作風**: 一点突破のコンセプト / ブラウザ内で完結(サーバ不要) / カメラ・センサー・数理を使った遊び心 / 「正直さ」を設計で守る(測れないときは測れないと言う、根拠と誤差を見せる) / 純粋ロジック+テスト。
- **構成(Webアプリ)**: Vite + 素のJS + pnpm。中核ロジックは `src/lib/` の純粋関数にして Vitest で固くテストし、配線・描画と分ける。`window.__app` を公開して、ヘッドレスでも検証できるようにする。
- **カメラ/マイク/センサー**: 実機がなくても検証できるよう、合成データやデモ入力で動くモードを用意する。
- **ポート**: 下に指定した番号を `strictPort` で固定する(既存アプリとの衝突回避)。
- **参考になる既存作**: `~/ranzo_project/` 配下(例: takibiban, otomon, uchikeshi, sokomi, shikisougi)。品質の基準はこれらに合わせる。
- **公開**: GitHub(public) `Jinshin2534/<slug>` を gh で作成して push。Webアプリは Vercel に GitHub 連携でデプロイする(push で自動デプロイ)。Vercel 向きでないもの(CLI等)は簡素なLPを GitHub Pages で公開する。
- **完了時**: 公開URLを確かめたうえで、メモリ `/Users/nokokoro/.claude/projects/-Users-nokokoro-ranzo-project/memory/` に `<slug>.md` を追加し、`MEMORY.md` に既存の行と同じ形式で1行追記する(公開URL・port・テスト数・ハマりどころ)。
- **コミット**: 末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` をつける。
- **仕様は確定済み**。細部は自分で判断して進め、ユーザーに聞くのは本当に決められないときだけにする。
- **このアプリのポート**: 5890
- **slug**: `hoshi-kazoe`
- **最初にやること**: スマホのブラウザで星が写るか(露光を制御できない問題)を先に調べる。無理なら、ユーザーが撮った夜空写真(長時間露光・天体モード)を読み込む方式に切り替え、その理由をUIに正直に書く。

# リポジトリ構成と公開手順

- このワークツリーは `app-ideas` リポジトリのブランチ `hoshi-kazoe`。アプリはこのワークツリー直下に作る。
- main から引き継いだ `README.md` はこのアプリ用に書き換え、`IDEAS.md` は削除してよい(main 側には影響しない)。
- 公開用の GitHub リポジトリはアプリごとに別に作る:
  1. `gh repo create Jinshin2534/hoshi-kazoe --public`
  2. `git remote add hoshi-kazoe https://github.com/Jinshin2534/hoshi-kazoe.git`
  3. `git push hoshi-kazoe HEAD:main`(以後の更新も `git push hoshi-kazoe HEAD:main`)
- `app-ideas` 自体には push しない。リモート名はアプリの slug にして、ほかのアプリのリモートと混ぜない。
- Vercel は GitHub の `Jinshin2534/hoshi-kazoe` を連携し、main への push で自動デプロイされるようにする。
