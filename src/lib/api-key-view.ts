import type { AiKeyProvider } from "./api-keys";

export type ApiKeyViewProvider = "x" | AiKeyProvider;

export interface ApiKeyViewState {
  displayHint: Record<string, boolean | string>;
  provider: ApiKeyViewProvider;
  status: "invalid" | "unchecked" | "valid";
  verifiedAt: string | null;
}

function maskedLastFour(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? `••••${value.slice(-4)}`
    : "末尾情報なし";
}

export function maskedApiKeyLabel(key: ApiKeyViewState): string {
  if (key.provider === "x") {
    // Public/Confidential の表記は出さない。現在のConsoleに選択が無く、画面からも
    // 「Client種別」を撤去したため、ここに出すと利用者が知らない概念になる（T-M8-62）。
    return `Client ID ${maskedLastFour(key.displayHint.client_id_last4)}`;
  }
  return `APIキー ${maskedLastFour(key.displayHint.api_key_last4)}`;
}
