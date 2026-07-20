import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseAndValidate, stripCodeFence } from "./parse";

const schema = z.object({ posts: z.array(z.object({ text: z.string() })) });

describe("stripCodeFence", () => {
  it("removes ```json fences", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("removes bare ``` fences", () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("leaves plain text untouched", () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe("parseAndValidate", () => {
  it("parses raw valid JSON matching the schema", () => {
    const r = parseAndValidate('{"posts":[{"text":"hi"}]}', schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.posts[0].text).toBe("hi");
  });

  it("parses code-fenced JSON by stripping the fence", () => {
    const r = parseAndValidate('```json\n{"posts":[{"text":"hi"}]}\n```', schema);
    expect(r.ok).toBe(true);
  });

  it("fails on non-JSON text", () => {
    expect(parseAndValidate("これはJSONではありません", schema).ok).toBe(false);
  });

  it("fails when JSON parses but violates the schema", () => {
    expect(parseAndValidate('{"posts":"not-an-array"}', schema).ok).toBe(false);
  });
});
