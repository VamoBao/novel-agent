import type { View } from "@novel/shared";

/** 只读视图渲染：世界观 / 冲突 / 大纲全量 / 字段摘要 / 角色卡（后两者多见于确认提问内嵌） */
export function ViewCard({ view }: { view: View }) {
  switch (view.kind) {
    case "worldview":
      return (
        <section className="viewcard">
          <h3>✅ 世界观已确认</h3>
          <dl>
            <dt>地理位置</dt>
            <dd>{view.worldview.background.geography}</dd>
            {view.worldview.background.fantasyAttributes ? (
              <>
                <dt>架空属性</dt>
                <dd>{view.worldview.background.fantasyAttributes}</dd>
              </>
            ) : null}
            {view.worldview.background.realWorldMapping ? (
              <>
                <dt>现实映射</dt>
                <dd>{view.worldview.background.realWorldMapping}</dd>
              </>
            ) : null}
            <dt>禁忌</dt>
            <dd>{view.worldview.taboos.join("；")}</dd>
          </dl>
        </section>
      );
    case "conflict":
      return (
        <section className="viewcard">
          <h3>✅ 核心冲突已确认</h3>
          <dl>
            <dt>由来</dt>
            <dd>{view.conflict.origin}</dd>
            <dt>影响</dt>
            <dd>{view.conflict.impact}</dd>
            <dt>理想解决</dt>
            <dd>{view.conflict.idealResolution}</dd>
          </dl>
        </section>
      );
    case "outline":
      return (
        <section className="viewcard">
          <h3>{view.detail === "confirm" ? "📖 大纲草稿" : "✅ 大纲已生成"}</h3>
          <p className="title-line">
            《{view.outline.title}》——{view.outline.logline}
          </p>
          {view.outline.theme ? <p className="dim">主题：{view.outline.theme}</p> : null}
          {view.outline.parts.map((part) => (
            <div key={part.name} className="part">
              <p className="part-name">▶ {part.name}：{part.summary}</p>
              {part.acts.map((act) => (
                <div key={act.name} className="act">
                  <p>
                    ▶ {act.name}：{act.summary}
                  </p>
                  {view.detail === "full"
                    ? act.keyPlotPoints.map((point, index) => (
                        <p key={index} className="plot">
                          {index + 1}) {point}
                        </p>
                      ))
                    : null}
                </div>
              ))}
            </div>
          ))}
        </section>
      );
    case "field-summary":
      return (
        <section className="viewcard">
          <p>
            📋 【{view.label}】{view.summary}
          </p>
        </section>
      );
    case "character-card":
      return (
        <section className="viewcard">
          <h3>📝 角色卡汇总</h3>
          <p className="title-line">
            👤 {view.character.basicInfo.name}（{view.character.core.narrativeRole}
            {view.character.basicInfo.gender ? `，${view.character.basicInfo.gender}` : ""}）
          </p>
          <dl>
            {view.character.basicInfo.appearance ? (
              <>
                <dt>外貌</dt>
                <dd>{view.character.basicInfo.appearance}</dd>
              </>
            ) : null}
            <dt>渴望</dt>
            <dd>{view.character.core.desire}</dd>
            <dt>恐惧</dt>
            <dd>{view.character.core.fear}</dd>
            <dt>背景</dt>
            <dd>{view.character.background}</dd>
            {view.character.personality ? (
              <>
                <dt>性格</dt>
                <dd>{view.character.personality}</dd>
              </>
            ) : null}
            {view.character.characterGoal ? (
              <>
                <dt>角色目的</dt>
                <dd>{view.character.characterGoal}</dd>
              </>
            ) : null}
            <dt>创作目的</dt>
            <dd>{view.character.creationPurpose}</dd>
            {view.character.trajectory ? (
              <>
                <dt>轨迹</dt>
                <dd>{view.character.trajectory}</dd>
              </>
            ) : null}
            <dt>结局方向</dt>
            <dd>{view.character.endingDirection}</dd>
            {view.character.relationships ? (
              <>
                <dt>关系</dt>
                <dd>{view.character.relationships}</dd>
              </>
            ) : null}
          </dl>
        </section>
      );
  }
}
