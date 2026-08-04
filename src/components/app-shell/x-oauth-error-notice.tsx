import Link from "next/link";
import { primaryLinkClassName } from "@/components/ui/link-button";
import { Notice } from "@/components/ui/notice";

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
    if (reason === "reconnect_account_mismatch") {
      return {
        // **何が起きたかを行動で説明する**（T-M8-53）。「再連携」は特定のアカウントを直す操作なので、
        // 別のアカウントで認可されたら新規追加せず止める。止めた理由と次の一手を具体的に出す。
        body: "再連携しようとしたアカウントとは別のXアカウントで許可されたため、中断しました（新しい連携は作っていません）。Xで対象のアカウントに切り替えてから、もう一度「再連携」をお試しください。別のアカウントを増やしたい場合は「Xアカウントを追加」からどうぞ。",
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
  // provider_error は「X側との通信が失敗した」と判明している場合のみ。原因を断定して案内できる。
  if (code === "provider_error") {
    return {
      body: "X側との通信に失敗したため連携を完了できませんでした。時間をおいて、もう一度お試しください。",
      action: { href: X_ACCOUNTS_TAB, label: "もう一度連携する" },
    };
  }
  // internal_error は原因不明の catch-all。X側の障害と決めつけると誤案内になる
  // （2026-07-26: DBの権限エラーが「X側との通信に失敗」と表示され切り分けを誤らせた）。
  if (code === "internal_error") {
    return {
      body: "予期しないエラーで連携を完了できませんでした。もう一度お試しいただき、解消しない場合はお問い合わせください。",
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
    <Notice className="px-5 py-4" role="alert" tone="danger">
      <p className="font-semibold">Xアカウントの連携が完了しませんでした</p>
      <p className="mt-1 leading-6">{message.body}</p>
      {message.action ? (
        <Link
          className={`mt-3 ${primaryLinkClassName}`}
          href={message.action.href}
        >
          {message.action.label}
        </Link>
      ) : null}
    </Notice>
  );
}
