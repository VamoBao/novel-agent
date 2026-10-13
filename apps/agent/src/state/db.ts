import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/** 数据库文件路径（相对项目根；可用环境变量 NOVEL_DB_PATH 覆盖，测试用） */
export const DEFAULT_DB_PATH = process.env.NOVEL_DB_PATH ?? "data/novel.db";

/** schema 版本：结构变更时递增；4→5 起 client 书库已投产，仅做保数据的增量迁移，
 *  DROP 重建仅保留给开发期旧库（<4）与异常版本的兜底 */
const SCHEMA_VERSION = 17;

/**
 * 打开（必要时创建）数据库并完成建表。
 * 主键均为应用层生成的 UUIDv7（时间有序，索引友好）：
 * - novels：小说信息（pinned / favorite 为书库管理标记；name 在大纲确认后回填；
 *   genre / audience JSON / core_conflict JSON 为分阶段采集的创作条件，历史 NULL），
 *   其余业务表经 novel_id 外键关联
 * - characters：角色卡，1:N（novel_id 索引），version 为当前版本号（编辑提交递增）
 * - character_versions：角色历史版本快照（编辑时旧卡整卡 JSON 归档），character_id 外键关联，
 *   主行 id / novel_id 稳定不变，外部引用（如伏笔的服务角色 IDs）不因编辑换代失效
 * - worldviews：世界观，1:1（novel_id 唯一），taboos 数组存 JSON 文本
 * - outlines：大纲树（部/幕两级入库，章为写作期预留），parent_id 自引用外键，多版本行并存；
 *   内容随节点入库（summary 梗概，key_plot_points 关键情节点存 JSON 文本，仅幕节点携带；
 *   character_ids 登场角色 ID 绑定存 JSON 文本，仅章节点携带——章节规划确认后回填）
 * - documents：章节正文元数据（一章一份，chapter_id 唯一外键挂 outlines 章节点；
 *   file_path 为正文文件相对路径——内容存文件系统 `<output>/<小说名>/<部名>/<章名>.md`，
 *   与 outlines.document_id 绑定回写列同事务维护），长文本不进库
 * - locations：小说世界的地理位置（名称 / 定位描述 / 坐标 / 图层 / 人口——
 *   x/y/layer/population 可空：自动入库只产生「名字+定位」，地图向字段留给未来编辑），
 *   parent_id 自引用外键（城市→大陆层级）
 * - foreshadows：伏笔（表面行为/隐藏真相/读者注意度 1-10/回收状态枚举），
 *   出现章节 ID、埋设幕节点 ID（act_node_id，章节规划按幕圈定回传的依据）与回收幕节点 ID
 *   （recover_act_node_id，大纲规划的真相揭晓幕）均为
 *   可空裸列（chapter 节点写作期落地后补约束，先例 document_id），
 *   回收章节 IDs 与服务角色 IDs 存 JSON 文本
 * - style_references：参考文风（名字/文本内容/启用开关）——**内容直接进库**
 *   （TEXT 列，不落文件：文风是喂给 LLM 的素材而非人类阅读产物，体量小而恒定，
 *   每次生成正文都全量注入无懒加载空间），每本小说独立（novel_id 外键），
 *   enabled 控制生成正文时是否注入
 */
/**
 * 10→11 数据迁移：documents 表正文改文件存储。
 * 存量行的 content 按「小说名-<创作ID前8位>/部名/章名.md」层级写入 output 根
 * （NOVEL_OUTPUT_DIR，与 outline-writer 同源默认 output/），回填 file_path 后
 * DROP content 列。路径段清理规则与 output/document-writer 一致（此处为 state
 * 层，不反向依赖 output/ 层，本地保留同款小函数）；目标文件已存在时以文档
 * ID 作后缀防覆盖。
 */
