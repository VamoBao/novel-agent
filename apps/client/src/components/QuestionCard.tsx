import { useState } from "react";
import type { AgentMessage, Ask } from "@novel/shared";
import { ViewCard } from "./ViewCard";

type RequestMsg = Extract<AgentMessage, { type: "request" }>;
type Answer = string | string[] | boolean | number;

/** 当前待答问题卡：按 ask 类型切换输入控件；confirm 的内嵌视图渲染在提问上方 */
export function QuestionCard({
  request,
  onAnswer,
}: {
  request: RequestMsg;
  onAnswer: (id: number, answer: Answer) => void;
}) {
  const ask: Ask = request.ask;
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  switch (ask.type) {
    case "line":
    case "text": {
      const optional = ask.type === "text" && ask.optional;
      const submit = (): void => {
        if (text.length === 0 && !optional) return;
        onAnswer(request.id, text);
        setText("");
      };
      return (
        <section className="question">
          <p className="prompt">{ask.prompt}</p>
          <div className="row">
            <input
              autoFocus
              value={text}
              placeholder={optional ? "可留空直接提交" : "输入后回车提交"}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
            />
            <button className="primary" disabled={text.length === 0 && !optional} onClick={submit}>
              提交
            </button>
          </div>
        </section>
      );
    }
    case "select":
      return (
        <section className="question">
          <p className="prompt">{ask.prompt}</p>
          <div className="options">
            {ask.options.map((option) => (
              <button key={option} onClick={() => onAnswer(request.id, option)}>
                {option}
              </button>
            ))}
            {ask.allowCustom ? <CustomOption onSubmit={(value) => onAnswer(request.id, value)} /> : null}
          </div>
        </section>
      );
    case "multi":
      return (
        <section className="question">
          <p className="prompt">{ask.prompt}</p>
          <div className="options column">
            {ask.options.map((option) => (
              <label key={option}>
                <input
                  type="checkbox"
                  checked={picked.includes(option)}
                  onChange={(event) =>
                    setPicked((current) =>
                      event.target.checked
                        ? [...current, option]
                        : current.filter((item) => item !== option),
                    )
                  }
                />
                {option}
              </label>
            ))}
          </div>
          <button
            className="primary"
            disabled={picked.length === 0}
            onClick={() => {
              onAnswer(request.id, picked);
              setPicked([]);
            }}
          >
            提交（{picked.length}）
          </button>
        </section>
      );
    case "confirm":
      return (
        <section className="question">
          {ask.view ? <ViewCard view={ask.view} /> : null}
          <p className="prompt">{ask.prompt}</p>
          <div className="row">
            <button className="primary" onClick={() => onAnswer(request.id, true)}>
              确认{ask.default ? "（默认）" : ""}
            </button>
            <button onClick={() => onAnswer(request.id, false)}>否</button>
          </div>
        </section>
      );
    case "int": {
      const submit = (): void => {
        const value = Number(text);
        if (Number.isInteger(value) && value >= ask.min && value <= ask.max) {
          onAnswer(request.id, value);
          setText("");
        }
      };
      return (
        <section className="question">
          <p className="prompt">
            {ask.prompt}（{ask.min}-{ask.max}，直接回车默认 {ask.default}）
          </p>
          <div className="row">
            <input
              autoFocus
              inputMode="numeric"
              value={text}
              placeholder={`回车默认 ${ask.default}`}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  if (text.length === 0) {
                    onAnswer(request.id, ask.default);
                  } else {
                    submit();
                  }
                }
              }}
            />
            <button
              className="primary"
              onClick={() => (text.length === 0 ? onAnswer(request.id, ask.default) : submit())}
            >
              提交
            </button>
          </div>
        </section>
      );
    }
  }
}

function CustomOption({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  if (!open) {
    return (
      <button className="ghost" onClick={() => setOpen(true)}>
        ✏️ 自定义输入
      </button>
    );
  }
  return (
    <div className="row">
      <input
        autoFocus
        value={value}
        placeholder="自定义内容"
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        className="primary"
        disabled={value.length === 0}
        onClick={() => {
          onSubmit(value);
          setOpen(false);
          setValue("");
        }}
      >
        提交
      </button>
    </div>
  );
}
