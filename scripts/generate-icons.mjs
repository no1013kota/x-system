#!/usr/bin/env node
//
// アイコン定義の生成（T-M8-02）。
//
//   npm run icons:generate
//
// デザインは Material Symbols Outlined を指定しているが、**フォントを丸ごと配信すると3.8MB**
// あり、全ページに載せるには重すぎる。使うアイコンだけをインラインSVGとして持つ。
//
// 手で1つずつ貼ると増減のたびに漏れるので、`ICON_NAMES` を編集して再生成する形にした。
// 元データは公式パッケージ `@material-symbols/svg-400`（devDependency）。
//
import { readFileSync, writeFileSync } from "node:fs";

/**
 * 使用するアイコン（Material Symbols の名前）。
 * 実際に使っている33個（デザイン抽出41個 → lucide撤去で3個追加 → 未使用11個を棚卸し・T-M8-51）。**増やすときはここへ足して再生成する**。
 *
 * 2つはMaterial Symbols側で改名されている（パッケージ0.45系）:
 * `auto_awesome` → `star_shine` ／ `expand_more` → `keyboard_arrow_down`。
 */
const ICON_NAMES = [
  "add", "star_shine", "bolt", "check", "check_circle", "chevron_right", "close",
  "delete", "description", "drafts", "edit", "edit_square", "error", "history",
  "home", "image", "key", "lock", "monitoring", "newspaper", "notifications", "open_in_new",
  "output", "progress_activity", "radio_button_unchecked", "refresh", "schedule", "smart_toy", "tune",
  "verified_user", "warning", "account_circle", "unfold_more", "content_copy",
  // T-M8-51: 未使用11個を棚卸しした（`icon-source.test.ts` が再発を検査する）。
];

/**
 * 塗り（FILL 1）版も持つアイコン。デザインは**選択状態と完了チェック**で塗りを使う。
 * ここに挙げたものだけ `-fill` を生成する（全部作ると無駄に増える）。
 */
const FILLED_NAMES = [
  "home", "output", "newspaper", "edit_square", "schedule", "monitoring", "description",
  "tune", "check_circle",
];

const SRC = "node_modules/@material-symbols/svg-400/outlined";

/**
 * SVGから `d` 属性だけを取り出す。
 * **viewBox は `0 -960 960 960`**（Material Symbols の960グリッド。24pxではない）。
 */
function pathsOf(name) {
  const svg = readFileSync(`${SRC}/${name}.svg`, "utf8");
  const ds = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  if (ds.length === 0) throw new Error(`${name}: path が見つかりません`);
  return ds;
}

const entries = ICON_NAMES.map((name) => {
  const ds = pathsOf(name);
  return `  ${JSON.stringify(name)}: ${JSON.stringify(ds.join(" "))},`;
}).join("\n");

const filledEntries = FILLED_NAMES.map((name) => {
  const ds = pathsOf(`${name}-fill`);
  return `  ${JSON.stringify(name)}: ${JSON.stringify(ds.join(" "))},`;
}).join("\n");

const out = `// このファイルは \`npm run icons:generate\` が生成する。**手で編集しない。**
//
// アイコンを増やすときは scripts/generate-icons.mjs の ICON_NAMES へ追記して再生成する。
// 元データ: @material-symbols/svg-400（Material Symbols Outlined・960グリッド）。

/** アイコン名 → SVG の path データ。viewBox は 0 -960 960 960 を使う。 */
export const ICON_PATHS = {
${entries}
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** 塗り版（FILL 1）。選択状態・完了チェックで使う。無い名前は輪郭版のまま。 */
export const ICON_PATHS_FILLED: Partial<Record<IconName, string>> = {
${filledEntries}
};
`;

writeFileSync("src/components/ui/icon-paths.ts", out);
console.log(
  `アイコン ${ICON_NAMES.length} 個（うち塗り版 ${FILLED_NAMES.length} 個）を src/components/ui/icon-paths.ts へ生成しました。`,
);
