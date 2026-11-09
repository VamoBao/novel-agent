import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// 真 React/DOM，仅替换 Electron IPC。删掉历史卡、错误关联调用或输入法误提交应失败。
test("卡片工作台保留回答，等待状态关联正确工具，输入法不误提交", async () => {
  const script = `
    import {Window} from 'happy-dom';
    const dom=new Window();
    Object.assign(globalThis,{window:dom,document:dom.document,IS_REACT_ACT_ENVIRONMENT:true});
    const {act,createElement}=await import('react');
    const {createRoot}=await import('react-dom/client');
    const {CreationFlow}=await import('./src/components/CreationFlow');
    const box=dom.document.createElement('div');dom.document.body.append(box);
    const sent=[];let message;
    dom.agent={onMessage:cb=>{message=cb;return()=>{}},onExit:()=>()=>{},start:async()=>{},stop:async()=>{},respond:async(id,answer)=>{sent.push({id,answer})}};
    const root=createRoot(box);
    await act(async()=>root.render(createElement(CreationFlow,{onFinished:()=>{},onClose:()=>{}})));
    await act(async()=>{
      message({type:'notify',text:'本次创作 ID：private-novel-id'});
      message({type:'stage',stage:'worldview'});
      message({type:'activity',activity:{id:'a',kind:'agent',name:'世界观 Agent',status:'running',startedAt:Date.now()}});
      message({type:'activity',activity:{id:'t',parentId:'a',kind:'tool',name:'ask_user',status:'running',startedAt:Date.now(),input:'{"prompt":"描述海港"}'}});
      message({type:'request',id:1,activityId:'t',ask:{type:'text',prompt:'描述你的世界观> ',optional:false}});
    });
    const input=box.querySelector('textarea');
    const hasInput=!!input;
    const waiting=box.querySelectorAll('.activity-card[data-status="waiting"]').length;
    const cardsBefore=box.querySelectorAll('.creation-card').length;
    const hiddenId=!box.textContent.includes('private-novel-id');
    if(input){
      await act(async()=>{Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype,'value').set.call(input,'海港城市');input.dispatchEvent(new dom.Event('input',{bubbles:true}));});
      await act(async()=>input.dispatchEvent(new dom.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true})));
    }
    const composingSent=sent.length;
    if(input) await act(async()=>input.dispatchEvent(new dom.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true})));
    const history=box.querySelector('.answer-card')?.textContent;
    await act(async()=>{
      message({type:'activity',activity:{id:'t',parentId:'a',kind:'tool',name:'ask_user',status:'completed',startedAt:100,endedAt:200,output:'海港城市'}});
      message({type:'request',id:2,activityId:'a',ask:{type:'int',prompt:'需要几幕？',min:3,max:20,default:5}});
    });
    const number=box.querySelector('input[type="number"]');
    if(number) await act(async()=>{Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype,'value').set.call(number,'99');number.dispatchEvent(new dom.Event('input',{bubbles:true}));});
    const invalidDisabled=box.querySelector('.question .primary')?.disabled;
    await act(async()=>message({type:'error',message:'网络中断',fatal:true}));
    const interrupted=box.querySelectorAll('.activity-card[data-status="interrupted"]').length;
    const errorCard=!!box.querySelector('.creation-card.error-panel');
    const result={hasInput,waiting,cardsBefore,hiddenId,composingSent,sent,history,invalidDisabled,interrupted,errorCard,
      toolCards:box.querySelectorAll('.activity-card[data-kind="tool"]').length};
    await act(async()=>root.unmount());await dom.happyDOM.close();
    process.stdout.write(JSON.stringify(result));
  `;
  const proc = Bun.spawn([process.execPath,"--eval",script], {
    cwd:fileURLToPath(new URL("../..",import.meta.url)), stdout:"pipe",stderr:"pipe",
  });
  const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
  expect(err).toBe(""); expect(code).toBe(0);
  const result=JSON.parse(out);
  expect(result.hasInput).toBe(true);
  expect(result.waiting).toBe(2);
  expect(result.cardsBefore).toBeGreaterThanOrEqual(4);
  expect(result.hiddenId).toBe(true);
  expect(result.composingSent).toBe(0);
  expect(result.sent).toEqual([{id:1,answer:"海港城市"}]);
  expect(result.history).toContain("海港城市");
  expect(result.history).toContain("描述你的世界观");
  expect(result.invalidDisabled).toBe(true);
  expect(result.interrupted).toBe(1);
  expect(result.errorCard).toBe(true);
  expect(result.toolCards).toBe(1);
});

