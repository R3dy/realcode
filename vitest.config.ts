import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
  resolve: {
    // The dashboard's tsconfig maps `@/*` → `./src/dashboard/*` (its baseUrl).
    // No non-dashboard file uses the `@/` alias (grep-verified), so pointing
    // the vitest alias at the dashboard root lets the dashboard route + component
    // tests resolve `@/lib/...` the same way the dashboard's own tsconfig does.
    alias: { "@": "/src/dashboard" },
  },
});
