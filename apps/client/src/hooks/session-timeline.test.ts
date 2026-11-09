import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// 真 hook + React；丢失答案、合并同名工具、重复发送或恢复时残留旧活动应使测试失败。
test("会话时间流保留答案、正确更新并发工具，失败和重试收尾", async () => {
  const script = `
    import { Window } from 'happy-dom';
    const dom = new Window();
    Object.assign(globalThis,{window:dom,document:dom.document,IS_REACT_ACT_ENVIRONMENT:true});
    const {act,createElement} = await import('react');
    const {createRoot} = await import('react-dom/client');
    const {useAgentSession} = await import('./src/hooks/use-agent-session');
    let session, message, exit;
    const sent=[], starts=[];
    dom.agent={
      onMessage:cb=>{message=cb;return()=>{}},onExit:cb=>{exit=cb;return()=>{}},
      start:async options=>{starts.push(options??null);message({type:'workflow-run',runId:'run',novelId:'novel'})},
      stop:async()=>{},respond:async(id,answer)=>{sent.push({id,answer})},
    };
    const root=createRoot(dom.document.createElement('div'));
    function Harness(){session=useAgentSession({onFinished:()=>{}});return null;}
    await act(async()=>root.render(createElement(Harness)));
    await act(async()=>{
      message({type:'stage',stage:'worldview'});
      for(const [id,kind,parentId] of [['agent','agent',undefined],['one','tool','agent'],['two','tool','agent']]){
        message({type:'activity',activity:{id,kind,parentId,name:kind==='tool'?'save_field':'世界观 Agent',status:'running',startedAt:100}});
      }
      message({type:'request',id:1,activityId:'one',ask:{type:'text',prompt:'世界是什么样？',optional:false}});
      message({type:'request',id:2,activityId:'two',ask:{type:'confirm',prompt:'保存城市？',default:true}});
    });
    await act(async()=>{session.answer(1,'海港');session.answer(1,'重复发送');});
    const afterAnswer=session.timeline;
    const next=session.currentRequest?.id;
    await act(async()=>message({type:'error',message:'可以继续的提示',fatal:false}));
    const nonFatal=session.timeline;
    await act(async()=>message({type:'activity',activity:{id:'two',kind:'tool',parentId:'agent',name:'save_field',status:'completed',startedAt:100,endedAt:150,output:'已保存'}}));
    await act(async()=>message({type:'error',message:'网络中断',fatal:true}));
    const failed=session.timeline;
    await act(async()=>session.start());
    const restarted=session.timeline;
    await act(async()=>{
      message({type:'request',id:1,ask:{type:'text',prompt:'恢复后新问题',optional:false}});
      message({type:'activity',activity:{id:'new',kind:'agent',name:'大纲 Agent',status:'running',startedAt:200}});
      exit(143);
    });
    const interrupted=session.timeline;
    await act(async()=>root.unmount());
    await dom.happyDOM.close();
    process.stdout.write(JSON.stringify({afterAnswer,next,sent,failed,restarted,interrupted,starts,nonFatal}));
  `;
  const proc = Bun.spawn([process.execPath, "--eval", script], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), stdout: "pipe", stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(err).toBe("");
  expect(code).toBe(0);
  const result = JSON.parse(out);
  expect(result.afterAnswer).toBeArray();
  expect(result.sent).toEqual([{id:1,answer:"海港"}]);
  expect(result.next).toBe(2);
  expect(result.nonFatal).toContainEqual(expect.objectContaining({kind:"notify",text:"可以继续的提示",tone:"error"}));
  const answered = result.afterAnswer.find((entry: {kind:string;request?:{id:number}}) => entry.kind === "request" && entry.request?.id === 1);
  expect(answered).toMatchObject({answer:"海港",stage:"worldview"});
  expect(result.afterAnswer.filter((entry: {kind:string}) => entry.kind === "activity")).toHaveLength(3);
  const activities = result.failed.filter((entry: {kind:string}) => entry.kind === "activity");
  expect(activities.map((entry: {activity:{id:string;status:string}}) => [entry.activity.id,entry.activity.status])).toEqual([
    ["agent","interrupted"],["one","interrupted"],["two","completed"],
  ]);
  expect(result.failed.find((entry: {kind:string;request?:{id:number}}) => entry.kind === "request" && entry.request?.id === 2).interrupted).toBe(true);
  expect(result.restarted).toEqual([]);
  expect(result.starts).toEqual([null,{mode:"resume",runId:"run"}]);
  expect(result.interrupted.at(-1).activity.status).toBe("interrupted");
});
