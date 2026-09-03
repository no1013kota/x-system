import { permanentRedirect } from "next/navigation";

/**
 * `/new` は新LPの先行公開URLだった（T-M8-419）。T-M8-420 で `/` に昇格したため、
 * 共有済みのリンクが切れないよう恒久リダイレクトだけを残す。
 */
export default function NewLandingRedirect() {
  permanentRedirect("/");
}
