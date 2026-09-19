/**
 * 生成 UUIDv7（RFC 9562）：48bit 毫秒时间戳 + 随机位，同毫秒内单调递增。
 * 封装 Bun 原生实现；保留函数壳作为项目内唯一出口，便于统一替换与测试。
 */
export function generateUuidV7(): string {
  return Bun.randomUUIDv7();
}

/**
 * 生成小说创作 ID（UUIDv7）。
 * 在调用任何 Agent 之前生成，作为 novels 表主键与各业务表的关联外键。
 */
export function generateNovelId(): string {
  return generateUuidV7();
}
