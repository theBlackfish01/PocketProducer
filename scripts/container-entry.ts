import { mkdir, chown } from "node:fs/promises";

// Railway volumes are initially root-owned. Initialize only our fixed directory,
// then drop privileges before loading config, database or provider credentials.
if (process.getuid?.() === 0) {
  await mkdir("/data/audio", { recursive: true });
  await chown("/data/audio", 1000, 1000);
  process.setgroups?.([]);
  process.setgid?.(1000);
  process.setuid?.(1000);
}
await import("./start-hosted.js");
