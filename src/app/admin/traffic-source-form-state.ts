/** 流入元フォームの状態（T-M8-423）。"use server" のファイルは async 関数しか export できないため分ける。 */
export interface TrafficSourceFormState {
  status: "idle" | "success" | "error";
  message?: string;
}

export const INITIAL_TRAFFIC_SOURCE_FORM_STATE: TrafficSourceFormState = { status: "idle" };
