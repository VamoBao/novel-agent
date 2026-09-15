import { z } from "zod";

/**
 * 受众候选：LLM 根据小说类型推断的典型受众群体，供用户多选。
 */
export const audienceSuggestionSchema = z.object({
  options: z
    .array(
      z.object({
        label: z.string().min(1).describe("受众标签，如：Z世代女性读者"),
        description: z.string().min(1).describe("该受众群体的阅读偏好，一句话"),
      }),
    )
    .min(4)
    .max(8),
});

export type AudienceSuggestion = z.infer<typeof audienceSuggestionSchema>;
