/**
 * PNG generation benchmark.
 *
 *   npm run build && node scripts/bench-png.mjs [count] [pixelWidth]
 *
 * Compares the old single-document pipeline (render the whole branded SVG per
 * code, then resvg.asPng) against the current pipeline (frame cached once, only
 * the QR re-rendered per code, palette-PNG encode). Reports wall-clock total,
 * per-code mean, peak RSS, and the CPU/wall ratio (a proxy for core use: ~1.0
 * means one core pinned).
 */
import { Resvg } from "@resvg/resvg-js";
import { createBarcodePng, createBarcodeSvg } from "../dist/index.js";

const count = Number.parseInt(process.argv[2] ?? "1000", 10);
const pixelWidth = Number.parseInt(process.argv[3] ?? "720", 10);

function makeParts(i) {
  // Vary the reference so every code is a distinct QR matrix.
  const ref = i.toString(36).padStart(22, "0").slice(0, 22);
  return { verifiablReference: ref, encryptedPii: "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4" };
}

function peakRssTracker() {
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peak) peak = rss;
  }, 25);
  timer.unref();
  return () => {
    clearInterval(timer);
    return peak;
  };
}

async function run(label, fn) {
  // Warm up (load resvg, build the frame cache) outside the measured window.
  await fn(makeParts(0));
  if (global.gc) global.gc();
  const stopRss = peakRssTracker();
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    await fn(makeParts(i));
  }
  const wallMs = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  const peakRss = stopRss();
  const cpuMs = (cpu.user + cpu.system) / 1000;
  console.log(`\n${label}`);
  console.log(`  wall total:   ${wallMs.toFixed(0)} ms`);
  console.log(`  per code:     ${(wallMs / count).toFixed(2)} ms`);
  console.log(`  throughput:   ${(count / (wallMs / 1000)).toFixed(0)} codes/s`);
  console.log(`  cpu/wall:     ${(cpuMs / wallMs).toFixed(2)} (≈ cores used)`);
  console.log(`  peak RSS:     ${(peakRss / 1024 / 1024).toFixed(0)} MB`);
  return wallMs;
}

// Yield to the event loop each code, exactly as createBarcodePngBatch does, so
// resvg's native render memory is reclaimed and peak RSS stays flat.
const yieldTurn = () => new Promise((r) => setImmediate(r));

// OLD = the pre-change path: render the whole SVG with system fonts enabled
// (the dominant cost was resvg's per-render system-font-database scan).
const old = async (parts) => {
  const { svg } = createBarcodeSvg(parts, { width: pixelWidth });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: pixelWidth } }).render().asPng();
  await yieldTurn();
  return png;
};
// All three paths yield once per code, exactly as createBarcodePngBatch does,
// so the comparison is symmetric and the palette path's peak RSS reflects the
// recommended batched usage rather than a tight unyielded loop.
const next = async (parts) => {
  const png = (await createBarcodePng(parts, {}, pixelWidth)).png;
  await yieldTurn();
  return png;
};
const nextPalette = async (parts) => {
  const png = (await createBarcodePng(parts, { palette: true }, pixelWidth)).png;
  await yieldTurn();
  return png;
};

console.log(`Generating ${count} barcodes at ${pixelWidth}px each...`);
const oldMs = await run("OLD: render whole SVG, loadSystemFonts default(true)", old);
const newMs = await run("NEW default: loadSystemFonts:false + resvg asPng (truecolour)", next);
const palMs = await run("NEW palette: loadSystemFonts:false + SDK palette encode", nextPalette);
console.log(
  `\nSpeedup vs OLD: default ${(oldMs / newMs).toFixed(1)}x, palette ${(oldMs / palMs).toFixed(1)}x` +
    `  (palette is ${(palMs / newMs).toFixed(1)}x the default's time for ~60% smaller files)`,
);
