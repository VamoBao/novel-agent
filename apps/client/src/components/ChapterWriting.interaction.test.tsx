import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// 真 PreviewPane 与章卡，仅替换 IPC；状态过早完成、丢报告或错归章节应失败。
test("正文过程卡即时准备、保留跨轮报告、保存成功后留存结果并隔离章节", async () => {
  const script = `
    import {Window} from 'happy-dom';import {novelDetailSchema} from '@novel/shared';
    const dom=new Window();Object.assign(globalThis,{window:dom,document:dom.document,IS_REACT_ACT_ENVIRONMENT:true});
    const {act,createElement}=await import('react');const {createRoot}=await import('react-dom/client');
    const {PreviewPane}=await import('./src/components/PreviewPane');
    let message,exit,saved=0;const starts=[];
    dom.agent={onMessage:cb=>{message=cb;return()=>{}},onExit:cb=>{exit=cb;return()=>{}},start:async o=>{starts.push(o)},stop:async()=>{}};
    const detail=novelDetailSchema.parse({novel:{id:'n',name:'雾港',pinned:false,favorite:false,createdAt:'',updatedAt:''},worldview:null,characters:[],migrations:[],migrationVersions:[],documents:[],foreshadows:[],locations:[],styleReferences:[],outlineNodes:['a','b'].map((id,i)=>({id,parentId:'act',type:'chapter',name:'第'+(i+1)+'章',sort:i+1,summary:'林舟追查灯塔线索',keyPlotPoints:null,characterIds:null}))});
    const box=dom.document.createElement('div');dom.document.body.append(box);const root=createRoot(box);
    const render=async id=>act(async()=>root.render(createElement(PreviewPane,{detail,loading:false,error:null,selection:{kind:'outline',outlineNodeId:id},onDocumentSaved:()=>{saved++}})));
    const click=async label=>act(async()=>[...box.querySelectorAll('button')].find(b=>b.textContent.includes(label))?.click());
    const status=()=>box.querySelector('.writing-process')?.getAttribute('data-status');
    const emit=async data=>act(async()=>message(data));
    await render('a');await click('生成本章正文');const preparing=status();
    const base={type:'write-progress',chapterNodeId:'a',round:1,totalRounds:3,stylePassScore:95};
    await emit({...base,phase:'review-style',stageResult:{phase:'review-content',result:{issues:[]}}});
    await emit({...base,phase:'review-consistency',stageResult:{phase:'review-style',result:{skipped:false,score:92,rationale:'节奏偏快',suggestions:['补充环境描写']}}});
    const threshold=box.querySelector('.writing-process')?.textContent ?? '';
    const report={round:1,passed:false,content:{issues:[]},style:{skipped:false,score:92,rationale:'节奏偏快',suggestions:['补充环境描写']},consistency:{issues:[]}};
    await emit({...base,round:2,phase:'revising',report});
    const revision=box.querySelector('.writing-process')?.textContent ?? '';
    await render('b');const isolated=!box.querySelector('.writing-process[data-status="running"]');
    const otherDisabled=[...box.querySelectorAll('button')].find(b=>b.textContent.includes('其他章节正在生成'))?.disabled;
    await render('a');const retained=box.querySelector('.writing-process')?.textContent.includes('补充环境描写');
    const passed={round:2,passed:true,content:{issues:[]},style:{skipped:false,score:97,rationale:'节奏一致',suggestions:[]},consistency:{issues:[]}};
    await emit({...base,round:2,phase:'saving',report:passed});const saving=status();const beforeSaved=saved;
    await emit({type:'run_finished',novelId:'n'});const completed=status();const compact=!box.querySelector('.writing-process-details').open;const completeText=box.querySelector('.writing-process')?.textContent ?? '';
    await act(async()=>exit(0));const afterExit=status();
    const result={preparing,threshold,revision,isolated,otherDisabled,retained,saving,beforeSaved,completed,compact,completeText,afterExit,saved,starts};
    await act(async()=>root.unmount());await dom.happyDOM.close();process.stdout.write(JSON.stringify(result));
  `;
  const proc=Bun.spawn([process.execPath,"--eval",script],{cwd:fileURLToPath(new URL("../..",import.meta.url)),stdout:"pipe",stderr:"pipe"});
  const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
  expect(err).toBe("");expect(code).toBe(0);const r=JSON.parse(out);
  expect(r.preparing).toBe("preparing");
  expect(r.threshold).toContain("95");expect(r.threshold).toContain("补充环境描写");
  expect(r.revision).toContain("第 1 轮");expect(r.revision).toContain("第 2");
  expect(r.isolated).toBe(true);expect(r.otherDisabled).toBe(true);expect(r.retained).toBe(true);
  expect(r.saving).toBe("running");expect(r.beforeSaved).toBe(0);
  expect(r.completed).toBe("completed");expect(r.compact).toBe(true);expect(r.completeText).toContain("正文已保存");
  expect(r.completeText).toContain("第 1 轮");expect(r.completeText).toContain("第 2 轮");
  expect(r.afterExit).toBe("completed");expect(r.saved).toBe(1);
  expect(r.starts).toEqual([{mode:"write-chapter",novelId:"n",chapterNodeId:"a"}]);
});

