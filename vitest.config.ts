import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/references/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/**/_generated/**",
      ],
      thresholds: {
        // Start with current coverage, increase as we add more tests
        // encryption.ts, errors.ts, circuitBreaker.ts are at 100%
        // Overall: ~6.5% statements/lines, 55% functions, 94% branches
        lines: 5,
        functions: 50,
        branches: 90,
        statements: 5,
      },
    },
  },
});
