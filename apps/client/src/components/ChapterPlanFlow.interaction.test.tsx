import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// 真组件与会话泵，仅替换 IPC；丢掉活动/回答历史、错误重试换目标或强制滚动应失败。
test("章节工作台保留问答与方案，关联活动等待，导航定位并从失败流程恢复", async () => {
  const script = `
    import { Window } from 'happy-dom';
    const dom = new Window();
    Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { act, createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { ChapterPlanFlow } = await import('./src/components/ChapterPlanFlow');
    let message, exit, closed = 0, finished;
    const starts = [], sent = [], scrolls = [];
    dom.HTMLElement.prototype.scrollIntoView = function () { scrolls.push(this.className); };
    dom.agent = {
      onMessage: cb => { message = cb; return () => {}; }, onExit: cb => { exit = cb; return () => {}; },
      start: async options => { starts.push(options); message({ type: 'workflow-run', runId: 'saved-plan', novelId: 'novel' }); },
      stop: async () => {}, respond: async (id, answer) => { sent.push({ id, answer }); },
    };
    const box = dom.document.createElement('div'); dom.document.body.append(box);
    const root = createRoot(box);
    await act(async () => root.render(createElement(ChapterPlanFlow, {
      novelId: 'novel', novelName: '潮汐档案', actNodeId: 'act', actName: '迷港来信', partName: '雾中的城',
      actSummary: '调查员追查失踪的灯塔守夜人。', keyPlotPoints: ['收到密信', '发现旧地图'],
      onClose: () => { closed++; }, onFinished: id => { finished = id; },
    })));
    const context = box.querySelector('.chapter-context')?.textContent ?? '';
    const emit = async event => act(async () => message(event));
    const click = async label => act(async () => [...box.querySelectorAll('button')].find(n => n.textContent.includes(label))?.click());
    await emit({ type: 'stage', stage: 'chapter' });
    for (const [id, kind, parentId] of [['a','agent',undefined],['ask','tool','a']]) {
      await emit({ type:'activity', activity:{id,kind,parentId,name:kind === 'agent' ? '章节规划 Agent' : 'ask_user',status:'running',startedAt:100} });
    }
    await emit({ type:'request',id:1,activityId:'ask',ask:{type:'int',prompt:'本幕安排几章？',min:2,max:10,default:4} });
    const waiting = box.querySelectorAll('.activity-card[data-status="waiting"]').length;
    await click('继续');
    const numberHistory = box.querySelector('.answer-card')?.textContent;
    const view = {kind:'chapter-plan',actName:'迷港来信',actSummary:'调查员追查失踪的灯塔守夜人。',keyPlotPoints:['收到密信','发现旧地图'],plan:{chapters:[{name:'夜航',summary:'林舟收到密信。',characters:[{name:'林舟',role:'调查员'}]}]},newCharacters:[{name:'林舟',role:'调查员'}],newLocations:[{name:'旧港',description:'密信中的目的地'}]};
    await emit({type:'request',id:2,activityId:'ask',ask:{type:'confirm',prompt:'确认本幕章节方案？',default:true,view}});
    const completePlan = box.querySelector('.creation-input-card')?.textContent ?? '';
    await click('我想调整一下');
    await emit({type:'request',id:3,activityId:'ask',ask:{type:'line',prompt:'想怎样调整节奏？'}});
    const input=box.querySelector('textarea');
    if (input) {
      await act(async()=>{Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype,'value').set.call(input,'先调查旧港，再揭示密信');input.dispatchEvent(new dom.Event('input',{bubbles:true}));});
      await act(async()=>input.dispatchEvent(new dom.KeyboardEvent('keydown',{key:'Enter',metaKey:true,isComposing:true,bubbles:true})));
    }
    const composingCount=sent.length;
    if(input) await act(async()=>input.dispatchEvent(new dom.KeyboardEvent('keydown',{key:'Enter',metaKey:true,bubbles:true})));
    const stream=box.querySelector('.creation-stream');
    let noForcedScroll=false, latest=false, jumped=false, navigated=false;
    if(stream) {
      Object.defineProperties(stream,{scrollHeight:{value:3000,configurable:true},clientHeight:{value:600,configurable:true}});
      await act(async()=>{stream.scrollTop=100;stream.dispatchEvent(new dom.Event('scroll',{bubbles:true}));});
      const before=scrolls.length;
      await emit({type:'notify',text:'正在整理章节关系'});
      noForcedScroll=scrolls.length===before; latest=!!box.querySelector('.creation-latest');
      if(latest) await click('回到最新内容');
      jumped=scrolls.length>before;
      const nav=box.querySelector('nav[aria-label="章节规划导航"]');
      const planButton=[...(nav?.querySelectorAll('button')??[])].find(n=>n.textContent.includes('章节方案'));
      const count=scrolls.length;
      if(planButton) await act(async()=>planButton.click());
      navigated=scrolls.length>count;
    }
    await emit({type:'error',message:'连接暂时中断',fatal:true});
    const interrupted=box.querySelectorAll('.activity-card[data-status="interrupted"]').length;
    const historyAfterError=box.querySelectorAll('.answer-card').length;
    const failure=box.querySelector('.creation-error')?.textContent ?? '';
    await click('继续未完成流程');
    const retryCleared=box.querySelectorAll('.answer-card').length===0;
    await emit({type:'run_finished',novelId:'novel'});
    const result={context,waiting,numberHistory,completePlan,composingCount,sent,noForcedScroll,latest,jumped,navigated,interrupted,historyAfterError,failure,starts,retryCleared,finished};
    await act(async()=>root.unmount()); await dom.happyDOM.close();
    process.stdout.write(JSON.stringify(result));
  `;
  const proc = Bun.spawn([process.execPath, "--eval", script], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), stdout: "pipe", stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(err).toBe(""); expect(code).toBe(0);
  const result = JSON.parse(out);
  expect(result.context).toContain("迷港来信");
  expect(result.context).toContain("调查员追查失踪的灯塔守夜人");
  expect(result.context).toContain("发现旧地图");
  expect(result.waiting).toBe(2);
  expect(result.numberHistory).toContain("4");
  expect(result.completePlan).toContain("夜航");
  expect(result.completePlan).toContain("林舟");
  expect(result.completePlan).toContain("旧港");
  expect(result.composingCount).toBe(2);
  expect(result.sent).toEqual([{id:1,answer:4},{id:2,answer:false},{id:3,answer:"先调查旧港，再揭示密信"}]);
  expect(result.noForcedScroll).toBe(true);
  expect(result.latest).toBe(true);
  expect(result.jumped).toBe(true);
  expect(result.navigated).toBe(true);
  expect(result.interrupted).toBe(2);
  expect(result.historyAfterError).toBe(3);
  expect(result.failure).toContain("连接暂时中断");
  expect(result.starts).toEqual([{mode:"plan-chapters",novelId:"novel",actNodeId:"act"},{mode:"resume",runId:"saved-plan"}]);
  expect(result.retryCleared).toBe(true);
  expect(result.finished).toBe("novel");
});

