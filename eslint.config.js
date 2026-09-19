import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "dist/**",
      "coverage/**",
      "**/dist/**",
      "**/coverage/**",
      "**/out/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.bun,
      },
    },
  },
  {
    rules: {
      // 下划线前缀 = 有意忽略的参数/变量（接口要求的 no-op 实现等）
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // 业务层交互边界：workflows/agents/tools/state/output/providers 只依赖 UiChannel 接口，
  // 不得直接触碰 CLI 实现或测试替身，也不得直接 console 输出（统一走通道）
  {
    files: ["apps/agent/src/{workflows,agents,tools,state,output,providers}/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/prompt", "**/ui/cli-channel", "**/ui/fake-channel"],
              message:
                "业务层交互必须经 UiChannel（ui/channel）注入，禁止直接依赖 CLI 实现或测试替身",
            },
          ],
        },
      ],
    },
  },
);
