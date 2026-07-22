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
    const type =
      key.displayHint.client_type === "confidential" ? "Confidential" : "Public";
    return `Client ID ${maskedLastFour(key.displayHint.client_id_last4)}（${type}）`;
  }
  return `APIキー ${maskedLastFour(key.displayHint.api_key_last4)}`;
}
