import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vite-plus";

const executablePath = process.env.KAJO_CHROMIUM_PATH;

export default defineConfig({
  optimizeDeps: {
    include: ["ajv/dist/2020.js", "ajv-formats", "zod"],
  },
  test: {
    include: ["tests/browser/*.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright({
        launchOptions: executablePath ? { executablePath } : undefined,
      }),
    },
  },
});
