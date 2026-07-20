/**
 * LLM共通アダプタ契約（プロンプト設計書 §5.1）。プロバイダ差異はアダプタに閉じ込め、
 * パイプラインは1本にする。最終テキストだけでなく request ID / usage / 引用元 / stop reason を
 * 共通形式へ正規化する。
 */

export type Provider = "anthropic" | "openai" | "google";

/** provider call単位のusageを共通形式へ正規化したもの（§5.1「呼び出し単位で保存」）。 */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Web検索の実行回数（server tool use）。 */
  webSearchRequests: number;
  /** このgenerate内で行ったprovider call回数（pause_turn継続を含む）。 */
  providerCalls: number;
}

export interface Citation {
  url: string;
  title?: string;
}

export interface TextGenRequest {
  /** 固定プレフィックス（SYS＋base_md）。可変値を混ぜない（§5.1/§5.2, プロンプトキャッシュ用）。 */
  system: string[];
  /** 可変入力（messagesへ渡す）。 */
  user: string;
  /** Web検索を使う場合のみ。maxUsesはプロンプト側上限以下（§5.2）。 */
  webSearch?: { maxUses: number };
  /** 構造化出力のJSON Schema（Web検索と併用しない実行で使用, §5.1）。 */
  jsonSchema?: object;
  /** この1回のprovider callのtimeout ms（呼び出し側が min(90s, deadline残) を算出, §5.6）。 */
  timeoutMs: number;
}

export interface TextGenResult {
  provider: Provider;
  requestId: string | null;
  text: string;
  citations: Citation[];
  usage: ProviderUsage;
  stopReason: string | null;
}

export interface TextGen {
  generate(req: TextGenRequest): Promise<TextGenResult>;
}

export function emptyUsage(): ProviderUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    webSearchRequests: 0,
    providerCalls: 0,
  };
}
