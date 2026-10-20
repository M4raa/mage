import crypto from 'node:crypto';
// F0.3 Claude: SDK desempaquetado temporalmente, CLI real; no dependencia del proyecto.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import { pathToFileURL } from 'node:url';
const sdk=fs.readFileSync('audit/informes/evidencias-002/sdk-temp-path.txt','utf8').replace(/^\uFEFF/,'').trim();
const {query}=await import(pathToFileURL(path.join(sdk,'package/sdk.mjs')).href);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mage-f0-claude-002-'));const profile=path.join(root,'profile');fs.mkdirSync(profile);const work=path.join(root,'work');fs.mkdirSync(work);
const auth=path.join(os.homedir(),'.claude','.credentials.json');if(fs.existsSync(auth))fs.copyFileSync(auth,path.join(profile,'.credentials.json'));
fs.writeFileSync(path.join(profile,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true}));
const env={...process.env,CLAUDE_CONFIG_DIR:profile,CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_SAFE_MODE:'1'};
for(const k of Object.keys(env))if(/^(ANTHROPIC_|OPENAI_API_KEY|CODEX_API_KEY|CLAUDECODE|CLAUDE_CODE_OAUTH_TOKEN)/.test(k))delete env[k];
const queue=[];let wake;let ended=false;
const push=(text)=>{const uuid=crypto.randomUUID();queue.push({type:'user',uuid,session_id:'',parent_tool_use_id:null,message:{role:'user',content:text}});wake?.();return uuid;};
const prompt={async *[Symbol.asyncIterator](){while(!ended){if(queue.length){yield queue.shift();continue;}await new Promise(r=>wake=r);wake=undefined;}}};
const options={cwd:work,pathToClaudeCodeExecutable:process.env.MAGE_F0_CLAUDE_BIN,env,model:'haiku',effort:'low',settingSources:[],mcpServers:{},strictMcpConfig:true,persistSession:true,enableFileCheckpointing:true,includePartialMessages:true,canUseTool:async(name,input)=>{
 if(name==='Bash' && /^sleep (8|30)$/.test(input.command??''))return {behavior:'allow',updatedInput:input};
 if(['Read','Edit','Write'].includes(name)&&path.resolve(input.file_path??'')===path.resolve(work,'checkpoint.txt'))return {behavior:'allow',updatedInput:input};
 return {behavior:'deny',message:'Only synthetic checkpoint file or exact sleep command allowed in F0.'};
},stderr:()=>{}};
const q=query({prompt,options});
try{
 const models=await q.supportedModels();console.log(JSON.stringify({stage:'models',models:models.map(m=>({value:m.value,resolvedModel:m.resolvedModel,efforts:m.supportedEffortLevels}))}));
 if(process.argv.includes('--real')){
  let scenario='steer';let injected=false;let interruptSent=false;let results=0;let sessionId;let targetId;
  const firstId=push('Use Bash to execute exactly sleep 8. After it finishes reply only F0_FIRST. Do not inspect any files or use any other commands.');
  console.log(JSON.stringify({stage:'turn-attempt',purpose:'active-message',model:'haiku',effort:'low',message:'U1'}));
  const deadline=setTimeout(()=>{console.log(JSON.stringify({stage:'timeout'}));ended=true;wake?.();q.close();},180000);
  for await(const event of q){
   if(event.type==='system'&&event.subtype==='init'){sessionId=event.session_id;console.log(JSON.stringify({stage:'init',model:event.model}));}
   if(event.type==='assistant'){
    for(const block of event.message.content){
     if(block.type==='text') console.log(JSON.stringify({stage:'text-fixture',scenario,first:block.text.includes('F0_FIRST'),steered:block.text.includes('F0_STEERED'),checkpoint:block.text.includes('F0_EDITED')}));
     if(block.type==='tool_use'){
      console.log(JSON.stringify({stage:'tool',scenario,name:block.name}));
      if(scenario==='steer'&&block.name==='Bash'&&!injected){injected=true;push('Correction sent while the sleep tool is running: final reply only F0_STEERED instead of F0_FIRST. No new commands.');console.log(JSON.stringify({stage:'injected',duringTool:true,message:'U2'}));}
      if(scenario==='interrupt'&&block.name==='Bash'&&!interruptSent){interruptSent=true;setTimeout(async()=>{const r=await q.interrupt();console.log(JSON.stringify({stage:'interrupt-receipt',received:true,keys:r?Object.keys(r):[]}));},500);}
     }
    }
   }
   if(event.type==='result'){
    results++;console.log(JSON.stringify({stage:'result',scenario,subtype:event.subtype,numTurns:event.num_turns,isError:event.is_error,resultHasSteered:typeof event.result==='string'&&event.result.includes('F0_STEERED')}));
    if(scenario==='steer'){
     // A second message can finish as its own result. Wait briefly for it before moving on.
     if(results===1){await new Promise(r=>setTimeout(r,1000));}
     scenario='interrupt';push('Use Bash to execute exactly sleep 30, then reply F0_NEVER. No other tools.');console.log(JSON.stringify({stage:'turn-attempt',purpose:'interrupt',model:'haiku',effort:'low',message:'U3'}));
    }else if(scenario==='interrupt'){
     scenario='checkpoint';fs.writeFileSync(path.join(work,'checkpoint.txt'),'before\n');
     targetId=push('Read checkpoint.txt, then use Edit to change before to after in that file. Reply only F0_EDITED. No Bash or other files.');console.log(JSON.stringify({stage:'turn-attempt',purpose:'checkpoint',model:'haiku',effort:'low',message:'U4'}));
    }else{
     const modified=fs.readFileSync(path.join(work,'checkpoint.txt'),'utf8').includes('after');
     const preview=await q.rewindFiles(targetId,{dryRun:true});
     const rewind=await q.rewindFiles(targetId);
     console.log(JSON.stringify({stage:'rewind',modified,preview,rewind,restored:fs.readFileSync(path.join(work,'checkpoint.txt'),'utf8')==='before\n'}));
     // Resume the exact first prompt boundary; test by asking for a later marker that should not exist.
     ended=true;wake?.();q.close();
     const resumed=query({prompt:'Reply only with the checkpoint edit marker from later in this session, if you remember it; otherwise reply F0_ABSENT. Do not use tools.',options:{...options,resume:sessionId,resumeSessionAt:firstId,forkSession:true,persistSession:false}});
     console.log(JSON.stringify({stage:'turn-attempt',purpose:'resume-at-message',model:'haiku',effort:'low',message:'U5'}));
     for await(const r of resumed){if(r.type==='result')console.log(JSON.stringify({stage:'resume-at-message',subtype:r.subtype,isError:r.is_error,absent:r.result?.includes('F0_ABSENT'),laterMarker:r.result?.includes('F0_EDITED')}));}
     break;
    }
   }
  }
  clearTimeout(deadline);
 }
}catch(e){console.log(JSON.stringify({stage:'error',name:e.name,category:/auth|login/i.test(e.message)?'auth':'process',message:e.message.replaceAll(root,'<temp>').slice(0,250)}));process.exitCode=1;}finally{ended=true;wake?.();q.close();}
