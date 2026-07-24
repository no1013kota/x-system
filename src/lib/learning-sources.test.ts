import { describe, expect, it } from "vitest";

import { normalizeLearningUrl } from "./learning-sources";

describe("normalizeLearningUrl", () => {
  it("normalizes a ref_account URL to https://x.com/{handle} (lowercased)", () => {
    expect(normalizeLearningUrl("ref_account", "https://twitter.com/SpaceAI")).toBe("https://x.com/spaceai");
    expect(normalizeLearningUrl("ref_account", "https://x.com/foo_bar")).toBe("https://x.com/foo_bar");
  });

  it("rejects a ref_account URL that is actually a post or has extra segments", () => {
    expect(normalizeLearningUrl("ref_account", "https://x.com/foo/status/1")).toBeNull();
    expect(normalizeLearningUrl("ref_account", "https://x.com/")).toBeNull();
  });

  it("normalizes a ref_post URL to /{handle}/status/{id}", () => {
    expect(normalizeLearningUrl("ref_post", "https://twitter.com/Foo/status/12345")).toBe(
      "https://x.com/foo/status/12345",
    );
  });

  it("rejects a ref_post URL without a numeric status id or wrong path", () => {
    expect(normalizeLearningUrl("ref_post", "https://x.com/foo/status/abc")).toBeNull();
    expect(normalizeLearningUrl("ref_post", "https://x.com/foo")).toBeNull();
  });

  it("rejects non-x hosts and non-https", () => {
    expect(normalizeLearningUrl("ref_account", "https://example.com/foo")).toBeNull();
    expect(normalizeLearningUrl("ref_post", "http://x.com/foo/status/1")).toBeNull();
    expect(normalizeLearningUrl("ref_account", "not a url")).toBeNull();
  });
});
