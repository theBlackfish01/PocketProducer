import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Local trace/evidence imports may contain archived source trees. They are
    // not part of this checkout's suite, including when filtering by test path.
    exclude: [...configDefaults.exclude, ".local/**"],
    // Repository integration files share one dedicated queue database; running
    // files concurrently would let one file claim another file's job.
    fileParallelism: false,
    setupFiles: ["./tests/setup/offline-env.ts"]
  }
});
