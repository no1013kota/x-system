import Link from "next/link";

/**
 * Xアカウント連携（OAuth）の失敗を、原因別の日本語と次アクションで伝える（要件06 §1.2.1）。
 * `/api/x/oauth/start`・`/callback` は失敗時に設定画面へ `x_oauth_error=<code>`（＋あれば
 * `x_oauth_reason=<reason>`）を付けて戻す。戻り先はエラー内容によって Xアカウントタブ以外
 * （APIキータブ）にもなるため、タブに依らず設定画面の先頭で表示する。
 */

interface OAuthErrorMessage {
  body: string;
  action?: { href: string; label: string };
}

const API_KEYS_TAB = "/app/settings?tab=api-keys";
const X_ACCOUNTS_TAB = "/app/settings?tab=x-accounts";

/** code（＋reason）→ 表示文言。未知のコードは汎用文にフォールバックする。 */
function messageFor(code: string, reason: string | null): OAuthErrorMessage {
  if (code === "api_key_required") {
    return {
      body: "Xアカウントを連携する前に、X APIキー（Client ID）の登録が必要です。このページの「X APIキー」で登録したあと、もう一度「Xアカウントを追加」をお試しください。",
      action: { href: API_KEYS_TAB, label: "X APIキーを登録する" },
    };
  }
  if (code === "subscription_required") {
    return {
      body: "ご契約が有効でないため連携できません。プランのお申し込み状況をご確認ください。",
      action: { href: "/app/settings?tab=billing", label: "契約状況を確認する" },
    };
  }
  if (code === "forbidden") {
    if (reason === "x_account_limit_reached") {
      return {
        body: "連携できるXアカウント数がプランの上限に達しています。使わないアカウントを停止するか、上位プランへの変更をご検討ください。",
        action: { href: X_ACCOUNTS_TAB, label: "連携中のアカウントを確認する" },
      };
    }
    if (reason === "auth_type_mismatch") {
      return {
        body: "現在のプランでは連携方式が異なるため、この操作を完了できませんでした。プランを変更した直後の場合は、画面を再読み込みしてからもう一度お試しください。",
        action: { href: X_ACCOUNTS_TAB, label: "Xアカウント設定へ戻る" },
      };
    }
    if (reason === "insufficient_scope") {
      return {
        body: "Xの許可画面で必要な権限がすべて許可されませんでした。投稿・画像添付・アカウント情報の読み取りをすべて許可して、もう一度お試しください。",
        action: { href: X_ACCOUNTS_TAB, label: "もう一度連携する" },
      };
    }
    if (reason === "oauth_session_mismatch") {
      return {
        body: "連携手続きの途中でログイン状態が変わったため中断しました。お手数ですが、もう一度最初から連携をお試しください。",
        action: { href: X_ACCOUNTS_TAB, label: "もう一度連携する" },
      };
    }
    return {
      body: "この操作は許可されていません。プランと連携状況をご確認のうえ、もう一度お試しください。",
      action: { href: X_ACCOUNTS_TAB, label: "Xアカウント設定へ戻る" },
    };
  }
  if (code === "unauthorized") {
    return { body: "ログインの有効期限が切れたため中断しました。もう一度ログインしてからお試しください。" };
  }
  if (code === "provider_error" || code === "internal_error") {
    return {
      body: "X側との通信に失敗したため連携を完了できませんでした。時間をおいて、もう一度お試しください。",
      action: { href: X_ACCOUNTS_TAB, label: "もう一度連携する" },
    };
  }
  return {
    body: "連携を完了できませんでした。お手数ですが、もう一度お試しください。解消しない場合はお問い合わせください。",
    action: { href: X_ACCOUNTS_TAB, label: "もう一度連携する" },
  };
}

export function XOAuthErrorNotice({
  code,
  reason = null,
}: {
  code: string;
  reason?: string | null;
}) {
  const message = messageFor(code, reason);
  return (
    <div
      className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900"
      role="alert"
    >
      <p className="font-semibold">Xアカウントの連携が完了しませんでした</p>
      <p className="mt-1 leading-6">{message.body}</p>
      {message.action ? (
        <Link
          className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
          href={message.action.href}
        >
          {message.action.label}
        </Link>
      ) : null}
    </div>
  );
}
