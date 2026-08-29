import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const out = path.join(root, "dist", "extension");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(
  path.join(root, "extension", "manifest.json"),
  path.join(out, "manifest.json")
);
await cp(
  path.join(root, "extension", "popup.html"),
  path.join(out, "popup.html")
);
await cp(
  path.join(root, "extension", "popup.css"),
  path.join(out, "popup.css")
);
await cp(
  path.join(root, "extension", "options.html"),
  path.join(out, "options.html")
);
await cp(
  path.join(root, "extension", "options.css"),
  path.join(out, "options.css")
);
await cp(
  path.join(root, "extension", "icons"),
  path.join(out, "icons"),
  { recursive: true }
);
const entries = {
  content: "extension/src/content/content.ts",
  background: "extension/src/background/background.ts",
  popup: "extension/src/popup/popup.ts",
  options: "extension/src/popup/options.ts"
};
await build({
  entryPoints: entries,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outdir: out,
  sourcemap: true,
  logLevel: "info"
});
console.log(`Built extension at ${out}`);

