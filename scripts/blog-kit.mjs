#!/usr/bin/env node
//
// ブログ記事「非エンジニアがClaude Codeでアプリを作り続けるための仕組み」の配布キットを作る。
//
//   npm run blog:kit
//
// 中身は blog/kit/（CLAUDE.md・docs・tasks・README の雛形。正本はここ）＋ .claude/skills/（**本リポジトリで
// 実際に使っているスキルをそのまま**・運営者の指示 2026-09-05「本リポジトリで開発に使用しているskillを同封」）。
// スキルを更新したら再実行して zip を作り直す（記事の「約NNKB」も出力に合わせて直す）。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, cpSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(".");
const out = join(root, "public/blog-files/claude-code-dev-kit.zip");
const stage = join(tmpdir(), `claude-code-dev-kit-${process.pid}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, "blog/kit"), stage, { recursive: true });
cpSync(join(root, ".claude/skills"), join(stage, ".claude/skills"), { recursive: true });
mkdirSync(join(root, "public/blog-files"), { recursive: true });
rmSync(out, { force: true });
// zip は macOS / CI（ubuntu）に標準で入っている。-X で拡張属性を落とし、内容が同じなら差分が出にくいようにする。
execFileSync("zip", ["-r", "-X", "-q", out, ".", "-x", ".DS_Store", "*/.DS_Store"], { cwd: stage, stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });
if (!existsSync(out)) {
  console.error("❌ zip を作れませんでした");
  process.exit(1);
}
const kb = Math.round(statSync(out).size / 1024);
console.log(`✅ ${out.replace(root + "/", "")}（約${kb}KB）。記事の「約NNKB」をこの値に合わせてください。`);