test("新输入卡覆盖自定义、单选、多选、默认数字和确认修改，逐题状态隔离", async () => {
  const script = `
    import {Window} from 'happy-dom';
    const dom=new Window();Object.assign(globalThis,{window:dom,document:dom.document,IS_REACT_ACT_ENVIRONMENT:true});
    const {act,createElement}=await import('react');const {createRoot}=await import('react-dom/client');
    const {CreationFlow}=await import('./src/components/CreationFlow');
    const box=dom.document.createElement('div');dom.document.body.append(box);
    const sent=[];let message;let scrolled=0;
    dom.HTMLElement.prototype.scrollIntoView=function(){scrolled++};
    dom.agent={onMessage:cb=>{message=cb;return()=>{}},onExit:()=>()=>{},start:async()=>{},stop:async()=>{},respond:async(id,answer)=>{sent.push({id,answer})}};
    const root=createRoot(box);await act(async()=>root.render(createElement(CreationFlow,{onFinished:()=>{},onClose:()=>{}})));
    const ask=async(id,ask)=>act(async()=>message({type:'request',id,ask}));
    const click=async(text)=>act(async()=>[...box.querySelectorAll('.question button')].find(n=>n.textContent.includes(text)).click());
    await ask(1,{type:'select',prompt:'类型',options:['科幻','悬疑'],allowCustom:true});
    await click('自定义方向');
    await act(async()=>{const input=box.querySelector('textarea');Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype,'value').set.call(input,'科幻悬疑');input.dispatchEvent(new dom.Event('input',{bubbles:true}))});
    await click('保存并继续');
    await ask(2,{type:'select',prompt:'视角',options:['第一人称','第三人称限知'],allowCustom:false});await click('第三人称限知');
    await ask(3,{type:'multi',prompt:'受众',options:['推理爱好者','科幻读者']});
    await act(async()=>box.querySelector('.question input[type="checkbox"]').click());await click('确认选择');
    await ask(4,{type:'multi',prompt:'再选一次',options:['推理爱好者','科幻读者']});
    const reset=!box.querySelector('.question input[type="checkbox"]').checked && box.querySelector('.question .primary').disabled;
    await act(async()=>box.querySelectorAll('.question input[type="checkbox"]')[1].click());await click('确认选择');
    await ask(5,{type:'int',prompt:'幕数',min:3,max:20,default:5});await click('继续');
    await ask(6,{type:'confirm',prompt:'确认设定？',default:true,view:{kind:'field-summary',label:'城市',summary:'海港'}});
    const confirmViews=box.querySelectorAll('.creation-input-card .viewcard').length;
    await click('我想调整一下');
    await ask(7,{type:'line',prompt:'修改意见'});
    const emptyDisabled=box.querySelector('.question .primary').disabled;
    const stream=box.querySelector('.creation-stream');
    Object.defineProperties(stream,{scrollHeight:{value:3000,configurable:true},clientHeight:{value:600,configurable:true}});
    await act(async()=>{stream.scrollTop=100;stream.dispatchEvent(new dom.Event('scroll',{bubbles:true}))});
    const before=scrolled;
    await act(async()=>message({type:'notify',text:'新进度'}));
    const noForcedScroll=scrolled===before;
    const latest=!!box.querySelector('.creation-latest');
    await act(async()=>box.querySelector('.creation-latest').click());
    const jumped=scrolled>before;
    const result={sent,reset,confirmViews,emptyDisabled,noForcedScroll,latest,jumped,history:box.querySelectorAll('.answer-card').length};
    await act(async()=>root.unmount());await dom.happyDOM.close();process.stdout.write(JSON.stringify(result));
  `;
  const proc=Bun.spawn([process.execPath,"--eval",script],{cwd:fileURLToPath(new URL("../..",import.meta.url)),stdout:"pipe",stderr:"pipe"});
  const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
  expect(err).toBe("");expect(code).toBe(0);
  const result=JSON.parse(out);
  expect(result.sent).toEqual([
    {id:1,answer:"科幻悬疑"},{id:2,answer:"第三人称限知"},{id:3,answer:["推理爱好者"]},
    {id:4,answer:["科幻读者"]},{id:5,answer:5},{id:6,answer:false},
  ]);
  expect(result.reset).toBe(true);expect(result.confirmViews).toBe(1);expect(result.emptyDisabled).toBe(true);
  expect(result.noForcedScroll).toBe(true);expect(result.latest).toBe(true);expect(result.jumped).toBe(true);
  expect(result.history).toBe(6);
});
