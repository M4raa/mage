// F1.10: node spike/f1-handoff.mjs --real. Consultar uso antes (<70%).
// Dos turnos haiku/low: semilla sintética y handoff sin persistencia; nunca imprime IDs ni auth.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {cleanupProfile,credentialDigest} from './f0-profile-cleanup.mjs';
if(!process.argv.includes('--real'))throw new Error('--real obligatorio');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mage-f0-handoff-012-'));const profile=path.join(root,'profile');const credential=path.join(profile,'.credentials.json');let initial;
try {fs.mkdirSync(profile);const work=path.join(root,'work');fs.mkdirSync(work);fs.copyFileSync(path.join(os.homedir(),'.claude','.credentials.json'),credential);initial=credentialDigest(credential);fs.writeFileSync(path.join(profile,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true}));
const bin=execFileSync('where.exe',['claude'],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).find(p=>p.endsWith('.exe'));const env={...process.env,CLAUDE_CONFIG_DIR:profile};for(const k of Object.keys(env))if(/^(ANTHROPIC_|OPENAI_|CODEX_API_KEY|CLAUDECODE|CLAUDE_CODE_OAUTH_TOKEN)/.test(k))delete env[k];
const version=execFileSync(bin,['--version'],{encoding:'utf8',windowsHide:true}).trim();
const run=args=>JSON.parse(execFileSync(bin,[...args,'--model','haiku','--effort','low','--output-format','json','--tools','','--max-turns','1'],{env,cwd:work,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']}));
const seed=run(['-p','El proyecto de prueba consiste en una calculadora. Responde solo OK.']);
const transcripts=()=>fs.readdirSync(profile,{recursive:true}).filter(p=>p.endsWith('.jsonl')).map(p=>[p,fs.readFileSync(path.join(profile,p),'utf8')]);const before=transcripts();
const result=run(['--resume',seed.session_id,'--fork-session','--no-session-persistence','-p','Resume en una frase el objetivo anterior para otra conversación. No uses herramientas.']);
console.log(JSON.stringify({version,model:result.modelUsage?Object.keys(result.modelUsage):[],effort:'low',realTurns:2,seedCost:seed.total_cost_usd,handoffCost:result.total_cost_usd,usage:result.usage,turns:result.num_turns,resultNonEmpty:typeof result.result==='string'&&result.result.trim().length>0,originalTranscriptsUnchanged:JSON.stringify(before)===JSON.stringify(transcripts()),forkPersistenceDisabled:true}));
}catch(e){console.log(JSON.stringify({stage:'error',category:e.code??e.name,realTurnsAttemptedAtMost:2}));process.exitCode=1;}finally{cleanupProfile(root,credential,initial);}