test("章节工作台保留调用展开，确认只提交一次并保留排队问题", async () => {
  const script = `
    import {Window} from 'happy-dom';
    const dom=new Window();Object.assign(globalThis,{window:dom,document:dom.document,IS_REACT_ACT_ENVIRONMENT:true});
    const {act,createElement}=await import('react');const {createRoot}=await import('react-dom/client');
    const {ChapterPlanFlow}=await import('./src/components/ChapterPlanFlow');
    let message;const sent=[];
    dom.agent={onMessage:cb=>{message=cb;return()=>{}},onExit:()=>()=>{},start:async()=>{},stop:async()=>{},respond:async(id,answer)=>{sent.push({id,answer})}};
    const box=dom.document.createElement('div');dom.document.body.append(box);const root=createRoot(box);
    await act(async()=>root.render(createElement(ChapterPlanFlow,{novelId:'n',novelName:'小说',actNodeId:'a',actName:'第一幕',onClose:()=>{},onFinished:()=>{}})));
    const emit=async(event)=>act(async()=>message(event));
    const tool={id:'save',kind:'tool',name:'save_chapters',status:'running',startedAt:100};
    await emit({type:'activity',activity:tool});
    const details=box.querySelector('.activity-card');details.open=true;
    await emit({type:'activity',activity:{...tool,status:'completed',endedAt:300,output:'已整理草稿'}});
    const stable=box.querySelector('.activity-card')===details && details.open;
    const view={kind:'chapter-plan',actName:'第一幕',actSummary:'追查失踪者',keyPlotPoints:['发现线索'],plan:{chapters:[{name:'线索',summary:'主角来到旧港。',characters:[{name:'主角',role:'追查者'}]}]}};
    await emit({type:'request',id:1,activityId:'save',ask:{type:'confirm',prompt:'确认章节？',default:true,view}});
    await emit({type:'request',id:2,ask:{type:'text',prompt:'后续补充',optional:true}});
    const queued=box.querySelectorAll('.creation-input-card.is-queued').length;
    const onlyOneInput=box.querySelectorAll('.question').length===1;
    const confirm=box.querySelector('.question button.primary');
    await act(async()=>{confirm.click();confirm.click();});
    const result={stable,queued,onlyOneInput,sent,history:box.querySelector('.answer-card')?.textContent,next:box.querySelector('textarea')!==null,
      noStageRoute:box.querySelector('nav[aria-label="小说创作阶段"]')===null};
    await act(async()=>root.unmount());await dom.happyDOM.close();process.stdout.write(JSON.stringify(result));
  `;
  const proc = Bun.spawn([process.execPath, "--eval", script], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), stdout: "pipe", stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(err).toBe(""); expect(code).toBe(0);
  const result=JSON.parse(out);
  expect(result.stable).toBe(true);
  expect(result.queued).toBe(1);
  expect(result.onlyOneInput).toBe(true);
  expect(result.sent).toEqual([{id:1,answer:true}]);
  expect(result.history).toContain("主角来到旧港");
  expect(result.next).toBe(true);
  expect(result.noStageRoute).toBe(true);
});
