# 重大决策记录

记录「为什么」而非「做了什么」：决策背景、备选方案、权衡依据与最终结论。

## 2026-09-14 LLM 接入层选型：Vercel AI SDK + 官方 DeepSeek provider

- **背景**：项目需要接入 LLM 能力，首个目标厂商为 DeepSeek，且未来大概率接入其他厂商。
- **备选方案**：
  1. 直接裸调 DeepSeek HTTP API——无抽象层，换厂商成本高，工具调用协议需自行实现
  2. Vercel AI SDK（`ai`）+ `@ai-sdk/openai-compatible` 自建 DeepSeek 接入——灵活但需自己维护 baseURL 与模型映射
  3. Vercel AI SDK + 官方 `@ai-sdk/deepseek`——厂商差异由官方包收敛，社区生态成熟
- **权衡依据**：AI SDK 的统一 `LanguageModel` 抽象使后续换/加厂商只改 provider 层；`@ai-sdk/deepseek` 在官方 monorepo（vercel/ai）内维护，模型 ID 与接口跟随官方更新。
- **结论**：采用方案 3。`zod` 同步引入（AI SDK 的 tool 参数 schema 依赖）。

## 2026-09-14 TypeScript 固定在 6.x 而非 7.x

- **背景**：`bun init` 默认安装 TS 7.0（原生版），但 typescript-eslint 8.70 支持范围为 `>=4.8.4 <6.1.0`，加载即报错退出。
- **备选方案**：等 typescript-eslint 支持 TS 7（不可控）；按官方建议 TS 6/TS 7 并存（需双包别名，增加维护复杂度）。
- **结论**：devDependencies 固定 `typescript@6` 并移除 `^7` peer 声明。tsconfig 严格选项在 TS 6 下全部可用；待 typescript-eslint 支持 TS 7 后可平滑升级。
