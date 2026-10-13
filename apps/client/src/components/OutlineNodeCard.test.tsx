import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocumentEntry, OutlineNodeEntry, ReviewReport } from "@novel/shared";
import { OutlineNodeCard, type ChapterWriteProgress } from "./OutlineNodeCard";

const chapter: OutlineNodeEntry = {
  id: "chapter-1", parentId: "act-1", type: "chapter", name: "第一章",
  sort: 1, summary: "少年拾得碎片", keyPlotPoints: null, characterIds: null,
};

function render(progress: ChapterWriteProgress): string {
  return renderToStaticMarkup(
    <OutlineNodeCard node={chapter} writing writeProgress={progress} />,
  );
}

describe("OutlineNodeCard 正文生成进度", () => {
  test("内容问题在下一阶段进行中立即显示警告和建议", () => {
    const html = render({
      round: 1, totalRounds: 3, phase: "review-style",
      stageResults: [{ phase: "review-content", result: { issues: [
        { kind: "worldview", description: "出现高铁", suggestion: "改为马车" },
      ] } }],
    });
    expect(html).toContain("⚠ 内容约束校验");
    expect(html).toContain("[世界观] 出现高铁 → 改为马车");
    expect(html).not.toContain("未达标（");
  });

  test("文风不达标和逻辑问题各在本阶段显示，完整报告继续汇总", () => {
    const report: ReviewReport = {
      round: 1, passed: false, content: { issues: [] },
      style: { skipped: false, score: 82, rationale: "句式偏短", suggestions: ["增加描写"] },
      consistency: { issues: [{ kind: "consistency", description: "时间冲突", suggestion: "统一时间" }] },
    };
    const html = render({
      round: 1, totalRounds: 3, phase: "saving", report,
      stageResults: [
        { phase: "review-content", result: report.content },
        { phase: "review-style", result: report.style },
        { phase: "review-consistency", result: report.consistency },
      ],
    });
    expect(html).toContain("⚠ 文风校验");
    expect(html).toContain("文风 82 分：句式偏短");
    expect(html).toContain("增加描写");
    expect(html).toContain("⚠ 前后自洽校验");
    expect(html).toContain("时间冲突 → 统一时间");
    expect(html).toContain("⚠️ 未达标（内容 0 处 · 文风 82 分 · 自洽 1 处）");
  });

  test("无文风要求显示跳过", () => {
    const html = render({ round: 1, totalRounds: 3, phase: "review-consistency", stageResults: [
      { phase: "review-content", result: { issues: [] } },
      { phase: "review-style", result: { skipped: true } },
    ] });
    expect(html).toContain("文风校验（已跳过）");
    expect(html).not.toContain("✓ 文风校验");
  });
});

describe("OutlineNodeCard 迁移陈旧提示", () => {
  const document: DocumentEntry = {
    id: "doc-1",
    chapterId: "chapter-1",
    filePath: "灵脉拾遗-eeeeeeee/第一部/第一章.md",
    wordCount: 38,
    updatedAt: "2026-10-01T00:00:00.000Z",
    content: "正文内容。",
  };

  test("登场角色的迁移计划在正文之后更新：正文卡给出陈旧提示（含字段与序号与重生成建议）", () => {
    const html = renderToStaticMarkup(
      <OutlineNodeCard
        node={chapter}
        document={document}
        staleMigrations={[{ name: "林恒", fieldLabel: "性格", sequence: 2 }]}
      />,
    );
    expect(html).toContain("登场角色的迁移计划已更新");
    expect(html).toContain("林恒 性格 第 2 条");
    expect(html).toContain("🔄 重新生成");
  });

  test("无陈旧迁移（空数组）不渲染提示", () => {
    const html = renderToStaticMarkup(
      <OutlineNodeCard node={chapter} document={document} staleMigrations={[]} />,
    );
    expect(html).not.toContain("迁移计划已更新");
  });
});

describe("OutlineNodeCard 登场人物区块", () => {
  test("绑定章渲染登场人物名单，未绑定（旧数据）不渲染区块", () => {
    const bound = renderToStaticMarkup(
      <OutlineNodeCard
        node={{ ...chapter, characterIds: ["c-1", "c-2"] }}
        castNames={["林恒", "萧无咎"]}
      />,
    );
    expect(bound).toContain("🎭 登场人物");
    expect(bound).toContain("林恒、萧无咎");

    const unbound = renderToStaticMarkup(
      <OutlineNodeCard node={chapter} castNames={null} />,
    );
    expect(unbound).not.toContain("登场人物");
  });
});
