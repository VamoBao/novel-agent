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
          {/* 清单仅在大纲确认视图渲染（对齐 CLI renderView：full 视图不展示，避免误读「确认后自动入库」文案） */}
          {view.detail === "confirm" && view.newCharacters && view.newCharacters.length > 0 ? (
            <>
              <p className="part-name">✨ 本次大纲新增角色（确认后自动入库）</p>
              {view.newCharacters.map((c) => (
                <p key={c.name} className="act">
                  · {c.name}——{c.role}
                </p>
              ))}
            </>
          ) : null}
          {view.detail === "confirm" && view.newForeshadows && view.newForeshadows.length > 0 ? (
            <>
              <p className="part-name">✨ 本次大纲伏笔（确认后自动入库）</p>
              {view.newForeshadows.map((f) => (
                <p key={`${f.actName}-${f.surfaceAction}`} className="act">
                  · [{f.actName}] {f.surfaceAction} ⇢ {f.hiddenTruth}（注意度 {f.attentionLevel}，服务：{f.characterNames.join("、")}，回收幕：{f.recoverActNames.join("、")}）
                </p>
              ))}
            </>
          ) : null}
          {view.detail === "confirm" && view.newLocations && view.newLocations.length > 0 ? (
            <>
              <p className="part-name">✨ 本次大纲新增地点（确认后自动入库）</p>
              {view.newLocations.map((l) => (
                <p key={l.name} className="act">
                  · {l.name}——{l.description}
                </p>
              ))}
            </>
          ) : null}
        </section>
      );
    case "chapter-plan":
      return (
        <section className="viewcard">
          <h3>📑 章节规划草稿（{view.actName}）</h3>
          <dl>
            <dt>本幕梗概</dt>
            <dd>{view.actSummary}</dd>
          </dl>
          <p className="part-name">关键情节点</p>
          {view.keyPlotPoints.map((point, index) => (
            <p key={index} className="plot">
              {index + 1}) {point}
            </p>
          ))}
          <p className="part-name">拟分 {view.plan.chapters.length} 章</p>
          {view.plan.chapters.map((chapter, index) => (
            <div key={index} className="act">
              <p>
                第{index + 1}章 {chapter.name}：{chapter.summary}
              </p>
              <p className="plot">登场：{chapter.characters.map((c) => c.name).join("、")}</p>
            </div>
          ))}
          {view.newCharacters && view.newCharacters.length > 0 ? (
            <>
              <p className="part-name">✨ 本次规划新增角色（确认后自动入库）</p>
              {view.newCharacters.map((c) => (
                <p key={c.name} className="act">
                  · {c.name}——{c.role}
                </p>
              ))}
            </>
          ) : null}
          {view.newForeshadows && view.newForeshadows.length > 0 ? (
            <>
              <p className="part-name">✨ 本次规划新增伏笔（确认后自动入库）</p>
              {view.newForeshadows.map((f) => (
                <div key={`${f.chapterName}-${f.surfaceAction}`} className="act">
                  <p>
                    · [{f.chapterName}] {f.surfaceAction} ⇢ {f.hiddenTruth}（注意度 {f.attentionLevel}，服务：{f.characterNames.join("、")}）
                  </p>
                  {f.recoveryPlan.map((recovery) => (
                    <p key={recovery.actName} className="plot">
                      回收幕：{recovery.actName}：{recovery.chapterNames.length > 0 ? recovery.chapterNames.join("、") : "待细化（尚未规划回收章）"}
                    </p>
                  ))}
                </div>
              ))}
            </>
          ) : null}
          {view.foreshadowBindings && view.foreshadowBindings.length > 0 ? (
            <>
              <p className="part-name">🔗 伏笔绑定（确认后生效）</p>
              {view.foreshadowBindings.map((b) => (
                <p key={`${b.index}-${b.chapterName}`} className="plot">
                  {b.index}) → {b.chapterName}
                </p>
              ))}
            </>
          ) : null}
          {view.foreshadowRecoverBindings && view.foreshadowRecoverBindings.length > 0 ? (
            <>
              <p className="part-name">♻ 伏笔回收绑定（确认后生效）</p>
              {view.foreshadowRecoverBindings.map((binding) => (
                <p key={`${binding.index}-${binding.chapterName}`} className="plot">
                  {binding.index}) → {binding.chapterName}
                </p>
              ))}
            </>
          ) : null}
          {view.newLocations && view.newLocations.length > 0 ? (
            <>
              <p className="part-name">✨ 本次规划新增地点（确认后自动入库）</p>
              {view.newLocations.map((l) => (
                <p key={l.name} className="act">
                  · {l.name}——{l.description}
                </p>
              ))}
            </>
          ) : null}
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
