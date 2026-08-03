import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright artifacts (E2E, T-M7-05)
    "test-results/**",
    "playwright-report/**",
    // デザインリファレンス（T-M8-01）。`support.js` はプレビュー用ランタイムで移植対象外。
    // 我々が保守するコードではないため検査しない（React 18以前の書き方を含む）。
    "design_handoff_spaceai_ui/**",
  ]),
  {
    // Playwright fixtures take a `use` callback that the React hooks rules
    // mistake for a hook. These files never run in React.
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  {
    // 引数なし `catch {}` は例外を完全に捨てるため、原因が画面にもログにもDBにも残らない。
    // 2026-07-26 のX連携不具合（service_role の GRANT 漏れ）がこれで追跡不能になった。
    // 利用者に面する境界（Server Action / API Route）では error を受け取り、未知の失敗は
    // `recordUnexpectedError` で記録するか、記録しない理由をコメントで宣言して disable する。
    files: ["src/app/actions/**/*.ts", "src/app/api/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CatchClause[param=null]",
          message:
            "catch は error を受け取ってください。未知の失敗は recordUnexpectedError() で記録し、記録しない場合は理由をコメントに書いて eslint-disable で明示してください。",
        },
      ],
    },
  },
  {
    // src/lib も同じ基準。既存の検証系（URL/JSONのparse等、失敗が答えのもの）は理由を書いた
    // eslint-disable で宣言済みなので、新規の無宣言な握りつぶしはここで止まる。
    files: ["src/lib/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CatchClause[param=null]",
          message:
            "catch が error を捨てています。未知の失敗なら recordUnexpectedError() で記録してください（失敗自体が答えの検証処理なら意図をコメントに残してください）。",
        },
      ],
    },
  },
]);

export default eslintConfig;
