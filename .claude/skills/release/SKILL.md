---
name: release
description: 変更を staging → 本番へ反映する一連の手順。CI の要否を差分から判断し、push は1回、release:staging → PR → release:production → 実ブラウザ確認まで。/release で本番まで、/release staging で staging まで。
model: inherit
---

# release：staging と本番へ反映する

運営者から受けた依頼を**全部終えてから**1回だけ実行する。途中のタスクはローカルにコミットを積み、ここでまとめて push する（CI は push ごとに約14分走るため）。

## 0. 前提を確かめる（1つでも欠けたら止まる）

- `git status --porcelain` が空。ブランチは `stg`。
- 各タスクで CLAUDE.md「変更影響 → 必須の検証」の該当行を実行済み（未実行の行は報告に書く）。
- `npm run typecheck && npm run lint && REQUIRE_DB=1 npx vitest run` が緑（直近の変更後に1回）。
- `release:*` は **sandbox 外**で実行する（node の fetch が sandbox 内では DNS に失敗する）。
- 引数 `staging` なら手順4で終える。

## 1. CI の要否を決める（判断ではなく対応表で）

`git diff --name-only origin/main...HEAD` の全ファイルを次の表に当てる。**1つでも「必要」に当たれば CI を回す。表のどちらにも当たらないファイルがあれば「必要」**。運営者が「CI なしで」と言っていても、「必要」に当たる変更なら理由を添えて CI を回す（逆に運営者が「CI ありで」と言えば従う）。

| 変更したファイル | CI |
|---|---|
| `src/**`・`supabase/**`・`e2e/**`・`package.json`・`package-lock.json`・`next.config.*`・`tsconfig*.json`・`vitest.config.*`・`playwright.config.*`・`.github/workflows/**`・`scripts/**`（`dev-kit.mjs`・`blog-image.mjs`・`blog-check.mjs` を除く）・`public/**`（`public/blog-images/**` を除く）・`.env.example`・`vercel.json` | **必要** |
| `docs/**`・`tasks/**`・`blog/**`・`public/blog-images/**`・`.claude/**`・`kit/**`・`scripts/dev-kit.mjs`・`scripts/blog-image.mjs`・`scripts/blog-check.mjs`・ルートの `*.md`（`CLAUDE.md`・`AGENTS.md`・`README.md`）・`.gitignore`・`.mcp.json` | 不要（`npm run blog:check`・`check:doc-dates`・`check:doc-refs`・単体テストが緑であること） |

「不要」なら、軽量化の印を HEAD に付ける（コミットを書き換えない）。CI は走るが `release:check` の本体（build・E2E）を飛ばし、型検査・lint だけで約2分で緑になる。**GitHub 公式の省略の印（skip ci 等）は使わない**——workflow ごと止まり、必須チェックが報告されず PR がマージできない（2026-09-05 に実際に起きた）。

```bash
git commit --allow-empty -m "chore(release): CI 軽量化（<理由: docs・ブログのみ 等>） [light ci]"
```

## 2. push（1回だけ）

```bash
git push origin stg
```

## 3. CI を待つ（「必要」なら約14分、軽量化なら約2分）

Monitor で `gh run list --branch stg --json headSha,status,conclusion` を HEAD の SHA で突き合わせ、`completed success` まで待つ（約14分）。赤なら **ここで止めて原因を直す**（`gh run view <id> --log-failed`）。直したら手順0からやり直す。

## 4. staging

```bash
npm run release:staging -- --apply     # migration があれば「適用 → もう1回」の2回
```

出力の8項目と「デプロイ後の検証」（人間確認・実物スモーク）を読む。❌ があれば止まる。軽量化した場合も CI は緑になるので「自動テスト（CI）: 緑です」と出る。「CI 結果が見つかりません」なら push 漏れか印の誤りを疑う。
Vercel の build がまだなら「まだbuild中です」で止まるので、1〜2分待って再実行する。

## 5. PR → main

```bash
gh pr create --base main --head stg --title "release: <内容>（T-…）" --body "<内容・検証・migration の有無>"
gh pr merge <URL> --merge --delete-branch=false
git checkout main && git pull -q origin main
```

main の Vercel status が `success` になるまで待つ（`gh api repos/no1013kota/x-system/commits/<sha>/status`、15秒間隔・最大8分）。`failure` なら止めて `npx vercel inspect` でログを見る。

## 6. 本番

```bash
npx supabase link --project-ref hvjizoahdqfvasiqzzkv      # 本番
npm run release:production -- --apply                       # migration があれば2回
npx supabase link --project-ref uykffujqpsogqffbnsrz      # staging へ戻す（戻し忘れると次の staging 反映が本番 DB を見る）
git checkout stg
```

## 7. 実ブラウザで確認する

変更した画面を https://exosai.net で開く。Playwright の一時スクリプトはリポジトリ直下に置き、**終わったら消す**（残ると次の release ゲートが「未コミットの変更」で止まる）。見るもの: HTTP 200・コンソールエラー 0・失敗リクエスト無し・画像やグラフが描画されている（遅延読み込みはスクロールしてから判定）。

## 8. 報告

PR 番号・本番 URL・確認した画面・**CI の要否とその理由**・migration の有無・実物スモークの費用・所要時間・省略したものと理由。

## ルール

- 本番 DB へは `release:production` 以外で書かない（読むのは可）。
- force push・`git add -A`・コミットの書き換え（amend/rebase）をしない。軽量化の印は空コミットで足す。
- 途中で ❌ が出たら次の手順へ進まない。原因を直してから手順0へ戻る。
- **コミットメッセージに角括弧付きの GitHub 公式の省略の印（skip ci など）を書かない**（本文で言及するときも角括弧を外す）。GitHub はメッセージ全体を見て workflow ごと止め、必須チェックが報告されず PR がマージできない。2026-09-05、説明として本文に書いただけで必要な CI が走らなかった。軽量化の印（light ci）も本文には書かず、空コミットの件名にだけ付ける。
- 所要の目安: CI あり 約30分（CI 14＋反映12＋確認4）、軽量化 約18分。
