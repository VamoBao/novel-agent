import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// 删除开始事件、错配并发工具、仅在 step 结束时上报或漏掉失败收尾，都应使这些测试失败。
test.each(["success", "tool-error", "model-error", "unfinished"])("真实 SDK 活动与用户提问关联：%s", async (scenario) => {
  const script = `
    import { tool } from 'ai';
    import { z } from 'zod';
    import { runReactAgent } from './src/agents/react';
    import { ProtocolChannel } from './src/ui/protocol-channel';
    import { agentMessageSchema } from '@novel/shared';
    globalThis.AI_SDK_LOG_WARNINGS = false;
    const scenario = process.env.ACTIVITY_SCENARIO;
    const messages = [], during = [];
    let calls = 0;
    const channel = new ProtocolChannel(message => {
      messages.push(agentMessageSchema.parse(message));
      if (message.type === 'request') {
        during.push(messages.filter(m => m.type === 'activity').map(m => m.activity));
        queueMicrotask(() => channel.handleLine(JSON.stringify({type:'response', id:message.id, answer:'海港'})));
      }
    });
    globalThis.fetch = async () => {
      calls++;
      if (calls > 1 && scenario === 'model-error') return Response.json({error:{message:'额度耗尽'}},{status:401});
      return Response.json({ id:'completion-' + calls, object:'chat.completion', created:1, model:'test',
        choices:[{index:0,finish_reason:calls === 1 ? 'tool_calls':'stop',message: calls === 1
          ? {role:'assistant',content:null,tool_calls:[
              {id:'ask',type:'function',function:{name:'ask_user',arguments:'{"prompt":"故事发生在哪里？"}'}},
              {id:'lookup',type:'function',function:{name:'lookup',arguments:'{"name":"海港","id":"internal-id","apiKey":"secret"}'}},
            ]}
          : {role:'assistant',content:'世界观整理完成'}}],
        usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2} });
    };
    let error = null;
    await runReactAgent({system:'隐藏系统提示', prompt:'收集世界观', maxSteps:2, continuationMax:0,
      activity:{channel,name:'世界观 Agent',input:'用户描述的海港城市'},
      ...(scenario === 'unfinished' ? {isDone:()=>false}:{}),
      tools:{
        ask_user:tool({description:'提问',inputSchema:z.object({prompt:z.string()}),execute:({prompt})=>channel.askLine(prompt)}),
        lookup:tool({description:'查询',inputSchema:z.object({name:z.string(),id:z.string(),apiKey:z.string()}),execute:async ({name})=>{
          if(scenario === 'tool-error') throw new Error('地点查询失败');
          return {name,id:'private-result-id'};
        }}),
      },
    }).catch(e=>{error=e.message});
    channel.close();
    process.stdout.write(JSON.stringify({messages,during,error}));
  `;
  const proc = Bun.spawn([process.execPath, "--eval", script], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...process.env, AGENT_MODEL_API_KEY: "test", AGENT_MODEL_BASE_URL: "https://example.com/v1", ACTIVITY_SCENARIO: scenario },
    stdout: "pipe", stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(err).toBe("");
  expect(code).toBe(0);
  const { messages, during, error } = JSON.parse(out);
  const events = messages.filter((m: {type: string}) => m.type === "activity").map((m: {activity: unknown}) => m.activity);
  expect(events[0]).toMatchObject({kind:"agent",name:"世界观 Agent",status:"running"});
  const starts = events.filter((a: {kind:string;status:string}) => a.kind === "tool" && a.status === "running");
  expect(starts).toHaveLength(2);
  expect(new Set(starts.map((a: {id:string}) => a.id)).size).toBe(2);
  expect(starts.every((a: {parentId:string}) => a.parentId === events[0].id)).toBe(true);
  const request = messages.find((m: {type:string}) => m.type === "request");
  expect(request.activityId).toBe(starts.find((a: {name:string}) => a.name === "ask_user").id);
  expect(during[0]).toContainEqual(expect.objectContaining({name:"ask_user",status:"running"}));
  for (const start of starts) {
    expect(events).toContainEqual(expect.objectContaining({
      id:start.id, status:scenario === "tool-error" && start.name === "lookup" ? "failed" : "completed",
      endedAt:expect.any(Number),
    }));
  }
  expect(events.at(-1).status).toBe(scenario === "model-error" || scenario === "unfinished" ? "failed" : "completed");
  expect(Boolean(error)).toBe(scenario === "model-error");
  expect(JSON.stringify(events)).not.toContain("secret");
  expect(JSON.stringify(events)).not.toContain("internal-id");
  expect(JSON.stringify(events)).not.toContain("private-result-id");
  expect(JSON.stringify(events)).not.toContain("隐藏系统提示");
});
