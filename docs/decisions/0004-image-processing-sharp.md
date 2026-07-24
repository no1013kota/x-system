# ADR-0004: 画像正規化ライブラリに sharp を採用

- Status: Accepted
- Date: 2026-07-24

## Context

GEN-IMG（プロンプト設計書 §5.5・要件06 §6）では、画像プロバイダ（OpenAI／Gemini）が返した画像をデコードし、形式・実寸・MIME・容量を検証したうえで、X へ投稿可能な形式（JPG/PNG/WEBP）かつ 5MB 以下へ変換・圧縮する必要がある。Node の標準APIだけではデコード・実寸取得・再エンコード・リサイズができないため、画像処理ライブラリの採用が必要になった。

## Decision

- 画像のデコード・メタデータ取得（実フォーマット／実寸）・形式変換・品質圧縮・リサイズに `sharp` を採用する（`src/lib/ai/image-normalize.ts`）。
- `sharp` は Next.js（`next/image` 最適化）の依存として既に node_modules に存在するため、追加の native binary 取得は不要。直接依存として `package.json` に明記し、lockfile の root dependency へ昇格させた。
- 正規化仕様：許可形式（JPG/PNG/WEBP）かつ 5MB 以下ならそのまま返す。超過・未対応形式のときだけ再エンコードし、JPEG/WEBP は品質低下→縮小、PNG は縮小のみで 5MB 以下へ収める。収まらなければ検証エラー（`too_large_after_compression`）。
- プロバイダ差異（OpenAI の pixel size 文字列 / Gemini の aspect ratio 文字列）は画像アダプタ（`src/lib/ai/image.ts`）へ閉じ込め、共通仕様はアスペクト比のみとする。正規化層はプロバイダ非依存に保つ。

## Consequences

- Vercel の Linux ランタイムでは Next.js 同梱の sharp binary が利用でき、追加運用は不要。ローカル（macOS）でも既存 binary で動作する。
- native 依存のため、Node バージョンや実行プラットフォームを変える場合は sharp の対応 binary を要確認。
- 画像の再エンコードは job worker（画像生成ジョブ）内で完結し、Deadline 内で実行する。極端に大きい入力は縮小回数が増えるため、上限試行回数（16回）で打ち切り検証エラーにする。

## Alternatives

- `jimp`（純JS）は native 依存を避けられるが、WEBP 出力・処理速度・品質制御で sharp に劣り、5MB 収束の圧縮ループが遅くなるため不採用。
- 外部画像変換 API への委譲は、追加のネットワーク往復・費用・秘密管理が増え、画像バイトを外部へ送る必要が生じるため不採用。
