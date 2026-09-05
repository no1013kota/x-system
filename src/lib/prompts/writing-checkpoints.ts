/**
 * 書き方のチェックポイント（T-M8-447・運営者の指示 2026-09-06）。
 *
 * アカウント.md（発信定義）に利用者がチェックボックスで取り込める汎用の条項。2群ある:
 * - `ai`: AIっぽさを消す（人が書いた文にする）
 * - `buzz`: 伸びる投稿の型
 *
 * **文面の正本はここ**。DB（`x_accounts.writing_checkpoints`）には選んだ条項の ID だけを持ち、
 * 生成時に `renderWritingCheckpoints` が `<base_md>` の末尾へ「## 書き方のチェックポイント」として付ける
 * （`gen-context.ts`）。本文へ物理的に書かないので、学習の反映や本棚の切替で消えず、文面を直せば
 * 全利用者へ届く。SYS-GEN（共通指示）に既にある規則（ハッシュタグ禁止・本文にURLを書かない・改行・
 * 誇張禁止・文体の統一）はここに入れない（二重に指示しない）。
 */

export type WritingCheckpointGroup = "ai" | "buzz";

export interface WritingCheckpoint {
  /** 保存用の ID（`ai-1` / `buzz-1` の形）。並び順は配列順。 */
  id: string;
  group: WritingCheckpointGroup;
  /** 画面のチェックボックス名（短い名詞止め）。 */
  label: string;
  /** 利用者向けの一言（なぜ効くか）。 */
  description: string;
  /** AI へ渡す条項（命令形・具体的）。 */
  instruction: string;
}

export const WRITING_CHECKPOINT_GROUPS: Record<
  WritingCheckpointGroup,
  { title: string; lead: string }
> = {
  ai: {
    title: "AIっぽさを消す",
    lead: "人が書いた文に見せるための条項。常套句や整いすぎた構成を避けます。同時に選ぶのは3〜4件が目安（多いと文が硬くなります）。",
  },
  buzz: {
    title: "伸びる投稿の型",
    lead: "反応と保存を呼びやすい構成の条項。1行目と締めを強くします。同時に選ぶのは3〜4件が目安。",
  },
};

