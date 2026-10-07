// Fixtures del historial de Codex y de agy para verify:gui: un CODEX_HOME y un perfil de agy en la carpeta de
// datos aislada del harness, con una conversación sintética cada uno (la misma forma medida que leen los
// lectores de main). Sin nada real del usuario y sin lanzar ningún CLI.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const CODEX_FIXTURE_ID = '11111111-2222-3333-4444-555555555555';
export const CODEX_FIXTURE_TITLE = 'Lista los ficheros';
export const AGY_FIXTURE_ID = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
export const AGY_FIXTURE_TITLE = 'Cuenta los ficheros del proyecto';

const varint = (value) => {
  const out = [];
  let rest = value;
  while (rest >= 0x80) { out.push((rest % 0x80) | 0x80); rest = Math.floor(rest / 0x80); }
  return [...out, rest];
};
const text = (field, value) => { const data = [...Buffer.from(value, 'utf8')]; return [...varint(field * 8 + 2), ...varint(data.length), ...data]; };
const message = (field, ...inner) => { const data = inner.flat(); return [...varint(field * 8 + 2), ...varint(data.length), ...data]; };
const number = (field, value) => [...varint(field * 8), ...varint(value)];
const step = (stepType, ...fields) => Buffer.from([...number(1, stepType), ...fields.flat()]);
const meta = (...extra) => message(5, message(1, number(1, 1790853405)), ...extra);

// Pasos con la forma medida en agy 1.2.14 / 1.3.1: 14 usuario, 15 modelo, y uno de herramienta (metadatos 5.4).
function agySteps(cwd) {
  const uri = `file:///${cwd.replaceAll('\\', '/')}`;
  return [
    step(14, meta(), message(19, text(2, AGY_FIXTURE_TITLE), message(12, message(1), text(12, uri)))),
    step(9, meta(message(4, text(1, 'call1'), text(2, 'list_dir'), text(3, '{"DirectoryPath":"x","toolAction":"a","toolSummary":"b"}'))), message(14, text(3, 'a.txt\nb.txt'))),
    step(15, meta(), message(20, text(1, 'Hay dos ficheros.'))),
  ];
}

export function seedProviderHistory({ userDataDir, repoRoot }) {
  const root = join(userDataDir, 'provider-history-fixtures');
  const codexHome = join(root, '.codex-vgfixture');
  const agyHome = join(root, 'agy-vgfixture');
  const rollout = join(codexHome, 'sessions', '2026', '10', '05', `rollout-2026-10-05T10-00-00-${CODEX_FIXTURE_ID}.jsonl`);
  mkdirSync(dirname(rollout), { recursive: true });
  copyFileSync(join(repoRoot, 'src', 'shared', 'fixtures', 'codex-rollout.jsonl'), rollout);
  const dbPath = join(agyHome, '.gemini', 'antigravity-cli', 'conversations', `${AGY_FIXTURE_ID}.db`);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE steps (idx integer, step_type integer NOT NULL DEFAULT 0, step_payload blob, PRIMARY KEY (idx))');
  const insert = db.prepare('INSERT INTO steps (idx, step_type, step_payload) VALUES (?, ?, ?)');
  agySteps('C:\\proyecto').forEach((payload, index) => insert.run(index, [14, 9, 15][index], payload));
  db.close();
  // Registro de cuentas: Codex de suscripción SIN auth.json (no se sondea con el CLI) y agy por clave.
  const registry = { version: 1, accounts: [
    { providerId: 'codex', authKind: 'subscription', name: 'vgfixture', home: codexHome },
    { providerId: 'agy', authKind: 'api-key', name: 'vgfixture', home: agyHome },
  ] };
  const registryPath = join(userDataDir, 'provider-accounts.json');
  writeFileSync(registryPath, JSON.stringify(registry));
  return { codexHome, agyHome, cleanup: () => { rmSync(registryPath, { force: true }); rmSync(root, { recursive: true, force: true }); } };
}
