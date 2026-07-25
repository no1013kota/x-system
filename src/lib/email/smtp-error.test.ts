import { describe, expect, it } from "vitest";

import { EmailSendError } from "./notification-email";
import { classifySmtpError } from "./smtp-error";

/**
 * SMTPエラー分類の契約テスト（要件04 §14）。認証系は終端(auth)、ネットワーク/一時系は再送(network/server)、
 * それ以外は unknown。summary には code/responseCode の要約のみを含め、宛先・秘密値は含めない。
 */
describe("classifySmtpError", () => {
  it("EAUTH は auth（終端）", () => {
    const err = classifySmtpError({ code: "EAUTH" });
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.kind).toBe("auth");
    expect(err.summary).toBe("smtp:EAUTH");
  });

  it("認証応答コード 530/534/535 は auth", () => {
    for (const responseCode of [530, 534, 535]) {
      expect(classifySmtpError({ responseCode }).kind).toBe("auth");
    }
  });

  it("ネットワーク系 code は network（再送）", () => {
    for (const code of ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET", "EENVELOPE"]) {
      expect(classifySmtpError({ code }).kind).toBe("network");
    }
  });

  it("認証以外の 4xx/5xx 応答コードは server（再送）", () => {
    expect(classifySmtpError({ responseCode: 421 }).kind).toBe("server");
    expect(classifySmtpError({ responseCode: 450 }).kind).toBe("server");
    expect(classifySmtpError({ responseCode: 550 }).kind).toBe("server");
  });

  it("認証コードは応答コード分類より優先される", () => {
    // 535 は AUTH_RESPONSE_CODES に含まれるため server ではなく auth。
    expect(classifySmtpError({ responseCode: 535 }).kind).toBe("auth");
  });

  it("code/responseCode 不明・null は unknown", () => {
    expect(classifySmtpError({}).kind).toBe("unknown");
    expect(classifySmtpError(null).kind).toBe("unknown");
    expect(classifySmtpError(undefined).kind).toBe("unknown");
    expect(classifySmtpError(new Error("boom")).kind).toBe("unknown");
  });

  it("summary は code と responseCode を連結（両方無しは smtp:err）", () => {
    expect(classifySmtpError({ code: "EAUTH", responseCode: 535 }).summary).toBe("smtp:EAUTH:535");
    expect(classifySmtpError({ responseCode: 550 }).summary).toBe("smtp:err:550");
    expect(classifySmtpError({}).summary).toBe("smtp:err");
  });
});
