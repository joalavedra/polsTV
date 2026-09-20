import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The pages are plain HTML with one inline module each, so nothing type-checks or bundles them.
 * Two branches once each declared the same identifier; the merge was textually clean, the module
 * was a SyntaxError, and the public page ran no script at all. This is the missing compiler.
 */
const pages = ["index.html", "broadcaster.html", "tv.html"];
const publicDir = join(import.meta.dirname, "public");

function inlineModules(html: string): string[] {
  return [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? "",
  );
}

describe.each(pages)("%s", (page) => {
  const html = readFileSync(join(publicDir, page), "utf8");

  it("has an inline module that parses", () => {
    const modules = inlineModules(html);
    expect(modules.length).toBeGreaterThan(0);
    const dir = mkdtempSync(join(tmpdir(), "polstv-page-"));
    modules.forEach((source, index) => {
      const file = join(dir, `${page}.${index}.mjs`);
      writeFileSync(file, source);
      expect(() => execFileSync("node", ["--check", file], { stdio: "pipe" })).not.toThrow();
    });
  });

  it("has no merge conflict markers", () => {
    expect(html).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)( |$)/m);
  });

  it("keeps API calls page-relative so it works under a path prefix", () => {
    expect(html).not.toMatch(/fetch(?:Json)?\(\s*[`"']\/(?!\/)/);
  });
});
