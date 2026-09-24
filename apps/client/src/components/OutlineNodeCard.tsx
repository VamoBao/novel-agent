import type { OutlineNodeEntry } from "@novel/shared";

/**
 * 大纲节点只读卡片：只展示梗概与关键情节点（仅幕节点有）——
 * 节点名与类型以左栏结构树为准（点击时已高亮），右栏不再重复；
 * 浏览路径专用，不进 shared 的 View 体系——
 * 避免浏览专用视图渗入创作流协议（protocol.ts 内嵌 viewSchema）。
 * 历史数据（6 版迁移前入库）summary / keyPlotPoints 为 null，展示空占位。
 */
export function OutlineNodeCard({ node }: { node: OutlineNodeEntry }) {
  return (
    <section className="viewcard">
      <dl>
        <dt>梗概</dt>
        {node.summary ? (
          <dd>{node.summary}</dd>
        ) : (
          <dd className="dim">（暂无梗概——旧数据未入库内容）</dd>
        )}
      </dl>
      {node.type === "act" ? (
        <div className="act">
          <p className="part-name">关键情节点</p>
          {node.keyPlotPoints ? (
            node.keyPlotPoints.map((point, index) => (
              <p key={index} className="plot">
                {index + 1}) {point}
              </p>
            ))
          ) : (
            <p className="dim">（暂无关键情节点——旧数据未入库内容）</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
