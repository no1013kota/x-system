import { describe, expect, it } from "vitest";

import { PRESET_MAX_COUNT } from "./prompt-presets";
import { PRESET_SYNC_MAX_COUNT } from "./prompt-preset-sync";

/**
 * `prompt-preset-sync.ts` は import の円環を避けるため上限を自分で持つ（T-M8-411）。
 * 片方だけ変えると「画面は5件まで」なのに保存経路が6件目を作る、といった食い違いになる。
 */
describe("prompt-preset-sync の上限は prompt-presets と同じ", () => {
  it("区分ごとに一致する", () => {
    expect(PRESET_SYNC_MAX_COUNT).toEqual(PRESET_MAX_COUNT);
  });
});
