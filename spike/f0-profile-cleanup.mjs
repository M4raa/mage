import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

export function credentialDigest(file) {
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  const hash = value => createHash('sha256').update(value).digest('hex');
  const tokens = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (/^(access_?token|refresh_?token)$/i.test(key)) tokens.push(String(entry));
      else visit(entry);
    }
  };
  try { visit(JSON.parse(bytes)); } catch { return { file: hash(bytes), tokens: null }; }
  return { file: hash(bytes), tokens: hash(JSON.stringify(tokens)) };
}

// Únicamente perfiles NUEVOS creados por el spike en curso. Nunca recibe rutas de ejecuciones pasadas.
export function cleanupProfile(root, credential, initialDigest) {
  let finalDigest;
  let credentialStateReadable = true;
  try { finalDigest = credentialDigest(credential); } catch { credentialStateReadable = false; }
  const copiedCredentialChanged = credentialStateReadable ? finalDigest?.file !== initialDigest?.file : null;
  const tokenChanged = credentialStateReadable ? finalDigest?.tokens !== initialDigest?.tokens : null;
  const realRoot = fs.realpathSync.native(root);
  const temp = fs.realpathSync.native(os.tmpdir());
  if (path.dirname(realRoot) !== temp || !path.basename(realRoot).startsWith('mage-f0-')) {
    throw new Error('Se rechaza limpiar un directorio que no pertenece al spike actual');
  }
  const routes = [credential, path.dirname(credential), root];
  try {
    fs.rmSync(realRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } finally {
    const missing = routes.filter(route => !fs.existsSync(route));
    console.log(JSON.stringify({ stage: 'cleanup', copiedCredentialChanged, tokenChanged, credentialStateReadable, renewedTokenPossible: tokenChanged !== false,
      nonexistentPaths: missing, remainingPaths: routes.filter(route => fs.existsSync(route)) }));
    if (missing.length !== routes.length) process.exitCode = 1;
  }
}