test.each(["fatal","exit","start-reject","old-exit"])("正文失败保留过程与重试：%s", async scenario=>{
  const script=`
    import {Window} from 'happy-dom';import {novelDetailSchema} from '@novel/shared';
    const dom=new Window();Object.assign(globalThis,{window:dom,document:dom.document,IS_REACT_ACT_ENVIRONMENT:true});
    const {act,createElement}=await import('react');const {createRoot}=await import('react-dom/client');const {PreviewPane}=await import('./src/components/PreviewPane');
    let message,exit,calls=0,saved=0,releaseStart,priorExitIgnored;
    dom.agent={onMessage:cb=>{message=cb;return()=>{}},onExit:cb=>{exit=cb;return()=>{}},start:async()=>{calls++;if(calls===1&&process.env.WRITING_SCENARIO==='start-reject')throw new Error('启动失败');if(calls===1&&process.env.WRITING_SCENARIO==='old-exit')await new Promise(resolve=>{releaseStart=resolve})},stop:async()=>{}};
    const detail=novelDetailSchema.parse({novel:{id:'n',name:'小说',pinned:false,favorite:false,createdAt:'',updatedAt:''},worldview:null,characters:[],migrations:[],migrationVersions:[],documents:[],foreshadows:[],locations:[],styleReferences:[],outlineNodes:[{id:'a',parentId:'act',type:'chapter',name:'第一章',sort:1,summary:'林舟找到线索',keyPlotPoints:null,characterIds:null}]});
    const box=dom.document.createElement('div');dom.document.body.append(box);const root=createRoot(box);
    await act(async()=>root.render(createElement(PreviewPane,{detail,loading:false,error:null,selection:{kind:'outline',outlineNodeId:'a'},onDocumentSaved:()=>{saved++}})));
    const click=async label=>act(async()=>[...box.querySelectorAll('button')].find(b=>b.textContent.includes(label))?.click());
    await click('生成本章正文');
    if(process.env.WRITING_SCENARIO==='fatal')await act(async()=>message({type:'error',fatal:true,message:'模型暂时不可用'}));
    if(process.env.WRITING_SCENARIO==='old-exit'){await act(async()=>exit(0));priorExitIgnored=box.querySelector('.writing-process')?.getAttribute('data-status')==='preparing';await act(async()=>releaseStart());}
    if(['exit','old-exit'].includes(process.env.WRITING_SCENARIO))await act(async()=>exit(1));
    const failed=box.querySelector('.writing-process')?.getAttribute('data-status');
    const reason=box.querySelector('.writing-process')?.textContent ?? '';
    await click('重新尝试');
    const retry=box.querySelector('.writing-process')?.getAttribute('data-status');
    const result={failed,reason,retry,calls,saved,priorExitIgnored};
    await act(async()=>root.unmount());await dom.happyDOM.close();process.stdout.write(JSON.stringify(result));
  `;
  const proc=Bun.spawn([process.execPath,"--eval",script],{cwd:fileURLToPath(new URL("../..",import.meta.url)),env:{...process.env,WRITING_SCENARIO:scenario},stdout:"pipe",stderr:"pipe"});
  const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
  expect(err).toBe("");expect(code).toBe(0);const r=JSON.parse(out);
  expect(r.failed).toBe("failed");expect(r.reason).toContain(scenario==="fatal"?"模型暂时不可用":scenario==="start-reject"?"启动失败":"未收到保存完成确认");
  expect(r.retry).toBe("preparing");expect(r.calls).toBe(2);expect(r.saved).toBe(0);
  if(scenario === "old-exit") expect(r.priorExitIgnored).toBe(true);
});

