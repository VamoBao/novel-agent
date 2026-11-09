import { Compass, Flag, Globe, Heart, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Character, Worldview } from "@novel/shared";

function ProfileSection({ title, icon: Icon, note, children }: {
  title: string; icon: LucideIcon; note?: string; children: ReactNode;
}) {
  return <section className="viewcard profile-card" aria-label={title}>
    <div className="profile-card-heading"><span className="profile-icon"><Icon size={17} aria-hidden /></span><h3>{title}</h3></div>
    {note ? <p className="profile-note">{note}</p> : null}
    {children}
  </section>;
}

function ProfileFields({ fields }: { fields: { label: string; value?: string; wide?: boolean }[] }) {
  return <dl className="profile-fields">{fields.filter((field) => field.value).map((field) =>
    <div className={`profile-field${field.wide ? " wide" : ""}`} key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>,
  )}</dl>;
}

/** 固定基准的只读资料；人物变化由独立迁移面板维护。 */
export function CharacterProfile({ character }: { character: Character }) {
  return <>
    <section className="viewcard profile-identity" aria-label="角色身份">
      <span className="profile-avatar"><UserRound size={25} aria-hidden /></span>
      <div className="profile-identity-content"><p className="profile-eyebrow">角色档案</p><h3>{character.basicInfo.name}</h3>
        <div className="profile-tags"><span>{character.core.narrativeRole}</span>{character.basicInfo.gender ? <span>{character.basicInfo.gender}</span> : null}</div></div>
      <span className="profile-readonly"><LockKeyhole size={12} aria-hidden />固定基准</span>
    </section>
    <ProfileSection title="角色内核" icon={Heart}>
      <ProfileFields fields={[
        { label: "渴望", value: character.core.desire }, { label: "恐惧", value: character.core.fear },
        { label: "角色目的", value: character.characterGoal, wide: true },
      ]} />
    </ProfileSection>
    <ProfileSection title="人物经历与个性" icon={Compass}>
      <ProfileFields fields={[
        { label: "背景", value: character.background, wide: true }, { label: "外貌", value: character.basicInfo.appearance },
        { label: "性格", value: character.personality }, { label: "关系", value: character.relationships, wide: true },
      ]} />
    </ProfileSection>
    <ProfileSection title="创作方向" icon={Flag} note="这些内容用于作者的创作指导，并不代表人物知情或已经发生。">
      <ProfileFields fields={[
        { label: "创作目的", value: character.creationPurpose }, { label: "轨迹", value: character.trajectory },
        { label: "结局方向", value: character.endingDirection },
      ]} />
    </ProfileSection>
  </>;
}

export function WorldviewProfile({ worldview }: { worldview: Worldview }) {
  return <>
    <ProfileSection title="世界背景" icon={Globe}>
      <ProfileFields fields={[
        { label: "地理位置", value: worldview.background.geography, wide: true },
        { label: "架空属性", value: worldview.background.fantasyAttributes },
        { label: "现实映射", value: worldview.background.realWorldMapping },
      ]} />
    </ProfileSection>
    <ProfileSection title="世界禁忌" icon={ShieldCheck} note="故事中始终需要遵守的世界规则。">
      <ol className="worldview-rules">{worldview.taboos.map((taboo, index) =>
        <li key={index}><span aria-hidden>{String(index + 1).padStart(2, "0")}</span><p>{taboo}</p></li>,
      )}</ol>
    </ProfileSection>
  </>;
}
