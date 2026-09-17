import { randomBytes } from "node:crypto";

/**
 * 生成 UUIDv7（RFC 9562）：48bit 毫秒时间戳 + 版本/变体位 + 74bit 随机。
 * 相比 node:crypto 的 randomUUID（v4，纯随机），v7 前缀含时间戳、大致按
 * 生成时间有序，适合做数据库主键（索引局部性好）。
 */
export function generateUuidV7(timestamp: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(Math.floor(timestamp));
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ts >> BigInt((5 - i) * 8)) & 0xffn);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 生成小说创作 ID（UUIDv7）。
 * 在调用任何 Agent 之前生成，作为 novels 表主键与各业务表的关联外键。
 */
export function generateNovelId(): string {
  return generateUuidV7();
}
