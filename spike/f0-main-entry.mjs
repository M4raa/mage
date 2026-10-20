// Observa el entrypoint real, perfil aislado, y sale al primer intento de ventana.
import { app, BrowserWindow } from 'electron';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const profile=process.env.MAGE_F0_PROFILE;
if(!profile||!process.env.MAGE_F0_MAIN_ENTRY)throw new Error('Perfil y entrada aislados obligatorios');
fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
app.disableHardwareAcceleration();
app.on('browser-window-created',()=>{console.log(JSON.stringify({probe:'real-main',browserWindowCreated:true,windowCount:BrowserWindow.getAllWindows().length,userDataMatchesProfile:app.getPath('userData')===profile}));app.exit(0);});
app.whenReady().then(()=>console.log(JSON.stringify({probe:'real-main',ready:true})));
console.log(JSON.stringify({probe:'real-main',importing:true}));
await import(pathToFileURL(process.env.MAGE_F0_MAIN_ENTRY).href);
setTimeout(()=>app.exit(7),20000);
