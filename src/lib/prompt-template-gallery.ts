import { extractPlaceholderNames } from "./post/pattern-spec";
import { generateInitialBaseMd } from "./persona-settings";
import {
  SYSTEM_DEFAULT_TEMPLATES,
  type PromptTemplateKind,
} from "./prompts/gen-prompts";

/**
 * 公開プロンプトテンプレート集（T-M8-173・運営者の指示 2026-08-21）。
 *
 * **本文はアプリが実際に使う正本から引く**（`SYSTEM_DEFAULT_TEMPLATES`＝PT-P1〜P6・PT-IMG、
 * アカウント.mdは `generateInitialBaseMd` が実際に生成する初版）。ページへ書き写さない——
 * 写すとプロンプト改定のたびに公開ページだけ古くなる。
 *
 * 実ユーザーの作成物は載せない（公開許諾の仕組みが無い・要決定D-32）。
 * 表示名・説明は投稿パターンのseed（migration `20260818000001`）と同じ日本語を使う
 * （SQLからは import できないため、ここに写して両方を変えるときは揃える）。
 */

export interface GalleryTemplate {
  /** 一覧のアンカーにも使う識別子。 */
  id: string;
  name: string;
  description: string;
  /** プロンプト全文（正本から）。 */
  content: string;
  group: "account-md" | "post" | "image";
  /** 投稿プロンプトの差し込み欄（プレースホルダー名・T-M8-178）。無い型は空配列。 */
  placeholders: string[];
}

/**
 * 既定パターンの題名と説明。**プレースホルダーはここに書かない**（T-M8-317）。
 *
 * 以前は `placeholders: string[]` を手で並べ「変えるときは両方揃える」と注記していたが、
 * T-M8-210 で PT-P1 へ `{ニュース}` を足したときに**この表だけ追随せず**、プロンプト集の
 * ニュース解説だけプレースホルダーが出ない状態になっていた（2026-08-26 に運営者が発見）。
 * 揃える先が2つある限り同じズレは再発するので、**本文から導出する**。
 */
const POST_PATTERN_INFO: {
  kind: PromptTemplateKind;
  name: string;
  description: string;
}[] = [
  { kind: "p1", name: "ニュース解説", description: "話題のニュースを解説するスレッド" },
  { kind: "p2", name: "自分の考え・意見", description: "本人の視点で述べる単発ポスト" },
  { kind: "p3", name: "ノウハウ・ハウツー", description: "今日から実践できる手順スレッド" },
  { kind: "p4", name: "トレンド便乗", description: "いま話題のトピックに便乗する短いスレッド" },
  { kind: "p5", name: "引用ポスト", description: "対象ポストへの引用（URL付き投稿）" },
  { kind: "p6", name: "週次まとめ", description: "直近7日の関連ニュースまとめ" },
];

/** サンプルのアカウント.md初版を、実際の生成関数で作る（構造・見出しが常に実物と一致する）。 */
function sampleBaseMd(): string {
  return generateInitialBaseMd({
    ng: {
      rules: ["数字・固有名詞は出典を確認してから使う"],
      topics: ["政治・宗教"],
      words: [],
    },
    persona: {
      speaker: "AIツールを日常業務に取り入れている個人事業主",
      audience: "AI活用に興味はあるが、何から始めるか迷っている個人・小規模事業者",
      value: "今日から試せる具体的なAI活用の手順と、失敗しない選び方",
    },
    themes: { primary: ["ai"], secondary: ["sns"] },
    tone: {
      emoji_max_per_post: 1,
      emoji_policy: "limited",
      first_person: "私",
      hashtags_max: 0,
      sentence_style: "です・ます調",
      thread_numbering: true,
    },
  });
}

export function galleryTemplates(): GalleryTemplate[] {
  return [
    {
      id: "account-md",
      // 表示名は「アカウント.md」に統一（T-M8-182・運営者の指示。「発信定義書」は
      // 実ファイルの1行目の見出し（persona-settings.ts）だが、一覧の題名には使わない）。
      name: "アカウント.md",
      description:
        "アカウント自体の説明。誰として・誰に・どんな口調で発信するかをAIへ指示します。",
      content: sampleBaseMd(),
      group: "account-md",
      placeholders: [],
    },
    ...POST_PATTERN_INFO.map(({ kind, name, description }) => ({
      id: kind,
      name,
      description,
      content: SYSTEM_DEFAULT_TEMPLATES[kind],
      group: "post" as const,
      // **本文が正本**。投稿作成画面の入力欄と同じ関数で導出する（要件06 §SC-07）。
      placeholders: extractPlaceholderNames(SYSTEM_DEFAULT_TEMPLATES[kind]),
    })),
    {
      id: "image",
      name: "画像生成プロンプト",
      description: "投稿本文に合わせて、添える画像の生成指示を組み立てるプロンプトです。",
      content: SYSTEM_DEFAULT_TEMPLATES.image,
      group: "image",
      placeholders: [],
    },
  ];
}
