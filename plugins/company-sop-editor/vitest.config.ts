import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-bb--company-sop-editor",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
