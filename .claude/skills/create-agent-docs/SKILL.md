---
name: create-agent-docs
description: 仅当用户需要为项目建立 Agent 文档工作流时，或用户显式 /create-agent-docs 调用时使用。为项目生成 AGENTS.md/CLAUDE.md 入口及 docs/ 下的三份流程指导文档（需求、提交、修 Bug）。
---

# Coding Agent 工作流文档创建 skill

## 目标

为 Coding Agent 建立一套文档工作流：Agent 每次执行用户需求前先读入口文档，了解项目结构与流程后再动手，完成后按流程落盘记录。

## 执行流程（按序执行，禁止跳步）

### 第 1 步：勘察项目（先看，后问）

在向用户提出任何适配问题**之前**，必须先完成勘察，避免问出答案已经躺在配置文件里的问题：

1. 确认技术栈与语言（看 `package.json`、`pyproject.toml`、`pom.xml`、`go.mod` 等）
2. 查找已有的静态检查配置：`tsconfig.json`、`.eslintrc*`、`eslint.config.*`、`ruff.toml`、`pyrightconfig.json`、`.stylelintrc*` 等
3. 查找已有测试框架与命令：`vitest`/`jest`/`pytest`/`junit`，`package.json` 的 scripts、CI 配置（`.github/workflows/`）
4. 确认文档现状：`AGENTS.md`、`CLAUDE.md`、`docs/`、`README.md` 是否已存在，已有内容是什么
5. 确认版本控制：执行 `git rev-parse --is-inside-work-tree`，记录目标项目是否为 git 仓库

### 第 2 步：适配确认（基于勘察结果提问）

向用户一次性提出最多 3 个问题，每个都附带基于第 1 步勘察到的**推荐项**：

1. **静态检查**：勘察到配置 → 直接沿用；勘察到技术栈但无配置 → 推荐对应工具（如 Python 推荐 Ruff + pyright，TS/前端推荐 ESLint + tsc）；无法判断 → 请用户提供
2. **测试策略**：是否启用单元测试（默认推荐启用。模板仅内置单元测试约束，若用户另需端到端测试，生成时在此基础上补充）
3. **自动 commit**：Agent 完成需求修改后是否自动执行原子提交（默认推荐手动提交：由用户显式下达提交指令时才提交）。此选项只决定 feature-check-guide 是否保留「原子提交」步骤，不影响 git-commit-guide 的内容

若第 1 步发现项目不是 git 仓库，追加询问是否先执行 `git init`（推荐初始化）。

### 第 3 步：生成文档

- 创建 `docs/` 文件夹（如果没有）
- 入口文档（模板见 references/agents-md-template.md，落盘前同样须完成适配，见下方「模板适配规则」）：
  - **没有** `AGENTS.md` 也没有 `CLAUDE.md`：创建 `AGENTS.md`，`CLAUDE.md` 仅包含一行 `@AGENTS.md` 导入
  - **已有** `AGENTS.md`（无论 `CLAUDE.md` 是否存在）：不得覆盖原有内容，在 `AGENTS.md` 末尾追加工作流引入章节；若 `CLAUDE.md` 存在但未导入 `AGENTS.md`，补一行 `@AGENTS.md`
  - **仅有** `CLAUDE.md`：创建 `AGENTS.md`，并在 `CLAUDE.md` 末尾追加一行 `@AGENTS.md` 导入
- 在 `docs/` 下创建三份指导文档（模板见 references/，**必须先做技术栈适配，再落盘**，见下方「模板适配规则」）：
  - `feature-check-guide.md`：需求分析、完善、拆分与完成后落盘的工作流，[模板](references/feature-check-guide.md)
  - `git-commit-guide.md`：Git 提交工作流，[模板](references/git-commit-guide.md)
  - `bug-fix-guide.md`：修复 Bug 的工作流，[模板](references/bug-fix-guide.md)
- 非 git 仓库且用户选择不初始化：不生成 `git-commit-guide.md`，入口文档的指引目录相应调整

### 第 4 步：验证（声称完成前必须执行）

落盘后逐项检查，全部通过才能向用户报告完成：

- [ ] 三份 docs 文档顶部的「模板适配说明」引用块已全部删除
- [ ] 所有落盘文档（含入口文档）中不存在未替换的模板占位符（`{{...}}`）
- [ ] `AGENTS.md`/`CLAUDE.md` 中对 docs 文档的引用路径真实存在
- [ ] 文档中写入的静态检查、测试、运行命令在当前项目里真实可执行（对照 scripts / 配置）
- [ ] 未覆盖或删除用户已有文档中的任何原有内容（git 仓库用 `git diff` 确认，非 git 项目逐文件人工复查）

## 模板适配规则

references/ 下的模板是**前端 TS 项目的示例**，其中静态检查（ESLint/tsc）、测试（单元测试）、运行验证（`npm run dev`）均为占位内容。落盘前必须按第 2 步的适配结论替换：

- 前端 TS 项目：可基本沿用，按用户实际 lint/test/dev 脚本校正命令
- Python 项目：静态检查换为 Ruff/pyright，运行验证换为 `pytest`/`python -m <module>` 或用户实际的启动方式
- Java/Go/其他：替换为对应工具链（如 Checkstyle/`go vet` + `golangci-lint`），运行验证换成对应启动命令
- 测试：用户不启用测试 → 删除模板中所有单元测试相关约束，同时删除 git-commit 模板中「提交前测试 100% 通过」的前置条件及 `type` 枚举中的 `test`
- 自动 commit：用户选择自动提交 → feature-check-guide 保留「原子提交」步骤；选择手动提交 → 删除该步骤，改为「完成后向用户汇报修改摘要，等待用户下达提交指令」。git-commit-guide 在两种模式下内容一致，仅在用户显式要求提交或自动提交触发时读取执行
- 非 git 仓库且用户不初始化：不生成 git-commit-guide.md，并删除 feature-check-guide 中的「原子提交」步骤及所有 commit 相关表述

## 状态文档约定（生成时须同步向用户说明）

三份指导文档的工作流依赖模块级状态文档：`ARCHITECTURE.md`（模块架构）、`PROGRESS.md`（进度与已知 Bug）、`DECISIONS.md`（重大决策记录）。三者均位于目标模块目录内（模块代码所在目录，如 `src/modules/<module>/`）；项目无明确模块划分时位于项目根目录。首次使用时由 Agent 在首个目标模块内按需创建，无需预先全量生成。在 `AGENTS.md` 的指引目录中说明这一约定。

## 常见反模式与对策

### 反模式一：为用户匹配错误的检查流程
- 表现：没有查证用户项目环境，把示例文件原封不动写入用户工作流
- 后果：Java 项目被写入了 ESLint 流程，工作流文档形同虚设
- 对策：严格先执行第 1 步勘察，再执行第 4 步验证中的命令可执行性检查

### 反模式二：没有与用户沟通需要的测试阶段
- 表现：未询问用户测试需求，强行把示例内的测试流程写入工作流
- 后果：写了多余的测试代码，拉长流程、浪费 token
- 对策：第 2 步中必须询问（默认推荐启用单元测试），按用户实际选择写入

### 反模式三：破坏用户已有文档
- 表现：直接覆盖用户已有的 `AGENTS.md` 或 `CLAUDE.md`
- 后果：用户沉淀的项目约定丢失
- 对策：已有文档一律在原文件末尾追加引入，绝不覆盖，第 4 步用 `git diff` 复核
