# ADR-0006: UIデザイン基盤（トークン・フォント・アイコン・共通部品）

- Status: Accepted
- Date: 2026-08-03

## Context

M8 で既存画面の**見た目だけ**を新デザイン（`design_handoff_spaceai_ui/`）へ置き換えた。機能・API・データ取得・ルーティングは変えていないため要件定義の記述はほとんど変わらないが、**どこに値を置くか・何を単一の正とするか**という技術判断が多数含まれる。これらは要件定義（画面仕様）にもプロンプト設計書にも属さないため、ここへ記録する。

前提として、リポジトリは Tailwind CSS v4（CSS-first・`tailwind.config.*` を持たない）と shadcn/ui（`style: "base-nova"`／Base UI）を使う。

## Decision

**1. デザイントークンは `src/app/globals.css` の CSS変数に一元化する。** 色・角丸・影・トランジションを `--brand` / `--ink` / `--hairline` / `--radius-card` などで定義し、`@theme inline` で Tailwind のユーティリティへ流す。画面側に生の16進数やpx値を書かない。

**2. shadcn由来の汎用トークンは新デザインの値へ向ける**（`--muted-foreground` → `--ink-2`、`--card` → `--surface`、`--primary` → `--brand`、`--radius` → 8px など）。呼び出し側を1つずつ書き換えるより漏れが出ない。既存のトークン名は消さない（未対象の画面が参照している）。

**3. フォントは `next/font/google` で自前配信する。** CSPが `font-src 'self' data:` / `style-src 'self' 'unsafe-inline'` のため Google Fonts のCDNからは読めない（ADR-0005）。日本語は Noto Sans JP、英数・数値は Inter。**日本語フォントに `subsets` を指定しない**（`["latin"]` を指定すると日本語グリフが入らずフォールバックする）。`preload: false` にして unicode-range 分割配信をブラウザへ任せる。

**4. アイコンは可変フォントではなくインラインSVG。** Material Symbols の可変フォントは3.8MBで重すぎる。使う33個（＋塗り8種）だけを `@material-symbols/svg-400` から抽出し、`src/components/ui/icon-paths.ts` へ生成する（`npm run icons:generate`）。**`lucide-react` は撤去した**（T-M8-45。同じ意味のアイコンが2つの描画系統で並び、線幅とグリッドが揃わないうえ、クライアントバンドルにアイコンライブラリが1つ余分に載っていた）。**アイコン名の打ち間違いは実行時に空のSVGになるだけで気付けない**ため、`Icon` の `name` は `IconName`（`icon-paths.ts` から導出したunion）で受ける。リテラルの打ち間違いは typecheck で落ち、`as IconName` のキャストはリポジトリに0件。動的に渡すナビ項目だけは `navigation-items.test.ts` が定義の実在も検査する。
  さらに `icon-source.test.ts` が (a) `lucide-react` を import・依存に戻していないこと、
  (b) `name` のリテラルが定義に実在すること、(c) **使っていないアイコンを溜めていないこと**を
  リポジトリ全体で検査する（41個抽出のうち11個が誰にも使われず残っていた・T-M8-51）。
  **`components.json` の `iconLibrary` は `lucide` のまま**なので、shadcn MCP で部品を足すと
  lucide を import したコードが入ってくる。(a) がその入口で止める。

**5. 「同じものを2か所で描かない」を徹底する。** 器（Card。`as` で `section` にでき、見出しを持つ領域は landmark を保つ）・状態チップ（Badge。**tone は prop で渡す**。className へ文字列展開すると存在しないユーティリティになり色が消える——`badge-tone.test.ts` が機械的に禁止する）・テーマチップ（CategoryChip。ラベルは自分で引く）・インラインバナー（`ui/notice.tsx`。**危険色は1系統**——`bg-destructive/*` はボタンの塗りだけに許し、`notice.test.ts` が機械的に検査する）・空状態／ロック状態（`page-state.tsx`）・パターン選択（`pattern-radio-group.tsx`）・パターンの選択肢とラベル（`lib/post/post-patterns.ts`）・リンクをボタンに見せるクラス（`ui/link-button.ts`）・**失敗した下書きの可否判定**（`lib/post/draft-actions.ts`。`.tsx` は単体テストの網に入らないため純関数へ出す）を単一の正とする。M8 の作業中、**同じパターンの定義が3か所に散ってラベルまで違っていた**（「自分の考え」/「自分の考え・意見」）例が実際にあった。

**6. 操作結果の通知はトーストへ集約する**（要件06 §2.1）。判断（読み上げ種別・自動で消えるか）は `toast-policy.ts` の純関数へ出し、DOMを持たない単体テスト（`environment: node`）で固定する。

**7. デスクトップ最適化を優先する**（2026-08-02 決定）。1画面あたりの縦の長さを詰め、幅の広い画面で2カラムにできるものは2カラムにする。モバイル幅は「横に伸びない」ことを保証する範囲で維持する（`horizontalOverflow` のE2E）。

## Consequences

- 配色・角丸・影の変更はトークン1か所で済む。反面、**CSS変数名の誤りは静的検査を素通りする**（`--gradient-brand` と書いてプレミアムのタグが透明になった実例がある）。**実ブラウザでの目視確認が最後の砦**であり、E2Eと型検査では代替できない。
- Tailwind v4 のため設定ファイルが無く、トークンの一覧性は `globals.css` を読むことに依存する。
- 33個のアイコンで足りなくなったら `scripts/generate-icons.mjs` の一覧へ足して再生成する（手で `icon-paths.ts` を編集しない）。
- 共通部品へ寄せたことで、1つの変更が複数画面へ同時に効く。**変更時は使用箇所を `rg` で確認する**（2026-08-04時点で `Badge` は18ファイル・8画面、`Notice` は9ファイル、`CardTitle` は19ファイル、`PatternRadioGroup` は2画面が使う）。**この数は増える前提で、正は `rg` の結果**——ここに書いた数字は「小さいと思って触ると広く影響する」ことの目安にすぎない（T-M8-44 でチップを寄せた結果 `Badge` が5画面→8画面へ増え、この行の更新が漏れていた）。
