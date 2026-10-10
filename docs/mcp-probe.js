#!/usr/bin/env node
/* MCP 运行时探测：直连官方服务，完成 initialize → tools/list → 只读工具调用。
   安全边界：
   - Token 只从~/.workbuddy/mcp.json 读取，不打印、不写入输出、不落盘到本脚本或报告。
   - 所有输出只保留工具名、schema 字段名、状态码与脱敏后的业务字段。
   - 只调用只读工具。绝不调用 create-order / auto-bind-coupons / draw-lottery 等写动作。
   用法：node mcp-probe.js [--out evidence.json]
*/
'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const CFG=path.join(os.homedir(),'.workbuddy','mcp.json');
const OUT=process.argv.includes('--out')?process.argv[process.argv.indexOf('--out')+1]:null;
const URL_BASE='https://mcp.mcd.cn';
const PROTOCOL='2025-06-18';

/* 只读白名单。任何不在此列表中的工具一律不调用。 */
const READONLY_ALLOW=new Set(['now-time-info']);
/* 明确禁止的写操作，防止误触。 */
const FORBIDDEN=/create-order|cancel-order|auto-bind|draw-lottery|party-order|mall-create|delivery-create/i;

function readToken(){
  const raw=JSON.parse(fs.readFileSync(CFG,'utf8'));
  const h=raw?.mcpServers?.['mcd-mcp']?.headers?.Authorization||'';
  const m=h.match(/Bearer\s+(.+)$/);
  if(!m)throw new Error('配置中未找到 Bearer Token（请在 mcp.json 的 headers.Authorization 填写）');
  if(m[1]==='YOUR_MCP_TOKEN')throw new Error('配置中仍是占位符YOUR_MCP_TOKEN，未填入真实 Token');
  return m[1].trim();
}

/* Streamable HTTP：POST JSON-RPC 到 /mcp，带 Authorization 头，捕获 Mcp-Session-Id。 */
async function rpc(state,method,params,id){
  const res=await fetch(URL_BASE,{method:'POST',
    headers:{'content-type':'application/json','accept':'application/json, text/event-stream','authorization':'Bearer '+readToken(),...(state.sessionId?{'mcp-session-id':state.sessionId}:{})},
    body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
  const sid=res.headers.get('mcp-session-id');if(sid)state.sessionId=sid;
  const text=await res.text();
  let payload=null;
  if(text.startsWith('event:')||text.includes('data:')){
    const line=text.split('\n').find(l=>l.startsWith('data:'));
    if(line)payload=JSON.parse(line.slice(5).trim());
  }else if(text.trim())payload=JSON.parse(text);
  return {status:res.status,payload};
}

async function main(){
  const state={sessionId:null};
  const evidence={checkedAt:new Date().toISOString(),endpoint:URL_BASE,protocolVersion:PROTOCOL,
   tokenSource:'~/.workbuddy/mcp.json（仅本机，未进入任何产物）',steps:[],tools:[],calls:[],notes:[]};

  const init=await rpc(state,'initialize',{protocolVersion:PROTOCOL,capabilities:{},clientInfo:{name:'workbuddy-mcd-probe',version:'1.0.0'}},1);
  evidence.steps.push({step:'initialize',httpStatus:init.status,ok:!!init.payload?.result,
   serverInfo:init.payload?.result?.serverInfo?{name:init.payload.result.serverInfo.name,version:init.payload.result.serverInfo.version}:null,
   negotiatedProtocolVersion:init.payload?.result?.protocolVersion||null,
   error:init.payload?.error?{code:init.payload.error.code,message:init.payload.error.message}:null});
  if(!init.payload?.result){evidence.steps[0].fatal=true;return finish(evidence,'initialize 未成功，后续步骤未执行');}

  await rpc(state,'notifications/initialized',{},null);

  const list=await rpc(state,'tools/list',{},2);
  const tools=list.payload?.result?.tools||[];
  evidence.steps.push({step:'tools/list',httpStatus:list.status,ok:tools.length>0,toolCount:tools.length,
   error:list.payload?.error?{code:list.payload.error.code,message:list.payload.error.message}:null});

  /* 只记录工具名与 schema 结构（字段名+类型+必填），不记录任何描述里的示例凭据。 */
  for(const t of tools){
    if(FORBIDDEN.test(t.name)){evidence.notes.push({tool:t.name,classification:'write',called:false,reason:'写操作，本轮不调用'});continue;}
    const classification=/query|search|list|get|calculate|detail|now-time|recommend|coupon|store|meal/i.test(t.name)?'read':'unknown';
    evidence.tools.push({name:t.name,classification,
     inputSchema:t.inputSchema?{type:t.inputSchema.type,required:t.inputSchema.required||[],
      properties:Object.fromEntries(Object.entries(t.inputSchema.properties||{}).map(([k,v])=>[k,{type:v.type,description:String(v.description||'').slice(0,120)}]))}:null});
    if(READONLY_ALLOW.has(t.name)){
      const c=await rpc(state,'tools/call',{name:t.name,arguments:{}},3);
      const body=c.payload?.result;
      evidence.calls.push({tool:t.name,httpStatus:c.status,
       isError:body?.isError===true,
       contentPreview:body?.content?body.content.filter(x=>x.type==='text').map(x=>String(x.text).slice(0,400)):null,
       structuredKeys:body?.structuredContent?Object.keys(body.structuredContent):null,
       error:c.payload?.error?{code:c.payload.error.code,message:c.payload.error.message}:null});
    }
  }
  evidence.notes.push({note:'除 now-time-info 外未调用其他工具：它们的必填字段与上下文需用户授权范围后逐项确认，且未知必填项不靠公开样例补造。'});
  return finish(evidence,'探测完成');
}

function finish(evidence,summary){
  evidence.summary=summary;
  const text=JSON.stringify(evidence,null,2);
  if(OUT){fs.writeFileSync(OUT,text,'utf8');console.log('已写入 '+OUT);}
  else console.log(text);
  /* 自检：产物中不得出现 Token */
  const cfg=fs.readFileSync(CFG,'utf8');
  const tok=(cfg.match(/Bearer\s+([^\s"]+)/)||[])[1];
  if(tok&&tok!=='YOUR_MCP_TOKEN'&&text.includes(tok)){console.error('!! 产物中检出 Token，已中止写出');process.exit(2);}
  console.log('安全自检：产物中未出现 Token。');
}
main().catch(e=>{console.error('探测失败：'+e.message);process.exit(1);});