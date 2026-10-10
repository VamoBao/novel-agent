import type { UiChannel } from "../ui/channel";
import type { Location, NewLocation } from "@novel/shared";
import { getDefaultLocationStore, type LocationStore } from "../state/location-store";

export interface PlantLocationsResult {
  created: number;
}

/**
 * 编排层兜底 diff（纯函数，可单测）：不信任模型给出的「新增」判定——
 * 按库内地点名剔除清单中已有项（trim 后全等比对），清单内同名去重保留首个，
 * 名字 trim 后为空的项剔除。
 */
export function filterNewLocations(
  newLocations: NewLocation[],
  existingLocations: Location[],
): NewLocation[] {
  const libraryNames = new Set(existingLocations.map((l) => l.name.trim()));
  const seen = new Set<string>();
  const result: NewLocation[] = [];
  for (const item of newLocations) {
    const name = item.name.trim();
    if (name.length === 0 || libraryNames.has(name) || seen.has(name)) continue;
    seen.add(name);
    result.push({ name, description: item.description });
  }
  return result;
}

/**
 * 地点确定性入库（无 LLM，对齐伏笔入库的确定性风格）：逐条 addLocation
 * （name + description），notify 逐条通报。经 filterNewLocations 过滤后无名字
 * 解析环节，无逐条跳过分支；空清单由调用方整块跳过（零调用零提示）。
 */
export function plantNewLocations(options: {
  novelId: string;
  newLocations: NewLocation[];
  channel: UiChannel;
  locationStore?: LocationStore;
}): PlantLocationsResult {
  const store = options.locationStore ?? getDefaultLocationStore();
  let created = 0;
  for (const item of options.newLocations) {
    store.addLocation(options.novelId, { name: item.name, description: item.description });
    options.channel.notify(`✨ 地点已入库：${item.name}`);
    created += 1;
  }
  return { created };
}