function migrateDocumentsToFile(db: Database): void {
  const outputRoot = process.env.NOVEL_OUTPUT_DIR ?? "output";
  const sanitize = (name: string | null | undefined, fallback: string): string => {
    const cleaned = (name ?? "")
      // 文件名安全清理须覆盖控制字符，豁免 no-control-regex 检查
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.\s]+$/, "");
    return cleaned.length > 0 ? cleaned.slice(0, 80) : fallback;
  };
  const rows = db
    .prepare(
      `SELECT d.id, d.novel_id, d.content,
              (SELECT name FROM novels WHERE id = d.novel_id) AS novel_name,
              c.name AS chapter_name,
              (SELECT name FROM outlines WHERE id = c.parent_id) AS act_name,
              (SELECT name FROM outlines WHERE id = (SELECT parent_id FROM outlines WHERE id = c.parent_id)) AS part_name
       FROM documents d JOIN outlines c ON c.id = d.chapter_id;`,
    )
    .all() as Array<{
    id: string;
    novel_id: string;
    content: string;
    novel_name: string | null;
    chapter_name: string;
    act_name: string | null;
    part_name: string | null;
  }>;
  const paths = new Map<string, string>();
  for (const row of rows) {
    // 各级名称缺失（异常数据）时以文档 ID 片段兜底，保证路径段非空；
    // 顶层段带小说创作 ID 前 8 位——同名小说不共享文件夹（与 document-writer 同款约定）
    const segments = [
      `${sanitize(row.novel_name, "未命名小说")}-${row.novel_id.slice(0, 8)}`,
      sanitize(row.part_name, `part-${row.id.slice(0, 8)}`),
      sanitize(row.chapter_name, `chapter-${row.id.slice(0, 8)}`),
    ];
    const base = join(outputRoot, ...segments);
    const target = existsSync(`${base}.md`)
      ? `${base}-${row.id.slice(0, 8)}.md`
      : `${base}.md`;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, row.content);
    paths.set(row.id, relative(outputRoot, target));
  }
  db.exec("ALTER TABLE documents ADD COLUMN file_path TEXT NOT NULL DEFAULT '';");
  const update = db.prepare("UPDATE documents SET file_path = ? WHERE id = ?;");
  for (const [id, filePath] of paths) {
    update.run(filePath, id);
  }
  db.exec("ALTER TABLE documents DROP COLUMN content;");
}

