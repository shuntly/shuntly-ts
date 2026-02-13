import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  test: {
    globals: false,
    environment: "node",
    include: ["test/adhoc/**/*.test.ts"],
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
