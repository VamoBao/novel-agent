import { z } from "zod";

/**
 * 参考文风 schema：用户维护的文风样本，生成正文时按启用状态注入写作模型。
 *
 * 字段一览：
 * - name 名字：样本标识（如「江南式打斗」「张爱玲腔」）
 * - content 内容：文风文本本体——**存数据库**（TEXT 列直接进库，不落文件、
 *   无 file_path：文风是喂给 LLM 的素材而非人类阅读产物，体量小而恒定，
 *   且每次生成正文都全量注入 prompt，无「列表懒加载」优化空间）
 * - enabled 启用开关：生成正文只注入启用的条目——并存多份风格时切换试用
 *   不必反复删建；schema 显式必填（缺省默认 true 由 store 层负责）
 */
export const styleReferenceSchema = z.object({
  name: z.string().min(1).describe("文风样本名字，如「江南式打斗」"),
  content: z
    .string()
    .min(1)
    .describe("文风文本内容（直接进库；表单软上限约 2 万字符由客户端 UI 约束）"),
  enabled: z.boolean().describe("启用开关：生成正文只注入启用的样本"),
});

export type StyleReference = z.infer<typeof styleReferenceSchema>;
