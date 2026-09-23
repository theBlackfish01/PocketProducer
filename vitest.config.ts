import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Repository integration files share one dedicated queue database; running
    // files concurrently would let one file claim another file's job.
    fileParallelism: false,
    setupFiles: ["./tests/setup/offline-env.ts"]
  }
});
