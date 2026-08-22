/**
 * SMTP送信の環境ガード（T-M7-23の再発防止・T-M8-222で通知メール廃止後も運営者向け
 * 状態メールが共有する）。**production 以外からは外部SMTPへ送らない**——ループバック宛
 * （Mailpit等）だけを許す。2026-07-27、動作確認の scheduler_tick が実SMTPへ98通を
 * 送信した事故の再発防止。
 */
export function canSendViaSmtp(input: { appEnv: string; host: string }): boolean {
  if (input.appEnv === "production") return true;
  const host = input.host.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}
