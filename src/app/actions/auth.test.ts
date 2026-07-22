import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";

import { INITIAL_AUTH_FORM_STATE } from "./auth-state";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  profileEq: vi.fn(),
  profileFrom: vi.fn(),
  profileSelect: vi.fn(),
  profileSelectEq: vi.fn(),
  profileSingle: vi.fn(),
  profileUpdate: vi.fn(),
  profileUpsert: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));
vi.mock("@/lib/env", () => ({
  env: { APP_BASE_URL: "http://localhost:3000" },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { resendSignUpConfirmation, signIn, signOut, signUp } from "./auth";

function validSignInForm(overrides: Record<string, string> = {}): FormData {
  const values = {
    captcha_token: "",
    email: "user@example.com",
    next: "",
    password: "safe-password-123",
    ...overrides,
  };
  const formData = new FormData();
  Object.entries(values).forEach(([key, value]) => formData.set(key, value));
  return formData;
}

function validSignUpForm(overrides: Record<string, string> = {}): FormData {
  const values = {
    captcha_token: "",
    email: "new-user@example.com",
    password: "safe-password-123",
    password_confirmation: "safe-password-123",
    privacy_acknowledged: "on",
    privacy_version: CURRENT_PRIVACY_VERSION,
    terms_accepted: "on",
    terms_version: CURRENT_TERMS_VERSION,
    ...overrides,
  };
  const formData = new FormData();
  Object.entries(values).forEach(([key, value]) => formData.set(key, value));
  return formData;
}

describe("auth actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    mocks.profileEq.mockResolvedValue({ error: null });
    mocks.profileUpsert.mockResolvedValue({ error: null });
    mocks.profileUpdate.mockReturnValue({ eq: mocks.profileEq });
    mocks.profileSingle.mockResolvedValue({
      data: { subscription_status: "active" },
      error: null,
    });
    mocks.profileSelectEq.mockReturnValue({ single: mocks.profileSingle });
    mocks.profileSelect.mockReturnValue({ eq: mocks.profileSelectEq });
    mocks.profileFrom.mockReturnValue({
      select: mocks.profileSelect,
      update: mocks.profileUpdate,
      upsert: mocks.profileUpsert,
    });
    mocks.createSupabaseAdminClient.mockReturnValue({
      from: mocks.profileFrom,
    });
  });

  describe("signUp", () => {
    it("creates a pending user and saves both accepted legal versions", async () => {
      const signUpAuth = vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      });
      mocks.createSupabaseServerClient.mockResolvedValue({
        auth: { signUp: signUpAuth },
      });

      const result = await signUp(
        INITIAL_AUTH_FORM_STATE,
        validSignUpForm(),
      );

      expect(result).toMatchObject({
        email: "new-user@example.com",
        status: "success",
      });
      expect(signUpAuth).toHaveBeenCalledWith({
        email: "new-user@example.com",
        password: "safe-password-123",
        options: {
          emailRedirectTo: expect.stringMatching(/\/auth\/confirm$/),
        },
      });
      expect(mocks.profileFrom).toHaveBeenCalledWith("profiles");
      expect(mocks.profileUpdate).toHaveBeenCalledWith({
        privacy_acknowledged_at: expect.any(String),
        privacy_version: CURRENT_PRIVACY_VERSION,
        terms_accepted_at: expect.any(String),
        terms_version: CURRENT_TERMS_VERSION,
      });
      expect(mocks.profileEq).toHaveBeenCalledWith("id", "user-1");
    });

    it("passes a supplied captcha token to Supabase Auth", async () => {
      const signUpAuth = vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      });
      mocks.createSupabaseServerClient.mockResolvedValue({
        auth: { signUp: signUpAuth },
      });

      await signUp(
        INITIAL_AUTH_FORM_STATE,
        validSignUpForm({ captcha_token: "captcha-value" }),
      );

      expect(signUpAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ captchaToken: "captcha-value" }),
        }),
      );
    });

    it("requires the terms and privacy checkboxes independently", async () => {
      const missingTerms = validSignUpForm();
      missingTerms.delete("terms_accepted");
      const missingPrivacy = validSignUpForm();
      missingPrivacy.delete("privacy_acknowledged");

      await expect(
        signUp(INITIAL_AUTH_FORM_STATE, missingTerms),
      ).resolves.toMatchObject({
        fieldErrors: { terms_accepted: expect.any(Array) },
        status: "error",
      });
      await expect(
        signUp(INITIAL_AUTH_FORM_STATE, missingPrivacy),
      ).resolves.toMatchObject({
        fieldErrors: { privacy_acknowledged: expect.any(Array) },
        status: "error",
      });
      expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
    });

    it("rejects stale legal versions before calling Supabase", async () => {
      const result = await signUp(
        INITIAL_AUTH_FORM_STATE,
        validSignUpForm({
          privacy_version: "old",
          terms_version: "old",
        }),
      );

      expect(result).toMatchObject({
        fieldErrors: {
          privacy_version: expect.any(Array),
          terms_version: expect.any(Array),
        },
        status: "error",
      });
      expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
    });

    it("enforces password confirmation and the UTF-8 72-byte limit", async () => {
      const mismatch = await signUp(
        INITIAL_AUTH_FORM_STATE,
        validSignUpForm({ password_confirmation: "different-value" }),
      );
      const tooManyBytes = await signUp(
        INITIAL_AUTH_FORM_STATE,
        validSignUpForm({
          password: "あ".repeat(25),
          password_confirmation: "あ".repeat(25),
        }),
      );

      expect(mismatch.fieldErrors?.password_confirmation).toBeDefined();
      expect(tooManyBytes.fieldErrors?.password).toContain(
        "パスワードはUTF-8で72バイト以内にしてください。",
      );
      expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
    });

    it("never exposes the provider error or email existence", async () => {
      const providerMessage = "User already registered: secret@example.com";
      mocks.createSupabaseServerClient.mockResolvedValue({
        auth: {
          signUp: vi.fn().mockResolvedValue({
            data: { user: null },
            error: new Error(providerMessage),
          }),
        },
      });

      const result = await signUp(
        INITIAL_AUTH_FORM_STATE,
        validSignUpForm(),
      );

      expect(result.status).toBe("error");
      expect(result.message).not.toContain(providerMessage);
      expect(result.message).not.toContain("secret@example.com");
      expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    });
  });

  describe("resendSignUpConfirmation", () => {
    it("returns the same accepted response when Supabase rejects the resend", async () => {
      const resend = vi.fn().mockResolvedValue({
        error: new Error("Email not found"),
      });
      mocks.createSupabaseServerClient.mockResolvedValue({ auth: { resend } });
      const formData = new FormData();
      formData.set("email", "unknown@example.com");

      const result = await resendSignUpConfirmation(
        INITIAL_AUTH_FORM_STATE,
        formData,
      );

      expect(result).toMatchObject({
        email: "unknown@example.com",
        status: "success",
      });
      expect(result.message).not.toContain("not found");
      expect(resend).toHaveBeenCalledWith({
        email: "unknown@example.com",
        options: {
          emailRedirectTo: expect.stringMatching(/\/auth\/confirm$/),
        },
        type: "signup",
      });
    });
  });

  describe("signIn", () => {
    function mockSignInSuccess(subscriptionStatus = "active") {
      const signInWithPassword = vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "user@example.com" } },
        error: null,
      });
      const signOutSession = vi.fn().mockResolvedValue({ error: null });
      mocks.createSupabaseServerClient.mockResolvedValue({
        auth: { signInWithPassword, signOut: signOutSession },
      });
      mocks.profileSingle.mockResolvedValue({
        data: { subscription_status: subscriptionStatus },
        error: null,
      });
      return { signInWithPassword, signOutSession };
    }

    it("redirects an active user to an approved relative next path", async () => {
      const { signInWithPassword } = mockSignInSuccess();

      await expect(
        signIn(
          INITIAL_AUTH_FORM_STATE,
          validSignInForm({
            captcha_token: "captcha-value",
            next: "/app/posts?tab=drafts",
          }),
        ),
      ).rejects.toThrow("NEXT_REDIRECT");

      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        options: { captchaToken: "captcha-value" },
        password: "safe-password-123",
      });
      expect(mocks.profileSelect).toHaveBeenCalledWith("subscription_status");
      expect(mocks.profileUpsert).toHaveBeenCalledOnce();
      expect(mocks.profileSelectEq).toHaveBeenCalledWith("id", "user-1");
      expect(mocks.redirect).toHaveBeenCalledWith("/app/posts?tab=drafts");
    });

    it.each(["incomplete", "incomplete_expired"])(
      "redirects %s subscriptions to plans even when next is present",
      async (subscriptionStatus) => {
        mockSignInSuccess(subscriptionStatus);

        await expect(
          signIn(
            INITIAL_AUTH_FORM_STATE,
            validSignInForm({ next: "/app/posts" }),
          ),
        ).rejects.toThrow("NEXT_REDIRECT");

        expect(mocks.redirect).toHaveBeenCalledWith("/plans");
      },
    );

    it("ignores an external next URL and redirects an active user to app", async () => {
      mockSignInSuccess();

      await expect(
        signIn(
          INITIAL_AUTH_FORM_STATE,
          validSignInForm({ next: "https://evil.example/steal" }),
        ),
      ).rejects.toThrow("NEXT_REDIRECT");

      expect(mocks.redirect).toHaveBeenCalledWith("/app");
    });

    it("returns the resend state only for Supabase's stable unconfirmed code", async () => {
      mocks.createSupabaseServerClient.mockResolvedValue({
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { code: "email_not_confirmed", message: "provider detail" },
          }),
        },
      });

      const result = await signIn(
        INITIAL_AUTH_FORM_STATE,
        validSignInForm(),
      );

      expect(result).toMatchObject({
        email: "user@example.com",
        status: "email_unconfirmed",
      });
      expect(result.message).not.toContain("provider detail");
      expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("uses one generic message for invalid credentials and rate limits", async () => {
      const messages: string[] = [];
      for (const error of [
        { code: "invalid_credentials", message: "email is missing" },
        { code: "over_request_rate_limit", message: "too many attempts" },
      ]) {
        mocks.createSupabaseServerClient.mockResolvedValue({
          auth: {
            signInWithPassword: vi.fn().mockResolvedValue({
              data: { user: null },
              error,
            }),
          },
        });
        const result = await signIn(
          INITIAL_AUTH_FORM_STATE,
          validSignInForm(),
        );
        messages.push(result.message);
        expect(result.status).toBe("error");
        expect(result.message).not.toContain(error.message);
      }

      expect(new Set(messages).size).toBe(1);
    });

    it("invalidates the new session when profile lookup fails", async () => {
      const { signOutSession } = mockSignInSuccess();
      mocks.profileSingle.mockResolvedValue({
        data: null,
        error: new Error("profile unavailable"),
      });

      const result = await signIn(
        INITIAL_AUTH_FORM_STATE,
        validSignInForm(),
      );

      expect(result.status).toBe("error");
      expect(signOutSession).toHaveBeenCalledOnce();
      expect(mocks.redirect).not.toHaveBeenCalled();
    });
  });

  describe("signOut", () => {
    it("invalidates the Supabase session before redirecting to login", async () => {
      const signOutSession = vi.fn().mockResolvedValue({ error: null });
      mocks.createSupabaseServerClient.mockResolvedValue({
        auth: { signOut: signOutSession },
      });

      await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");
      expect(signOutSession).toHaveBeenCalledOnce();
      expect(mocks.redirect).toHaveBeenCalledWith("/login");
      expect(signOutSession.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.redirect.mock.invocationCallOrder[0] as number,
      );
    });

    it("does not redirect when Supabase fails to invalidate the session", async () => {
      mocks.createSupabaseServerClient.mockResolvedValue({
        auth: {
          signOut: vi.fn().mockResolvedValue({ error: new Error("failed") }),
        },
      });

      await expect(signOut()).rejects.toMatchObject({ code: "internal_error" });
      expect(mocks.redirect).not.toHaveBeenCalled();
    });
  });
});