export const WRITING_CHECKPOINTS: readonly WritingCheckpoint[] = [
  {
    id: "ai-1",
    group: "ai",
    label: "常套句の禁止",
    description: "「重要なのは」「まとめると」のような段取りの言葉はAI文の目印",
    instruction:
      "次の言い回しを使わない: 「重要なのは」「結論から言うと」「〜することができます」「〜が重要です」「〜が求められます」「〜も少なくありません」「まとめると」「以上のことから」「〜とは何か。それは〜」。具体的な動詞と目的語で言い直す。",
  },
  {
    id: "ai-2",
    group: "ai",
    label: "AI語と定番比喩の禁止",
    description: "「最大化」「羅針盤」のような飾りの語はAIの癖に見える",
    instruction:
      "「最大化」「シームレス」「革新的」「ポテンシャル」「マインドセット」「〜を加速」「鍵となる」「深掘り」「価値提供」「〜という名の」「羅針盤」「〜の扉を開く」「魔法のように」「〜という武器」を使わない。比喩はスレッド全体で1つまで。",
  },
  {
    id: "ai-3",
    group: "ai",
    label: "断定には根拠か体験",
    description: "根拠の無い断定は疑われる。「意見は言い切り」と対で使う",
    instruction:
      "「〜すべき」「〜が正解」のような主張には、発信定義書か素材（<user_input>・検索結果）にある体験・数字・出典名を1つ同じポストに添える。無ければ作らず、その主張を削る（締めの一言は除く）。",
  },
  {
    id: "ai-4",
    group: "ai",
    label: "ぼかし語と抽象名詞の禁止",
    description: "「多くの人」「価値」「本質」が続く文は中身が無く誰でも書ける",
    instruction:
      "「多くの人」「ある企業」「様々な」「〜と言われている」を根拠代わりに使わず、数量・時期・対象名は素材にあるときだけ書き、無ければその文を削る。「価値」「本質」「成長」のような抽象名詞を1文に2つ以上並べず、具体的な行動・物・数字で言う。",
  },
  {
    id: "ai-5",
    group: "ai",
    label: "主張の言い直し禁止",
    description: "冒頭の主張を末尾で繰り返すのはAIの癖",
    instruction:
      "一度書いた主張を、言い方を変えてスレッド全体で繰り返さない。末尾に冒頭をまとめ直す段落を置かず、最後は新しい情報（具体例・条件・例外）か、読者への問いまたは冒頭と別の角度の言い切りで終える。",
  },
  {
    id: "ai-6",
    group: "ai",
    label: "箇条書きは1か所まで",
    description: "記号の羅列は要約に見えて、その人の声が消える",
    instruction:
      "箇条書きは1ポストに1か所までとし、その直前に箇条書きでない文を1つ以上置く。理由・感想・経緯のように文でつなげて書ける内容は箇条書きにしない（パターンが指定する目次・事実の列挙は除く）。",
  },
  {
    id: "ai-7",
    group: "ai",
    label: "同じ形の繰り返し禁止",
    description: "3つ並べや同じ語尾・接続詞の連続は機械の拍子に聞こえる",
    instruction:
      "「速く、安く、簡単に」のように語を3つ機械的に並べない（並べるなら1つ削る）。同じ語尾（〜です／〜ます／体言止め）を3文以上続けず、「また」「さらに」「しかし」「一方で」で始まる文と「〜ではなく〜」の対句はスレッド全体で合計2回まで。",
  },
  {
    id: "ai-8",
    group: "ai",
    label: "定型の呼びかけ・締めの禁止",
    description: "「必見」「参考になれば」は広告や記事の締めに見える",
    instruction:
      "「〜な人は必見」「知っておきたい」「〜する方法を解説します」「今回は〜について」「参考になれば幸いです」「ぜひ試してみてください」「フォローお願いします」「一緒に頑張りましょう」「応援しています」「以上です」を使わない。",
  },
  {
    id: "ai-9",
    group: "ai",
    label: "見出し風の装飾の禁止",
    description: "太字はXで効かず、行頭の絵文字と「！」の連発が浮く",
    instruction:
      "太字（**）・「#」・「ポイント①」の見出し行を作らず、行頭の記号・絵文字（■▼★→✅🔥）を2行以上続けない（パターンが指定する「■ 補足」「※」「①」は除く）。絵文字はスレッド全体で1つ、感嘆符は1ポスト1個までにし「！！」は使わない。",
  },
  {
    id: "ai-10",
    group: "ai",
    label: "意見は言い切り",
    description: "「人による」「一概には言えない」は誰の心にも刺さらない",
    instruction:
      "根拠を添えた意見は「〜と言えるでしょう」「〜ではないでしょうか」「〜と考えられます」でぼかさず言い切る。「人による」「一概には言えない」「ケースバイケース」で結論を避けず、立場を1つ取り、当てはまらない条件は「〜の人は除く」と1文で切る。",
  },
  {
    id: "buzz-1",
    group: "buzz",
    label: "1行目は30字で完結",
    description: "スマホでは冒頭しか見えず、続きを読むかはそこで決まる",
    instruction:
      "1行目は角括弧ラベル込みで全角30字以内にし、「〜について」「〜の話」「〜3選」「〜まとめ」のように題目だけ置いて2行目を読ませる形にしない。結論→理由→具体の順で書き、経緯から始めて結論を最後に置かない。",
  },
  {
    id: "buzz-2",
    group: "buzz",
    label: "前提と反転を1行目に",
    description: "何が覆されたか分かって初めて意外性になる",
    instruction:
      "意外性を狙うときは、読者が信じている前提と覆しの両方を1行目に入れる（例「◯◯は△△と言われるが、実際は◇◇」）。前提を書かずに「実は」だけで始めず、覆した根拠は同じポストに置く。",
  },
  {
    id: "buzz-3",
    group: "buzz",
    label: "読者の場面を1つ",
    description: "「自分のことだ」と思えた投稿は反応されやすい",
    instruction:
      "読者が自分のことだと思える場面（いつ・どこで・何に困っているか）を1つ、2行以内で描く。対象を「初心者」「経営者」のような属性名で呼ばず、行動や状況で示す。",
  },
  {
    id: "buzz-4",
    group: "buzz",
    label: "数値の目安か比較",
    description: "設定値・金額・AとBの比較は後で見返されやすい",
    instruction:
      "助言には、設定値・金額・回数の目安、または2つを並べた比較（AとBで何が違うか）のどちらかを1つ入れる。数字は素材（<user_input>・検索結果）で確認できたものだけを使い、目安も比較も書けない助言は削る。",
  },
  {
    id: "buzz-5",
    group: "buzz",
    label: "引用できる一文",
    description: "切り取って貼れる短文は引用されやすい",
    instruction:
      "1行目か締めの1文を、それだけ引用しても意味が通る全角25字以内の言い切りにする（別に足さない）。数字・固有名・具体的な動作を1つ含め、「◯◯がすべて」「◯◯こそ正義」のような格言風の抽象文にしない。",
  },
  {
    id: "buzz-6",
    group: "buzz",
    label: "主張は1つ",
    description: "伝えたいことが2つあると両方が薄まる",
    instruction:
      "スレッド全体（単発ならそのポスト）で伝える主張は1つに絞る。主張が2つ以上浮かんだら1つを削り、主張に関係しない別の話題・注意書き・宣伝を足さない（各ポストは1トピック）。",
  },
  {
    id: "buzz-7",
    group: "buzz",
    label: "2ポスト目以降も単独で成立",
    description: "スレッドの2つ目以降も単体でおすすめに流れる",
    instruction:
      "スレッドの2ポスト目以降も、それ単体で意味が通るように主語と対象を省かずに書く。本文の途中で「続きはスレッドで」「次で説明します」と切らない（パターンが指定する「↓詳細」「↓手順」と通し番号は除く）。",
  },
  {
    id: "buzz-8",
    group: "buzz",
    label: "時事の語を1つ",
    description: "話題の語は検索とおすすめで拾われやすい",
    instruction:
      "ニュース解説・週次まとめ以外のパターンで、検索結果か<user_input>で確認できた話題の語があれば1つだけ絡め、主張との接点を1文で示す。確認できない話題は入れず、季節の挨拶で始めず、時事を批評するだけの投稿にもしない。",
  },
  {
    id: "buzz-9",
    group: "buzz",
    label: "失敗談は素材から3点",
    description:
      "実際にあった失敗を何をして・何が起きて・どう直したかで書くと信じやすい",
    instruction:
      "自分の失敗談は、発信定義書か<user_input>に書かれた出来事だけを使い、作らない。書くときは何をして・何が起きて・どう直したかの3点をそろえ、失敗だけで終えたり一般論に置き換えたりしない。書けるものが無ければ失敗談を入れない。",
  },
  {
    id: "buzz-10",
    group: "buzz",
    label: "反論を1つ先回り",
    description: "「でも〜では?」に先に答えると納得と引用につながりやすい",
    instruction:
      "主張を書くときは、読者が言いそうな反論を1つ読者の口調で書き（例「でも◯◯でしょ」）、1〜2文で答える。「確かに〜しかし」「もちろん〜ですが」の形にせず、答えられない反論なら主張の範囲を狭める（ニュース解説・週次まとめは除く）。",
  },
];

