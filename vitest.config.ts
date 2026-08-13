import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Worker threads rather than the default child processes: spawning one
    // process per test file dominates the run on Windows. Files stay isolated.
    pool: "threads"
  }
});
