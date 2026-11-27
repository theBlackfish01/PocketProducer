import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateNativeOffline, canonicalHash, nativeMusicHash } from "@pocket/core";
import { buildReference, starterReferences } from "@pocket/core/test-support";

// Canonical editable scores and reproducible pinned-SDK evidence. No account required.
const output = resolve(".local", "benchmarks", "starter-references-v1");
await mkdir(output, { recursive: true });
const manifest = [];
for (const ref of starterReferences) {
  for (const kind of ["reference", "starter"] as const) {
    const score = buildReference(ref, kind === "reference");
    const sdk = await validateNativeOffline(score);
    const filename = ref.id + "." + kind + ".native.json";
    await writeFile(resolve(output, filename), JSON.stringify(score, null, 2) + "\n");
    manifest.push({
      filename, title: score.title, bars: score.bars, scoreHash: canonicalHash(score), musicHash: nativeMusicHash(score),
      offlineNexusHash: canonicalHash(sdk.structuralReadback), readback: sdk.readback
    });
  }
}
await writeFile(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(output);