const ID_SET = new Set(WRITING_CHECKPOINTS.map((c) => c.id));

/** 保存値（unknown）を、カタログに実在する ID だけの配列（カタログ順・重複なし）へ正規化する。 */
export function normalizeWritingCheckpointIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const chosen = new Set(
    value.filter((v): v is string => typeof v === "string" && ID_SET.has(v)),
  );
  return WRITING_CHECKPOINTS.filter((c) => chosen.has(c.id)).map((c) => c.id);
}

/** 未知の ID を含んでいれば false（保存時の検証）。 */
export function isKnownWritingCheckpointId(id: string): boolean {
  return ID_SET.has(id);
}

export const WRITING_CHECKPOINTS_HEADING = "## 書き方のチェックポイント";
/** 節の先頭に必ず置く1行。条項が求める体験・数字・固有名は、<base_md> と入力にある素材だけから取る。 */
export const WRITING_CHECKPOINTS_GUARD =
  "- 体験・数字・固有名は<base_md>と入力にある素材だけを使い、無ければ作らない（推測で埋めない）";

/**
 * 選んだ条項を `<base_md>` の末尾へ付ける Markdown。何も選んでいなければ空文字（節ごと出さない）。
 * 群ごとに小見出しを付けず、条項だけを並べる（AI には条項の並びが伝われば十分）。
 */
export function renderWritingCheckpoints(ids: readonly string[]): string {
  const chosen = normalizeWritingCheckpointIds([...ids]);
  if (chosen.length === 0) return "";
  const lines = WRITING_CHECKPOINTS.filter((c) => chosen.includes(c.id)).map(
    (c) => `- ${c.instruction}`,
  );
  // 体験・数字を求める条項が捏造を誘わないよう、素材の出所を先頭で限定する（レビュー 2026-09-06）。
  return `${WRITING_CHECKPOINTS_HEADING}\n${WRITING_CHECKPOINTS_GUARD}\n${lines.join("\n")}`;
}

/** アカウント.md 本文と条項を合わせた、生成へ渡す base_md の全文。 */
export function composeBaseMdWithCheckpoints(
  baseMd: string,
  ids: readonly string[],
): string {
  const section = renderWritingCheckpoints(ids);
  const body = baseMd.trim();
  if (!section) return body;
  return body ? `${body}\n\n${section}` : section;
}
