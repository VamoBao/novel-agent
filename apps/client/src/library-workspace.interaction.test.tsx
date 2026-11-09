import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// 真 App + React/DOM，仅替换 Electron IPC；导航状态错配、分组丢节点或管理入口失效应失败。
test("三栏书库选中与结构分组可访问，管理和新增入口保持可用", async () => {
  const script = `
    import {Window} from 'happy-dom';
    const dom=new Window();Object.assign(globalThis,{window:dom,document:dom.document,IS_REACT_ACT_ENVIRONMENT:true});
    const {act,createElement}=await import('react');const {createRoot}=await import('react-dom/client');
    const {App}=await import('./src/App');
    const novel={id:'novel-private',name:'雾港来信',pinned:true,favorite:true,createdAt:'',updatedAt:''};
    const detail={novel,worldview:{background:{geography:'记忆可以买卖的海港'},taboos:['记忆无法改变过去']},characters:[],migrations:[],migrationVersions:[],documents:[],foreshadows:[],styleReferences:[],
      locations:[{id:'location-private',name:'旧灯塔',description:'主角藏身的废弃灯塔'}],outlineNodes:[]};
    let renamed=null;
    dom.agent={isAutostart:()=>false,autoSelectNovelId:()=>null,isSettingsOpen:()=>false,
      listNovels:async()=>[novel],getNovelDetail:async()=>detail,renameNovel:async(id,name)=>{renamed={id,name};return {...novel,name}},
      onMessage:()=>()=>{},onExit:()=>()=>{},stop:async()=>{}};
    const box=dom.document.createElement('div');dom.document.body.append(box);const root=createRoot(box);
    await act(async()=>root.render(createElement(App)));
    await act(async()=>box.querySelector('.novel-item').click());
    const pressed=box.querySelector('.novel-item').getAttribute('aria-pressed');
    const toggle=box.querySelector('[title="收起地点"]');const expanded=toggle?.getAttribute('aria-expanded');
    await act(async()=>[...box.querySelectorAll('.tree-node')].find(n=>n.textContent==='旧灯塔').click());
    const current=box.querySelector('.tree-node.active').getAttribute('aria-current');
    const content=box.querySelector('.preview').textContent;
    await act(async()=>toggle.click());
    const collapsed=![...box.querySelectorAll('.tree-node')].some(n=>n.textContent==='旧灯塔');
    await act(async()=>box.querySelector('[title="展开地点"]').click());
    const restored=[...box.querySelectorAll('.tree-node')].some(n=>n.textContent==='旧灯塔');
    await act(async()=>box.querySelector('.novel-item').dispatchEvent(new dom.MouseEvent('contextmenu',{bubbles:true})));
    await act(async()=>[...box.querySelectorAll('.context-menu button')].find(n=>n.textContent.includes('重命名')).click());
    await act(async()=>{const input=box.querySelector('.novel-item input');Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype,'value').set.call(input,'雾港新篇');input.dispatchEvent(new dom.Event('input',{bubbles:true}))});
    await act(async()=>box.querySelector('.novel-item input').dispatchEvent(new dom.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    await act(async()=>box.querySelector('[title="新增角色"]').click());
    const creating=!!box.querySelector('.character-form');
    const result={pressed,expanded,current,content,collapsed,restored,renamed,creating,leaked:box.textContent.includes('novel-private')||box.textContent.includes('location-private')};
    await act(async()=>root.unmount());await dom.happyDOM.close();process.stdout.write(JSON.stringify(result));
  `;
  const proc=Bun.spawn([process.execPath,"--eval",script],{cwd:fileURLToPath(new URL("..",import.meta.url)),stdout:"pipe",stderr:"pipe"});
  const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
  expect(err).toBe("");expect(code).toBe(0);
  const result=JSON.parse(out);
  expect(result.pressed).toBe("true");expect(result.expanded).toBe("true");expect(result.current).toBe("true");
  expect(result.content).toContain("主角藏身的废弃灯塔");
  expect(result.collapsed).toBe(true);expect(result.restored).toBe(true);
  expect(result.renamed).toEqual({id:"novel-private",name:"雾港新篇"});expect(result.creating).toBe(true);expect(result.leaked).toBe(false);
});