test("重新生成保留旧正文，失败后重试仍先确认覆盖", async()=>{
  const script=`
    import {Window} from 'happy-dom';import {novelDetailSchema} from '@novel/shared';
    const dom=new Window();Object.assign(globalThis,{window:dom,document:dom.document,IS_REACT_ACT_ENVIRONMENT:true});
    const {act,createElement}=await import('react');const {createRoot}=await import('react-dom/client');const {PreviewPane}=await import('./src/components/PreviewPane');
    let message,calls=0;
    dom.agent={onMessage:cb=>{message=cb;return()=>{}},onExit:()=>()=>{},start:async()=>{calls++},stop:async()=>{}};
    const detail=novelDetailSchema.parse({novel:{id:'n',name:'小说',pinned:false,favorite:false,createdAt:'',updatedAt:''},worldview:null,characters:[],migrations:[],migrationVersions:[],documents:[{id:'doc',chapterId:'a',filePath:'/tmp/old-prose.md',wordCount:8,updatedAt:'2026-11-01',content:'旧正文，完整保留。'}],foreshadows:[],locations:[],styleReferences:[],outlineNodes:[{id:'a',parentId:'act',type:'chapter',name:'第一章',sort:1,summary:'林舟找到线索',keyPlotPoints:null,characterIds:null}]});
    const box=dom.document.createElement('div');dom.document.body.append(box);const root=createRoot(box);
    await act(async()=>root.render(createElement(PreviewPane,{detail,loading:false,error:null,selection:{kind:'outline',outlineNodeId:'a'}})));
    const click=async label=>act(async()=>[...box.querySelectorAll('button')].find(b=>b.textContent===label)?.click());
    await click('重新生成');const confirmBefore=!!box.querySelector('[role="dialog"]');const before=calls;
    await click('开始重新生成');const during=box.querySelector('.prose-content')?.textContent;
    await act(async()=>message({type:'error',fatal:true,message:'写作模型不可用'}));
    const kept=box.querySelector('.prose-content')?.textContent;
    const notice=box.querySelector('.writing-recovery')?.textContent;
    await click('重新尝试');const confirmedAgain=!!box.querySelector('[role="dialog"]');const callsBeforeRetry=calls;
    await click('开始重新生成');
    const result={confirmBefore,before,during,kept,notice,confirmedAgain,callsBeforeRetry,calls,status:box.querySelector('.writing-process')?.getAttribute('data-status')};
    await act(async()=>root.unmount());await dom.happyDOM.close();process.stdout.write(JSON.stringify(result));
  `;
  const proc=Bun.spawn([process.execPath,"--eval",script],{cwd:fileURLToPath(new URL("../..",import.meta.url)),stdout:"pipe",stderr:"pipe"});
  const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
  expect(err).toBe("");expect(code).toBe(0);const r=JSON.parse(out);
  expect(r.confirmBefore).toBe(true);expect(r.before).toBe(0);
  expect(r.during).toBe("旧正文，完整保留。");expect(r.kept).toBe(r.during);expect(r.notice).toContain("原有正文仍保留");
  expect(r.confirmedAgain).toBe(true);expect(r.callsBeforeRetry).toBe(1);expect(r.calls).toBe(2);expect(r.status).toBe("preparing");
});
