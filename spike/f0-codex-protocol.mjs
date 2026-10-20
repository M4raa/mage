// Solo metadatos saneados, cuenta desechable con copia de auth; no registra credenciales.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mage-f0-codex-002-'));
const profile=path.join(root,'profile');fs.mkdirSync(profile);const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
const auth=path.join(os.homedir(),'.codex','auth.json');
if(fs.existsSync(auth)) fs.copyFileSync(auth,path.join(profile,'auth.json'));
const env={...process.env,CODEX_HOME:profile};for(const k of Object.keys(env))if(/^(OPENAI_API_KEY|CODEX_API_KEY|MAGE_CODEX_API_KEY|ANTHROPIC_|CLAUDECODE)/.test(k))delete env[k];
const bin=process.env.MAGE_F0_CODEX_BIN||'codex';
const child=spawn(bin,['app-server'],{cwd:workspace,env,windowsHide:true,stdio:'pipe'});child.stderr.resume();
const pending=new Map();let seq=0;const events=[];const send=m=>child.stdin.write(JSON.stringify(m)+'\n');
createInterface({input:child.stdout}).on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}if(m.id!==undefined&&!m.method){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);p.resolve(m);}}else {
 events.push(m);
 if(m.id!==undefined && m.method){
  const cmd=String(m.params?.command??'');
  const safe=/Start-Sleep -Seconds (8|30)/.test(cmd)&&!/[;&`]/.test(cmd);
  send({id:m.id,result:{decision:safe?'accept':'decline'}});
  console.log(JSON.stringify({stage:'approval',method:m.method,safeSleep:safe}));
 }
}});
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,timer:setTimeout(()=>{pending.delete(id);reject(new Error('Timeout '+method));},30000)});send({id,method,params});});
try{
 await rpc('initialize',{clientInfo:{name:'mage-f0-002',version:'0.1.2'},capabilities:{experimentalApi:true}});send({method:'initialized'});
 const models=await rpc('model/list',{includeHidden:false});
 console.log(JSON.stringify({stage:'models',errorCode:models.error?.code,models:models.result?.data?.map(m=>({id:m.id,model:m.model,efforts:m.supportedReasoningEfforts?.map(e=>e.reasoningEffort)}))}));
 const account=await rpc('account/read',{refreshToken:false});console.log(JSON.stringify({stage:'account',present:Boolean(account.result?.account),type:account.result?.account?.type,errorCode:account.error?.code}));
 if(process.argv.includes('--real')) {
  const wait=async(predicate,name)=>{const deadline=Date.now()+90000;while(Date.now()<deadline){const hit=events.find(predicate);if(hit)return hit;await new Promise(r=>setTimeout(r,100));}throw new Error('Timeout '+name);};
  const model='gpt-6-luna';const effort='low';
  const start=await rpc('thread/start',{cwd:workspace,model,approvalPolicy:'on-request',sandbox:'workspace-write',config:{model_reasoning_effort:effort},baseInstructions:'Only perform the synthetic user request. Do not inspect files, accounts, configuration, network, or unrelated directories.',experimentalRawEvents:false});
  if(start.error) throw new Error('thread/start error code '+start.error.code);
  const threadId=start.result.thread.id;
  const turn=async(seconds,marker)=>{
   console.log(JSON.stringify({stage:'turn-attempt',model,effort,purpose:seconds===8?'steer':'interrupt'}));
   const r=await rpc('turn/start',{threadId,effort,model,input:[{type:'text',text:`Run exactly powershell.exe -NoProfile -Command "Start-Sleep -Seconds ${seconds}" using the shell tool, then reply only ${marker}. No other commands or tools.`}]});
   if(r.error)throw new Error('turn/start error code '+r.error.code);return r.result.turn.id;
  };
  const first=await turn(8,'F0_FIRST');
  await wait(m=>m.method==='item/started'&&m.params?.turnId===first&&m.params?.item?.type==='commandExecution','first command');
  const steer=await rpc('turn/steer',{threadId,expectedTurnId:first,input:[{type:'text',text:'Correction during the running sleep: your final reply must be only F0_STEERED instead of F0_FIRST. Do not start another command.'}]});
  console.log(JSON.stringify({stage:'steer',success:!steer.error,sameTurn:steer.result?.turnId===first,errorCode:steer.error?.code}));
  const done=await wait(m=>m.method==='turn/completed'&&m.params?.turn?.id===first,'first completion');
  const answers=events.filter(m=>m.method==='item/completed'&&m.params?.turnId===first&&m.params.item?.type==='agentMessage').map(m=>m.params.item.text??'').join('');
  console.log(JSON.stringify({stage:'steer-completion',status:done.params.turn.status,steeredMarker:answers.includes('F0_STEERED'),turnStartedCount:events.filter(m=>m.method==='turn/started').length}));
  const second=await turn(30,'F0_NEVER');
  await wait(m=>m.method==='item/started'&&m.params?.turnId===second&&m.params?.item?.type==='commandExecution','second command');
  const interrupted=await rpc('turn/interrupt',{threadId,turnId:second});
  const ended=await wait(m=>m.method==='turn/completed'&&m.params?.turn?.id===second,'interrupted completion');
  console.log(JSON.stringify({stage:'interrupt',success:!interrupted.error,status:ended.params.turn.status,errorCode:interrupted.error?.code}));
  const before=await rpc('thread/read',{threadId,includeTurns:true});
  await new Promise(r=>setTimeout(r,700));const rollback=await rpc('thread/rollback',{threadId,numTurns:1});console.log(JSON.stringify({stage:'rollback-diagnostic',errorCode:rollback.error?.code,message:rollback.error?.message?.replaceAll(root,'<temp>').slice(0,300)}));
  const revert=await rpc('thread/revert',{threadId,beforeTurnId:second});const readAfter=await rpc('thread/read',{threadId,includeTurns:true});console.log(JSON.stringify({stage:'revert',success:!revert.error,errorCode:revert.error?.code,message:revert.error?.message?.slice(0,200),remainingTurns:readAfter.result?.thread?.turns?.length}));
  const fork=await rpc('thread/fork',{threadId,cwd:workspace,model,approvalPolicy:'on-request',sandbox:'workspace-write'});
  console.log(JSON.stringify({stage:'rollback-fork',beforeTurns:before.result?.thread?.turns?.length,rollbackSuccess:!rollback.error,afterTurns:rollback.result?.thread?.turns?.length,forkSuccess:!fork.error,differentThread:fork.result?.thread?.id!==threadId,forkTurns:fork.result?.thread?.turns?.length,rollbackError:rollback.error?.code,forkError:fork.error?.code}));
  console.log(JSON.stringify({stage:'event-fixture',methods:[...new Set(events.map(m=>m.method))],items:[...new Set(events.map(m=>m.params?.item?.type).filter(Boolean))]}));
 }
}catch(e){console.log(JSON.stringify({stage:'failure',category:e.message.startsWith('Timeout')?e.message:e.message.replaceAll(root,'<temp>').slice(0,120)}));process.exitCode=1;
}finally{if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();for(const p of pending.values())clearTimeout(p.timer);await new Promise(r=>setTimeout(r,400));if(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))try{fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:300});}catch{console.log(JSON.stringify({stage:'cleanup',temporaryDirectoryStillLocked:true}));}}
