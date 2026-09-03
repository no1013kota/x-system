/**
 * /new（先行公開LP・T-M8-419）のヒーロー「分解ダイアグラム」用に、既存の実画面スクショ
 * public/lp-shots/*.jpg から UI 片を切り出す。生スクショを丸ごと置かず、型のカード・
 * スケジュールの行・ニュースカード1枚だけをガラス板に載せるための素材。
 *
 * 実行: `node scripts/lp-new-crops.mjs`（package.json の script にはしない。元画像を
 * 差し替えたときだけ1回走らせ、生成物 public/lp-new/hero-*.jpg をコミットする）。
 * 座標は 1600px 幅の元画像基準。
 *
 * 注意: 稼働中の `next dev` は最適化済み画像（webp）をメモリに保持し、元ファイルを書き換えても
 * 同じURLには古い画像を返し続ける（2026-09-03 に確認）。切り出しを変えたら dev サーバを
 * 再起動するか、出力名を変える。本番ビルドは毎回作り直すので影響しない。
 *
 * 切り出しは「狭く切って大きく見せる」: 表示幅 560px に対して元の幅を 600〜780px にし、
 * 文字が 11px 以上で読めるようにする（幅 1176〜1200px で切っていたときは 6〜8px で読めなかった）。
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "public", "lp-shots");
const OUT = path.join(ROOT, "public", "lp-new");

/** [出力名, 元画像, left, top, width, height] */
const CROPS = [
  // 投稿作成: 型のカード 2×2（ニュース解説・自分の考え・意見／トレンド便乗・週次まとめ）
  ["hero-patterns.jpg", "compose-hero.jpg", 336, 262, 780, 184],
  // スケジュール: 設定済みの枠2行（自動投稿バッジ・曜日と時刻・次回の実行時刻）
  ["hero-schedule.jpg", "schedule.jpg", 326, 528, 600, 160],
  // 最新ニュース: カード1枚。第三者記事の要約が主画像になるのを避け、企業の公式発表を要約したカードを選ぶ
  ["hero-news.jpg", "news.jpg", 933, 755, 594, 220],
];

for (const [name, source, left, top, width, height] of CROPS) {
  const out = path.join(OUT, name);
  await sharp(path.join(SRC, source))
    .extract({ left, top, width, height })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`${name}: ${meta.width}x${meta.height}`);
}
