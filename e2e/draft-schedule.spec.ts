import { query } from "./fixtures/account";
import { expect, signIn, test, toastIn } from "./fixtures/test";

/**
 * 下書きの日時予約（T-M8-157）。
 *
 * これまでの予約は `schedule_slots`（繰り返し枠＝投稿を生成するトリガー）だけで、
 * **既にある下書きを特定の日時に投稿する経路が無かった**。予約→表示→解除まで実ブラウザで見る。
 */

/** `datetime-local` へ入れる値（ブラウザのローカル時刻＝テストはAsia/Tokyo）。 */
function localInputValue(offsetMinutes: number): string {
  const at = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

async function seedDraft(xAccountId: string, text: string): Promise<string> {
  // 実際の生成経路と同じ形にする（`warnings`/`sources` が無いと画面側で落ちる）。
  const thread = JSON.stringify([
    { local_id: "p1", sources: [], text, warnings: [], weighted_length: text.length },
  ]);
  const [row] = await query<{ id: string }>(
    `insert into drafts (x_account_id, pattern_id, thread, initial_thread, images, status)
     values ($1,
             (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'),
             $2::jsonb, $2::jsonb, '[]'::jsonb, 'draft')
     returning id`,
    [xAccountId, thread],
  );
  return row.id;
}

test("下書きに日時を指定して予約でき、一覧に予約日時が出て解除もできる", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("draftsched", { personaReady: true });
  const draftId = await seedDraft(account.xAccountId, "予約する下書き");

  await signIn(page, account);
  await page.goto("/app/posts?tab=drafts");

  const card = page.locator("li, article, section").filter({ hasText: "予約する下書き" }).first();
  await expect(card).toBeVisible();

  await page.getByRole("button", { name: "日時を指定して予約" }).first().click();

  // **過去日時は押す前に理由が出て、送信できない**（押すまで分からない失敗を作らない）。
  const input = page.getByLabel("投稿日時");
  /*
   * datetime-localへ`fill`で文字を打つと、**ブラウザUI言語が12時間制（CIのen-US）のとき
   * セグメント入力が化けて値が入らない**（2026-08-22・stg初CIで検出。macOSでは再現しない）。
   * ネイティブsetter＋inputイベントで値を直接設定し、ロケールに依存させない。
   */
  const fillDateTime = async (value: string) =>
    input.evaluate((el: HTMLInputElement, v) => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(el),
        "value",
      )!.set!;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  await fillDateTime(localInputValue(-60));
  await expect(page.getByText("1分以上先の日時を指定してください", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "予約する" })).toBeDisabled();

  // 十分先の日時なら予約できる。
  await fillDateTime(localInputValue(120));
  await expect(page.getByRole("button", { name: "予約する" })).toBeEnabled();
  await page.getByRole("button", { name: "予約する" }).click();
  await expect(toastIn(page)).toContainText("投稿を予約しました");

  // DBへ入っている（見た目だけ変えて終わりにしない）。
  await expect
    .poll(
      async () => {
        const [row] = await query<{ scheduled_at: string | null }>(
          `select scheduled_at::text as scheduled_at from drafts where id = $1`,
          [draftId],
        );
        return row?.scheduled_at;
      },
      { message: "予約日時がDBへ保存されること", timeout: 10_000 },
    )
    .not.toBeNull();

  // 一覧に予約日時が出る（開かずにいつ投稿されるか分かる）。
  await expect(page.getByText(/予約 \d{4}/).first()).toBeVisible();

  // 解除できる。
  await page.getByRole("button", { name: "予約を変更" }).first().click();
  await page.getByRole("button", { name: "予約を解除" }).click();
  await expect(toastIn(page)).toContainText("予約を解除しました");

  await expect
    .poll(
      async () => {
        const [row] = await query<{ scheduled_at: string | null }>(
          `select scheduled_at::text as scheduled_at from drafts where id = $1`,
          [draftId],
        );
        return row?.scheduled_at;
      },
      { message: "解除がDBへ反映されること", timeout: 10_000 },
    )
    .toBeNull();
});
