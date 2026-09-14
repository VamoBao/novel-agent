# 模块架构（项目根目录级）

> 本项目暂无多模块划分，架构文档维护在根目录。引入 `src/` 子模块划分后，各模块可另建自己的架构文档。

## 分层结构

```text
src/
├── index.ts          # 应用入口
├── index.test.ts     # 冒烟测试
├── providers/        # LLM 接入层：各厂商 provider 实例（当前仅 DeepSeek）
│   └── deepseek.ts   # createDeepSeek 实例，Key 读 DEEPSEEK_API_KEY
├── tools/            # 提供给 LLM 使用的工具
│   └── index.ts      # 工具注册表占位（约定见文件内注释）
└── workflows/        # Agent 工作流编排（多步骤流程、模型与工具组合）
    └── index.ts      # 空占位
```

## 依赖边界

- `providers/` 不依赖 `tools/` 与 `workflows/`，仅封装厂商差异（实例化、Key、baseURL）
- `tools/` 不依赖 `workflows/`；工具用 AI SDK `tool()` + zod schema 定义，经 `tools/index.ts` 汇总导出
- `workflows/` 依赖 `providers/` 与 `tools/` 完成编排，是业务逻辑所在层
- `src/index.ts` 仅作为入口组装/触发 workflows，不承载业务逻辑

## 数据流向

`index.ts`（触发）→ `workflows/`（编排）→ `providers/`（LLM 调用）+ `tools/`（工具执行）

## 关键约定

- DeepSeek API Key 从环境变量 `DEEPSEEK_API_KEY` 读取（Bun 自动加载 `.env`，`.env` 已被 .gitignore 排除）
- 当前可用模型 ID：`deepseek-flash`、`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`
