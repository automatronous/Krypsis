import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const directory = path.join(process.cwd(), "ml", "models");
await mkdir(directory, { recursive: true });
const manifest = {
  model: "HuggingFaceTB/SmolVLM-500M-Instruct",
  revision: "PIN_REQUIRED",
  status: "NOT_INSTALLED",
  note: "Inspect the official repository and pin exact ONNX assets plus SHA-256 checksums before download. This command intentionally does not invent filenames or download unverified binaries."
};
await writeFile(
  path.join(directory, "model-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
console.log(
  "Model setup is intentionally gated: review the official model repository, then add approved filenames, revision, and SHA-256 checksums to the setup manifest."
);
