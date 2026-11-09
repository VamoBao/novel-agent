import { useRef, useState } from "react";
import { ArrowRight, Check, CheckCheck, CornerDownLeft, PenLine } from "lucide-react";
import type { SessionAnswer, SessionRequest } from "../../hooks/session-timeline";
import { ViewCard } from "../ViewCard";
import { questionTitle } from "./creation-content";

/** 工作台输入卡内部控件；request key 负责隔离逐题状态。 */
export function CreationQuestion({ request, onAnswer, autoFocus = true }: {
  request: SessionRequest; onAnswer: (id: number, value: SessionAnswer) => void; autoFocus?: boolean;
}) {
  const { ask } = request;
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState(false);
  const composing = useRef(false);
  const submitted = useRef(false);
  const send = (value: SessionAnswer): void => {
    if (submitted.current) return;
    submitted.current = true;
    onAnswer(request.id, value);
  };
  const title = <h3 className="prompt" id={`question-${request.id}`}>{questionTitle(ask.prompt)}</h3>;
  const submitButton = (disabled: boolean, label = "继续") => <button type="submit" className="primary" disabled={disabled}>
    {label}<ArrowRight size={15} aria-hidden />
  </button>;

  if (ask.type === "confirm") return <section className="question workbench-question">
    {title}
    {ask.view ? <ViewCard view={ask.view} /> : null}
    <div className="creation-question-actions">
      <span className="creation-muted">确认后将继续下一步</span>
      <div className="row"><button onClick={() => send(false)}>我想调整一下</button>
        <button className="primary" onClick={() => send(true)}><CheckCheck size={16} aria-hidden />确认并继续</button></div>
    </div>
  </section>;

  if (ask.type === "multi") return <section className="question workbench-question">
    {title}<p className="creation-input-hint">可以选择多项，组合出你想要的方向。</p>
    <div className="creation-choices multi-choices">
      {ask.options.map((option) => <label key={option} className={`creation-choice ${picked.includes(option) ? "selected" : ""}`}>
        <input type="checkbox" checked={picked.includes(option)} onChange={(event) => setPicked((current) =>
          event.target.checked ? [...current, option] : current.filter((value) => value !== option))} />
        <span>{option}</span><Check className="choice-check" size={16} aria-hidden />
      </label>)}
    </div>
    <div className="creation-question-actions"><span className="creation-muted">已选择 {picked.length} 项</span>
      <button className="primary" disabled={!picked.length} onClick={() => send(picked)}>确认选择<ArrowRight size={15} aria-hidden /></button></div>
  </section>;

  if (ask.type === "select" && !custom) return <section className="question workbench-question">
    {title}<p className="creation-input-hint">选择一个方向，或写下你自己的想法。</p>
    <div className="creation-choices">
      {ask.options.map((option, index) => <button className="creation-choice" key={option} onClick={() => send(option)}>
        <span className="choice-index">{String(index + 1).padStart(2, "0")}</span><span>{option}</span><ArrowRight className="choice-arrow" size={16} aria-hidden />
      </button>)}
      {ask.allowCustom ? <button className="creation-choice custom-choice" onClick={() => setCustom(true)}><PenLine size={16} aria-hidden /><span>自定义方向</span></button> : null}
    </div>
  </section>;

  if (ask.type === "int") {
    const value = text === "" ? ask.default : Number(text);
    const valid = Number.isInteger(value) && value >= ask.min && value <= ask.max;
    return <form className="question workbench-question" onSubmit={(event) => { event.preventDefault(); if (valid) send(value); }}>
      {title}<p className="creation-input-hint">范围 {ask.min}–{ask.max}，留空使用默认值 {ask.default}。</p>
      <input className="creation-number" type="number" aria-labelledby={`question-${request.id}`} min={ask.min} max={ask.max} step={1}
        autoFocus={autoFocus} placeholder={String(ask.default)} value={text} onChange={(event) => setText(event.target.value)} />
      <div className="creation-question-actions"><span className={valid ? "creation-muted" : "creation-input-error"}>
        {valid ? "按 Enter 继续" : `请输入 ${ask.min}–${ask.max} 之间的整数`}</span>{submitButton(!valid)}</div>
    </form>;
  }

  const optional = ask.type === "text" && ask.optional;
  const valid = text.trim().length > 0 || optional;
  return <form className="question workbench-question" onSubmit={(event) => { event.preventDefault(); if (valid && !composing.current) send(text.trim()); }}>
    {title}
    <p className="creation-input-hint">{optional ? "还没想好也没关系，可以先跳过。" : "写下你的想法，AI 会与你一起补充细节。"}</p>
    <textarea aria-labelledby={`question-${request.id}`} autoFocus={autoFocus} rows={4} value={text}
      placeholder={optional ? "在这里写下你的想法（可选）…" : "在这里写下你的想法…"}
      onChange={(event) => setText(event.target.value)}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && !composing.current) {
          event.preventDefault(); if (valid) send(text.trim());
        }
      }} />
    <div className="creation-question-actions">
      {custom ? <button type="button" className="ghost" onClick={() => { setCustom(false); setText(""); }}>返回选项</button>
        : <span className="creation-muted keyboard-hint"><CornerDownLeft size={13} aria-hidden />Ctrl / ⌘ + Enter 提交</span>}
      {submitButton(!valid, optional && !text.trim() ? "暂时跳过" : "保存并继续")}
    </div>
  </form>;
}
