import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  platform: "node",
  target: "node20",
  fixedExtension: false,
  deps: {
    neverBundle: ["qrcode", "zod"],
  },
});
