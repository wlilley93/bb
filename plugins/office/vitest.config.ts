import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-bb--office",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "vendor/**"],
  },
});