export function openDatabase(path: string = DEFAULT_DB_PATH): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  // 跨进程并发（agent 会话写库 / 查询 CLI 打开库）时短锁冲突等待重试，
  // 而非默认 busy_timeout=0 立即抛 "database is locked"
  db.exec("PRAGMA busy_timeout = 5000;");
  // SQLite 外键约束默认关闭，必须按连接显式开启
  db.exec("PRAGMA foreign_keys = ON;");
  // journal_mode 幂等设置：已是 WAL 不再执行设置语句（该语句本身要取库级锁，
  // 无条件执行会让纯浏览路径与写进程冲突）
  const modeRow = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
  if (modeRow.journal_mode.toLowerCase() !== "wal") {
    db.exec("PRAGMA journal_mode = WAL;");
  }

  const versionRow = db.query("PRAGMA user_version").get() as { user_version: number };
  if (versionRow.user_version !== SCHEMA_VERSION) {
    const version = versionRow.user_version;
    if (version >= 4 && version < SCHEMA_VERSION) {
      // 已投产库（>=4）保数据增量迁移，逐级补列（每段以来源版本守卫，跨版本直升
      // 时各段按链式顺序同批执行，已是目标形态的段不重复跑——重复 ALTER 会报 duplicate column）
      if (version === 4) {
        // 4→5：novels 增列 pinned / favorite（书库管理），新列有 DEFAULT，旧数据无需回填
        db.exec("ALTER TABLE novels ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;");
        db.exec("ALTER TABLE novels ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;");
      }
      if (version <= 5) {
        // 5→6：outlines 增列内容（summary 梗概 / key_plot_points 情节点 JSON 文本），
        // 旧行留 NULL 不回填（决策见 DECISIONS：读取路径暂不动，旧书预览走 output 产物）
        db.exec("ALTER TABLE outlines ADD COLUMN summary TEXT;");
        db.exec("ALTER TABLE outlines ADD COLUMN key_plot_points TEXT;");
      }
      // 6→7：新增 locations 表，无 ALTER——由下方 CREATE TABLE IF NOT EXISTS 幂等落地
      // 7→8：新增 foreshadows 表，同上
      if (version <= 8) {
        // 8→9：characters 增列 version（编辑版本管理），新列有 DEFAULT，旧数据无需回填；
        // 历史快照表 character_versions 由下方 CREATE TABLE IF NOT EXISTS 幂等落地
        db.exec("ALTER TABLE characters ADD COLUMN version INTEGER NOT NULL DEFAULT 1;");
      }
      if (version === 10) {
        // 10→11：正文改文件存储——documents 去 content 列、增 file_path；
        // 存量行的 content 先按「小说名/部名/章名」层级落文件（保数据），见 migrateDocumentsToFile
        migrateDocumentsToFile(db);
      }
      if (version >= 8 && version <= 11) {
        // 11→12：foreshadows 增列 act_node_id（埋设幕节点，可空裸列——章节规划按幕圈定回传
        // 未绑章伏笔；SQLite 不支持 ALTER 补外键，一致性由写入方保证，先例 outlines.document_id）。
        // 守卫须覆盖 8~11：foreshadows 表自 v8 起已存在（不同于 10→11 时 documents 尚不存在），
        // 这些版本的库都持无此列的旧表形态，CREATE TABLE IF NOT EXISTS 对其不生效
        db.exec("ALTER TABLE foreshadows ADD COLUMN act_node_id TEXT;");
      }
      if (version >= 7 && version <= 12) {
        // 12→13：locations 放宽 x/y/layer 可空 + 新增 description（地点自动入库只产生
        // 「名字+定位」，坐标是地图向字段）。SQLite 无法 ALTER 放宽 NOT NULL，按官方
        // 重建流程迁移：FK 关闭 → 改名旧表 → 建新表 → 拷数据 → 删旧表 → FK 重开
        // （自引用外键下拷贝顺序无关化）。守卫覆盖 7~12：表自 v7 已存在，均持旧形态
        // （表异常缺失时跳过重建，由下方 CREATE TABLE IF NOT EXISTS 直建新形态）；
        // 随改名旧表 DROP 的旧索引由下方 CREATE INDEX IF NOT EXISTS 重建
        const hasLocations =
          db
            .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'locations'")
            .get() !== null;
        if (hasLocations) {
          db.exec("PRAGMA foreign_keys = OFF;");
          db.exec("ALTER TABLE locations RENAME TO locations_v12;");
          db.exec(`
            CREATE TABLE locations (
              id TEXT PRIMARY KEY,
              novel_id TEXT NOT NULL REFERENCES novels(id),
              parent_id TEXT REFERENCES locations(id),
              name TEXT NOT NULL,
              description TEXT,
              x REAL,
              y REAL,
              layer TEXT,
              population INTEGER CHECK (population IS NULL OR population >= 0),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
          `);
          db.exec(`
            INSERT INTO locations (id, novel_id, parent_id, name, description, x, y, layer, population, created_at, updated_at)
            SELECT id, novel_id, parent_id, name, NULL, x, y, layer, population, created_at, updated_at FROM locations_v12;
          `);
          db.exec("DROP TABLE locations_v12;");
          db.exec("PRAGMA foreign_keys = ON;");
        }
      }
      if (version >= 8 && version <= 13) {
        // 13→14：foreshadows 增列 recover_act_node_id（回收幕节点，可空裸列——大纲规划
        // 的真相揭晓幕，章节规划按幕圈定回传「待回收」伏笔）。守卫覆盖 8~13：表自 v8
        // 起已存在，这些版本都持无此列的旧表形态（同 11→12 先例）；表异常缺失时跳过
        // ALTER，由下方 CREATE TABLE IF NOT EXISTS 直建目标形态
        const hasForeshadows =
          db
            .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'foreshadows'")
            .get() !== null;
        if (hasForeshadows) {
          db.exec("ALTER TABLE foreshadows ADD COLUMN recover_act_node_id TEXT;");
        }
      }
      // 9→10：新增 documents 表，无 ALTER——由下方 CREATE TABLE IF NOT EXISTS 幂等落地
      // 14→15：新增 style_references 表，无 ALTER——同上
      if (version <= 15) {
        // 15→16：小说创作条件直接绑定 novels。历史行保留 NULL，三列原子补齐，
        // 补列与版本一起提交；取得写锁后复查版本，防止另一进程已经迁移。
        // 守卫所在分支覆盖所有受支持的 v4~15 旧库；段内显式写 16（非 SCHEMA_VERSION），
        // 让后续 16→17 段在链式直升时继续执行
        db.transaction(() => {
          const lockedVersion = db.query("PRAGMA user_version").get() as { user_version: number };
          if (lockedVersion.user_version >= 16) return;
          db.exec("ALTER TABLE novels ADD COLUMN genre TEXT;");
          db.exec("ALTER TABLE novels ADD COLUMN audience TEXT;");
          db.exec("ALTER TABLE novels ADD COLUMN core_conflict TEXT;");
          db.exec("PRAGMA user_version = 16;");
        }).immediate();
      }
      // 16→17：outlines 增列 character_ids（章节登场角色 ID 绑定，JSON 文本，仅章节点由
      // 章节规划确认后的编排层回填）。旧行留 NULL 不回填——NULL 即「未绑定」语义
      // （正文生成回退全库角色注入）。补列与版本一起提交；取得写锁后复查版本，
      // 防止另一进程已经迁移；表缺失（非完整形态库）或列已存在时只写版本标记，
      // 由下方 CREATE TABLE IF NOT EXISTS 直建目标形态
      db.transaction(() => {
        const lockedVersion = db.query("PRAGMA user_version").get() as { user_version: number };
        if (lockedVersion.user_version === SCHEMA_VERSION) return;
        const outlineCols = db.query("PRAGMA table_info(outlines)").all() as Array<{ name: string }>;
        if (outlineCols.length > 0 && !outlineCols.some((col) => col.name === "character_ids")) {
          db.exec("ALTER TABLE outlines ADD COLUMN character_ids TEXT;");
        }
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
      }).immediate();
    } else {
      // 开发期旧库（<4，无客户端投产数据）或异常版本（>17 的库被旧代码打开）：重建兜底
      db.exec("DROP TABLE IF EXISTS documents;");
      db.exec("DROP TABLE IF EXISTS outlines;");
      db.exec("DROP TABLE IF EXISTS locations;");
      db.exec("DROP TABLE IF EXISTS foreshadows;");
      db.exec("DROP TABLE IF EXISTS characters;");
      db.exec("DROP TABLE IF EXISTS worldviews;");
      db.exec("DROP TABLE IF EXISTS novels;");
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      name TEXT,
      author TEXT,
      description TEXT,
      genre TEXT,
      audience TEXT,
      core_conflict TEXT,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      name TEXT NOT NULL,
      gender TEXT,
      appearance TEXT,
      desire TEXT NOT NULL,
      fear TEXT NOT NULL,
      narrative_role TEXT NOT NULL,
      background TEXT NOT NULL,
      personality TEXT,
      character_goal TEXT,
      creation_purpose TEXT NOT NULL,
      trajectory TEXT,
      ending_direction TEXT NOT NULL,
      relationships TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_at TEXT NOT NULL
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_characters_novel_id ON characters(novel_id);",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_versions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL REFERENCES characters(id),
      novel_id TEXT NOT NULL REFERENCES novels(id),
      version INTEGER NOT NULL CHECK (version >= 1),
      character TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_character_versions_character_id ON character_versions(character_id);",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS worldviews (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL UNIQUE REFERENCES novels(id),
      geography TEXT NOT NULL,
      fantasy_attributes TEXT,
      real_world_mapping TEXT,
      taboos TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS outlines (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      parent_id TEXT REFERENCES outlines(id),
      type TEXT NOT NULL CHECK (type IN ('part', 'act', 'chapter')),
      name TEXT NOT NULL,
      summary TEXT,
      key_plot_points TEXT,
      sort INTEGER NOT NULL CHECK (sort >= 1),
      version INTEGER NOT NULL CHECK (version >= 1),
      is_current_version INTEGER NOT NULL CHECK (is_current_version IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('deprecated', 'planned', 'writing', 'completed')),
      document_id TEXT,
      character_ids TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_outlines_novel_id ON outlines(novel_id);",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_outlines_parent_id ON outlines(parent_id);",
  );
  // sort 唯一性仅约束「同小说 + 同父级 + 当前版本」：根节点 parent_id 为 NULL，
  // SQLite 唯一索引视 NULL 互异，故用 COALESCE 归一后再判重；历史版本行不受限
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outlines_current_sort
    ON outlines(novel_id, COALESCE(parent_id, ''), sort)
    WHERE is_current_version = 1;
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      chapter_id TEXT NOT NULL UNIQUE REFERENCES outlines(id),
      file_path TEXT NOT NULL DEFAULT '',
      word_count INTEGER NOT NULL CHECK (word_count >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_documents_novel_id ON documents(novel_id);",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      parent_id TEXT REFERENCES locations(id),
      name TEXT NOT NULL,
      description TEXT,
      x REAL,
      y REAL,
      layer TEXT,
      population INTEGER CHECK (population IS NULL OR population >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_locations_novel_id ON locations(novel_id);",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_locations_parent_id ON locations(parent_id);",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS foreshadows (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      surface_action TEXT NOT NULL,
      hidden_truth TEXT NOT NULL,
      attention_level INTEGER NOT NULL CHECK (attention_level BETWEEN 1 AND 10),
      recovery_status TEXT NOT NULL DEFAULT 'unrecovered'
        CHECK (recovery_status IN ('unrecovered', 'partial', 'recovered')),
      planting_method TEXT,
      purpose TEXT,
      appear_chapter_id TEXT,
      act_node_id TEXT,
      recover_act_node_id TEXT,
      recover_chapter_ids TEXT,
      character_ids TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_foreshadows_novel_id ON foreshadows(novel_id);",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS style_references (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL REFERENCES novels(id),
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_style_references_novel_id ON style_references(novel_id);",
  );
  return db;
}

let defaultDb: Database | undefined;

/** 默认全局数据库连接（懒加载：避免模块导入即建库文件；各 store 共享） */
export function getDefaultDatabase(): Database {
  defaultDb ??= openDatabase();
  return defaultDb;
}
