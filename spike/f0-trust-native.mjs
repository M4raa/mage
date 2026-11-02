import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mage-native-path-002-'));
const target=path.join(root,'Long folder for short path');fs.mkdirSync(target);
const r=spawnSync('cmd.exe',['/d','/c',`for %I in ("${target}") do @echo %~sI`],{encoding:'utf8',windowsVerbatimArguments:true});
const short=r.stdout.trim();const plain=fs.realpathSync(short);const native=fs.realpathSync.native(short);
console.log(JSON.stringify({shortHasTilde:short.includes('~'),plainHasTilde:plain.includes('~'),nativeHasTilde:native.includes('~'),nativeMatchesLong:fs.realpathSync.native(target)===native,sameIdentity:fs.statSync(short).ino===fs.statSync(target).ino,nonexistentFallbackRequired:true}));