// 展示分区重组不能丢失可选字段、作者指导或世界禁忌，也不能给角色基准增加编辑入口。
test.each(["character", "worldview"])("资料预览分区保留全部设定：%s", async (kind) => {
  const script = `
    import {Window} from 'happy-dom';
    const dom=new Window();Object.assign(globalThis,{window:dom,document:dom.document,IS_REACT_ACT_ENVIRONMENT:true});
    const {act,createElement}=await import('react');const {createRoot}=await import('react-dom/client');
    const {PreviewPane}=await import('./src/components/PreviewPane');
    const {novelDetailSchema}=await import('@novel/shared');
    dom.agent={onMessage:()=>()=>{},onExit:()=>()=>{},stop:async()=>{}};
    const character={id:'private-character',version:1,updatedAt:'',basicInfo:{name:'林舟',gender:'女',appearance:'银色短发'},
      core:{narrativeRole:'主角',desire:'找回父亲的记忆',fear:'忘记自己的姓名'},background:'灯塔守望者的后代',
      personality:'谨慎而执拗',characterGoal:'重建潮汐档案',creationPurpose:'追问记忆与身份的关系',trajectory:'从逃避到面对',endingDirection:'选择保留伤痛',relationships:'与修复师结成同盟'};
    const worldview={background:{geography:'雾港城邦',fantasyAttributes:'记忆可化为晶体',realWorldMapping:'近代港口社会'},taboos:['记忆不能改变过去','记忆不能凭空创造']};
    const detail=novelDetailSchema.parse({novel:{id:'private-novel',name:'雾港来信',pinned:false,favorite:false,createdAt:'',updatedAt:''},
      worldview,characters:[character],migrations:[],migrationVersions:[],outlineNodes:[],documents:[],foreshadows:[],locations:[],styleReferences:[]});
    const box=dom.document.createElement('div');const root=createRoot(box);const kind=process.env.PROFILE_KIND;
    await act(async()=>root.render(createElement(PreviewPane,{detail,loading:false,error:null,selection:kind==='character'?{kind,characterId:character.id}:{kind}})));
    const groups=[...box.querySelectorAll('section[aria-label]')].map(n=>n.getAttribute('aria-label'));
    const result={groups,text:box.textContent,buttons:[...box.querySelectorAll('button')].map(n=>n.textContent)};
    await act(async()=>root.unmount());await dom.happyDOM.close();process.stdout.write(JSON.stringify(result));
  `;
  const proc=Bun.spawn([process.execPath,"--eval",script],{cwd:fileURLToPath(new URL("..",import.meta.url)),env:{...process.env,PROFILE_KIND:kind},stdout:"pipe",stderr:"pipe"});
  const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
  expect(err).toBe("");expect(code).toBe(0);
  const result=JSON.parse(out);
  if(kind === "character") {
    expect(result.groups).toContain("角色内核");expect(result.groups).toContain("创作方向");
    for(const value of ["林舟","女","银色短发","主角","找回父亲的记忆","忘记自己的姓名","灯塔守望者的后代","谨慎而执拗","重建潮汐档案","追问记忆与身份的关系","从逃避到面对","选择保留伤痛","与修复师结成同盟"]) expect(result.text).toContain(value);
    expect(result.text).toContain("角色迁移");expect(result.buttons.join(" ")).not.toContain("编辑角色");
  } else {
    expect(result.groups).toContain("世界背景");expect(result.groups).toContain("世界禁忌");
    for(const value of ["雾港城邦","记忆可化为晶体","近代港口社会","记忆不能改变过去","记忆不能凭空创造"]) expect(result.text).toContain(value);
  }
  expect(result.text).not.toContain("private-");
});
