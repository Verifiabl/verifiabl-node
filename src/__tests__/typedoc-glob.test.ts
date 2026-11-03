import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const docsRequire = createRequire(new URL("../../docs/package.json", import.meta.url));
const utilitiesUrl = pathToFileURL(join(dirname(docsRequire.resolve("typedoc")), "node-utils.js"));

// Exercise TypeDoc's patched traversal, not just minimatch's public API.
const { glob } = (await import(utilitiesUrl.href)) as {
  glob: (pattern: string, root: string) => string[];
};

test("TypeDoc discovers nested entry points with minimatch 11", () => {
  const root = mkdtempSync(join(tmpdir(), "typedoc-glob-"));
  try {
    const nested = join(root, "src", "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export {};\n");
    writeFileSync(join(nested, "entry.ts"), "export {};\n");
    writeFileSync(join(nested, "ignored.js"), "export {};\n");

    const normalizedRoot = root.replaceAll("\\", "/");
    const expected = [`${normalizedRoot}/src/index.ts`, `${normalizedRoot}/src/nested/entry.ts`];
    expect(glob(`${normalizedRoot}/src/**/*.ts`, root).sort()).toEqual(expected);
    expect(glob(`${normalizedRoot}/src/{index,nested/entry}.ts`, root).sort()).toEqual(expected);
    expect(glob(`${normalizedRoot}/src/missing/**/*.ts`, root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
