import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@cahva/kajo": fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
    },
  },
});
