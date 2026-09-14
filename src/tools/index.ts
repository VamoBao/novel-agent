// 工具注册表占位
//
// 本目录存放提供给 LLM 使用的 tool，约定：
// - 每个工具一个文件，使用 AI SDK 的 `tool()`（import { tool } from "ai"）定义，
//   入参用 zod schema 描述，便于 LLM 理解调用方式
// - 在本文件集中导入并汇总导出，供 workflows 组装 Agent 时使用
export const tools = {};
