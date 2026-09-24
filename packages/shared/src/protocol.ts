import { z } from "zod";
import { viewSchema } from "./views";

/** stdio JSON 行协议版本；hello 时不一致由 client 拒绝继续 */
export const PROTOCOL_VERSION = 1;

/** 创作流程阶段（client 侧 StageBar 进度展示用）；chapter 为写作期章节规划段 */
export const stageSchema = z.enum([
  "type",
  "audience",
  "worldview",
  "character",
  "conflict",
  "outline",
  "chapter",
]);
export type Stage = z.infer<typeof stageSchema>;

/** 提问载荷：与 UiChannel 提问原语一一对应（line 为 ask_user 工具的原始行提问） */
export const askSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("line"),
    prompt: z.string(),
  }),
  z.object({
    type: z.literal("text"),
    prompt: z.string(),
    optional: z.boolean(),
  }),
  z.object({
    type: z.literal("select"),
    prompt: z.string(),
    options: z.array(z.string()),
    allowCustom: z.boolean(),
  }),
  z.object({
    type: z.literal("multi"),
    prompt: z.string(),
    options: z.array(z.string()),
  }),
  z.object({
    type: z.literal("confirm"),
    prompt: z.string(),
    default: z.boolean(),
    view: viewSchema.optional(),
  }),
  z.object({
    type: z.literal("int"),
    prompt: z.string(),
    min: z.number().int(),
    max: z.number().int(),
    default: z.number().int(),
  }),
]);
export type Ask = z.infer<typeof askSchema>;

/** agent → client 消息（每行一个 JSON 对象） */
export const agentMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protoVersion: z.number().int(),
    dbPath: z.string(),
    outputDir: z.string(),
  }),
  z.object({ type: z.literal("stage"), stage: stageSchema }),
  z.object({ type: z.literal("notify"), text: z.string() }),
  z.object({ type: z.literal("view"), view: viewSchema }),
  z.object({ type: z.literal("request"), id: z.number().int(), ask: askSchema }),
  z.object({
    type: z.literal("run_finished"),
    novelId: z.string(),
    outputPath: z.string(),
  }),
  z.object({ type: z.literal("error"), message: z.string(), fatal: z.boolean() }),
]);
export type AgentMessage = z.infer<typeof agentMessageSchema>;

/** client → agent 消息（answer 类型须与对应 request 的提问类型匹配） */
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("response"),
    id: z.number().int(),
    answer: z.union([z.string(), z.array(z.string()), z.boolean(), z.number()]),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
