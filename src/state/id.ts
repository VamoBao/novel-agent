import { randomUUID } from "node:crypto";

/**
 * 生成小说创作 ID。
 * 在调用任何 Agent 之前生成，将作为 state 存入数据库时的唯一标识。
 */
export function generateNovelId(): string {
  return randomUUID();
}
