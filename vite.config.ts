import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/*.test.ts", "tests/openapi/*.test.ts"],
  },
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: ["src/index.ts", "src/openapi/ajv.ts"],
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
