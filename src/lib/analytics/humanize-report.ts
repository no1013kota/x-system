
/**
 * 分析レポートの本文を、運営者が読める日本語へ直す（T-M8-114）。
 *
 * レポートを書くのはAIで、渡している投稿データの項目名は英語（`impressions`・`likes`）、
 * 型は内部ID（`p1`）。**AIはそれをそのまま本文へ書き写す。** 実際に出ていた例:
 *
 *   「6月8日のスレッド（冒頭41impressions）が最高パフォーマンスであり、スレッド型（p1）は…」
 *   「速報系（2045460385856377140等の週次まとめ）は画像付きが目立つ」
 *
 * 運営者は非エンジニアで、`impressions` も `p1` も投稿IDも読めない。プロンプト側でも
 * 日本語で書くよう指示しているが、**指示だけでは守られない前提で組む**（開発とテストの進め方 §12）。
 * ここが最後の関門で、素通りさせない。
 *
 * **変換するのは物語部分だけ**（総評・良かった理由・推奨の理由）。貼り付けて使う
 * アカウント.md本文と生成プロンプト本文には**適用しない**——あちらは利用者が保存する成果物で、
 * 書かれた通りに渡すのが正しい。
 */

/** 英語の項目名 → 日本語。長い語を先に置く（`has_image` が `image` より先に当たるように）。 */
const TERMS: [RegExp, string][] = [
  // 「41impressions」「227 impressions」のように数値とくっつく形。単位を後ろへ回す。
  [/(\d[\d,]*)\s*impressions?/gi, "表示$1回"],
  [/(\d[\d,]*)\s*likes/gi, "いいね$1件"],
  [/(\d[\d,]*)\s*reposts/gi, "リポスト$1件"],
  [/(\d[\d,]*)\s*replies/gi, "返信$1件"],
  // 単独で出てくる形。
  [/new_posts_since_previous/g, "前回以降の新規投稿数"],
  [/posted_at_jst/g, "投稿日時"],
  [/created_at_jst/g, "前回レポートの作成日時"],
  [/engagement[ _]rate/gi, "反応率"],
  [/has_image/g, "画像の有無"],
  [/has_url/g, "リンクの有無"],
  [/account_md/g, "アカウント.md"],
  [/good_posts/g, "良かった投稿"],
  [/impressions?/gi, "表示回数"],
  [/\blikes\b/gi, "いいね"],
  [/\breposts\b/gi, "リポスト"],
  [/\breplies\b/gi, "返信"],
];

/**
 * **2026-08-18 より前に作られたレポートのための対応表**（T-M8-129 U3）。
 *
 * それ以降の改善提案（PT-SUGGEST）はパターンの**名前**を出すので変換は不要。
 * 過去のレポートには内部ID（`p1`）が本文に残っているため、当時の名前へ直して読めるようにする。
 * **利用者が名前を変えても過去のレポートの表記は変わらない**——当時どの型だったかを示す記録なので、
 * 現在の名前に合わせて書き換えると履歴が事実と食い違う。
 */
const LEGACY_PATTERN_LABELS: Readonly<Record<string, string>> = {
  p1: "ニュース解説",
  p2: "自分の考え・意見",
  p3: "ノウハウ・ハウツー",
  p4: "トレンド便乗",
  p5: "引用ポスト",
  p6: "週次まとめ",
};

/** 旧レポートに残る内部ID（`p1`）を当時の名前にする。未知の値はそのまま返す。 */
export function legacyPatternLabel(value: string): string {
  return LEGACY_PATTERN_LABELS[value] ?? value;
}

/**
 * 型の内部ID（p1〜p6）を日本語名にする。**旧レポートのみが対象**。
 *
 * 日本語には単語の区切りが無いので `\b` が効かない。**英数字が続いていないこと**だけを条件にし、
 * 「p1」「（p1）」「p1型」に当て、「p10」「gpt-p1x」のような別語には当てない。
 */
function patternIds(text: string): string {
  return text.replace(/(^|[^0-9A-Za-z_])p([1-6])(?![0-9A-Za-z_])/g, (all, head: string, n: string) => {
    const label = LEGACY_PATTERN_LABELS[`p${n}`];
    return label ? `${head}${label}` : all;
  });
}

/**
 * 本文に紛れ込んだXの投稿ID（17〜20桁の数字）を消す。
 *
 * 桁数で判定する。表示回数やいいね数がこの桁数になることは無く、
 * **年月日（8桁）や金額とも重ならない**。IDを見せても運営者には何も分からないので、
 * 「ある投稿」と言い換える（消すだけだと文がつながらない）。
 */
function tweetIds(text: string): string {
  return text.replace(/(^|[^0-9])(\d{17,20})(?![0-9])/g, (_all, head: string) => `${head}ある投稿`);
}

/**
 * 型名を入れた直後の重複を畳む。
 *
 * AIは「ニュース解説スレッド型（p1）」のように、日本語の説明とIDを並べて書く。IDを名前に
 * 置き換えると「ニュース解説スレッド型（ニュース解説）」になり、かえって読みにくい。
 * **直前に同じ名前がある括弧書きは落とす**（言い換えとして意味が無いため）。
 */
function dropRedundantLabel(text: string): string {
  return text.replace(/[（(]([^（()）]{1,20})[）)]/g, (all, inner: string, offset: number) => {
    const before = text.slice(Math.max(0, offset - inner.length - 6), offset);
    return before.includes(inner) ? "" : all;
  });
}

/** レポートの物語部分（総評・理由）を日本語へ直す。空文字はそのまま返す。 */
export function humanizeReportText(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [re, to] of TERMS) out = out.replace(re, to);
  out = patternIds(out);
  out = tweetIds(out);
  out = dropRedundantLabel(out);
  return out;
}
