---
name: ui-polish
description: Space AIのNext.js画面・Reactコンポーネントを新規作成/更新し、デザイン品質・レスポンシブ・主要UI状態・アクセシビリティ・実ブラウザ検証まで一貫して行う。ユーザー向けUIの実装・改善・レビュー時に使う。
---

# UI polish

仕様と既存デザインシステムを守ってUIを実装し、実ブラウザで完成状態まで確認する。

## 手順

1. **正本と既存を読む**: 対象画面の `docs/PRD.md`・`docs/requirements/06_screens_onboarding_posting.md`・関連API要件と、対象route・親layout・`src/components/ui/`・`src/app/globals.css`・`components.json` を確認。既存コンポーネントとデザイントークンを最優先し、任意値を増やさない。新規部品が要るときは shadcn MCP でレジストリを検索してから作る。

2. **方針を一言で決める**: 目的・主利用者・最優先アクション・情報階層。新規画面は美的方向を一つ選び、既存更新は現行システムとの一貫性を優先する。

3. **実装**: App Router／Server・Client境界／Tailwind 4／shadcn/ui の既存構成に従う。色・余白・角丸・影は CSS変数か既存ユーティリティを使う。該当する状態（hover / focus-visible / disabled / loading / empty / error / success）を実装。主要導線は WCAG 2.2 AA（キーボード操作・明瞭なfocus・label・色以外の状態表現）。`prefers-reduced-motion` を尊重。仕様や画面挙動を変えたら同じ作業で正本docsを更新する。

4. **実ブラウザ検証**（実装だけで完了にしない）:
   - `npm run dev` を起動し **`http://127.0.0.1:3000`** を使う（`localhost` は `allowedDevOrigins` により HMR が弾かれる）。
   - Next.js DevTools MCP があればランタイム／ビルド／Hydration エラーを確認。
   - 認証必須画面はテストユーザーでログインして開く（playwright-cli の storage-state 参照）。
   - Playwright CLI で Desktop 1440 / Tablet 768 / Mobile 390 のスクショを取り、該当テーマ・主要状態・キーボード導線を確認。
   - 横スクロール・重なり・文字切れ・focus/label欠落・色依存の状態・コンソールエラー・レイアウトシフトを潰し、同条件で再確認する。スクショ/traceはコミットしない。

5. **報告**: 方針・再利用/追加した部品とトークン・確認した幅/テーマ/状態・修正点・未解消事項。未解消があれば完了扱いにしない。
