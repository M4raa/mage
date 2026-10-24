// Benchmark F0-B (#16): las tareas del manifiesto, compartidas por la ruta headless directa (R2,
// spike/bench-headless.mjs) y por Mage (R3, `verify:gui --bench`). Cada tarea prepara su espacio de
// trabajo desechable y comprueba el éxito de forma DETERMINISTA (texto, herramientas o tests), nunca
// con el juicio de un modelo. Commit de entrada fijo para todas: ENTRY_COMMIT.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ENTRY_COMMIT = '8b5855d3f8911870d998962b511eef44dc093475';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MCP_SERVER = path.join(REPO, 'spike', 'bench', 'mcp-server.mjs');
export const MCP_MARK = 'MARCA-7Q';
const VITEST_TIMEOUT_MS = 240_000;

// Clon desechable de la revision de entrada, con `node_modules` enlazado (junction) para poder correr
// vitest sin instalar. `root` lo crea y lo borra quien llama.
// La raiz se resuelve a su ruta LARGA: el temporal de Windows llega como 8.3 (DMARAT~1) y vite, que
// resuelve la larga, no encontraba los tests («Cannot find module»).
export function createWorkspace(root) {
  const dir = path.join(fs.realpathSync.native(root), 'repo');
  run('git', ['clone', '--quiet', '--shared', '--no-checkout', REPO, dir]);
  run('git', ['-C', dir, 'checkout', '--quiet', ENTRY_COMMIT]);
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  return dir;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} -> ${result.status}: ${(result.stderr ?? '').slice(0, 300)}`);
  return result.stdout;
}

// Tests de un fichero en el espacio de trabajo: {passed, failed} (los dos 0 si no corrio).
export function runVitest(dir, file) {
  const result = spawnSync(process.execPath, [path.join(dir, 'node_modules', 'vitest', 'vitest.mjs'), 'run', file, '--reporter=json'],
    { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: VITEST_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
  const json = (result.stdout ?? '').slice((result.stdout ?? '').indexOf('{'));
  try {
    const report = JSON.parse(json);
    return { passed: report.numPassedTests ?? 0, failed: report.numFailedTests ?? 0 };
  } catch (error) {
    throw new Error(`vitest de ${file} sin informe JSON (status ${result.status}): ${String(error.message).slice(0, 120)}`);
  }
}

const countIts = (dir, file) => (fs.readFileSync(path.join(dir, file), 'utf8').match(/\bit\(/g) ?? []).length;

// Resumen normalizado de una ejecucion, igual en R2 y R3: `text` (todo lo que dijo el agente),
// `tools` (nombres de herramientas llamadas), `init` (JSON del arranque, si lo hubo).
export const TASKS = [
  {
    id: 'T1',
    title: 'Navegación',
    turns: 1,
    prompts: ['¿En qué fichero se define la función neighborOf y en qué fichero del store se usa? Responde solo con las dos rutas relativas al repositorio, sin ejecutar nada que modifique ficheros.'],
    prepare: () => ({}),
    check: (_dir, run) => {
      const ok = run.text.includes('splitLayout.ts') && run.text.includes('workbenchStore.ts');
      return { ok, detail: ok ? 'nombra los dos ficheros' : 'no nombra los dos ficheros' };
    },
  },
  {
    id: 'T2',
    title: 'Corregir un fallo reintroducido (#38)',
    turns: 1,
    prompts: ['En src/renderer/src/workbench/splitLayout.ts, la función closeTab activa la PRIMERA pestaña al cerrar la activa, y los tests de src/renderer/src/workbench/splitLayout.test.ts esperan la siguiente (o la anterior si era la última). Corrige closeTab usando la función neighborOf que ya existe en ese fichero. No toques los tests.'],
    // Fixture: el fallo #38 reintroducido en la hoja (`kept[0]`), con los tests que lo detectan.
    prepare: (dir) => {
      const file = path.join(dir, 'src', 'renderer', 'src', 'workbench', 'splitLayout.ts');
      const source = fs.readFileSync(file, 'utf8');
      const broken = source.replace('layout.activeTabId === tabId ? neighborOf(layout.tabIds, tabId)! : layout.activeTabId', 'layout.activeTabId === tabId ? kept[0]! : layout.activeTabId');
      if (broken === source) throw new Error('T2: no se pudo reintroducir el fallo en splitLayout.ts');
      fs.writeFileSync(file, broken);
      const before = runVitest(dir, 'src/renderer/src/workbench/splitLayout.test.ts');
      if (before.failed === 0) throw new Error('T2: el fixture no hace fallar ningún test');
      return { failedBefore: before.failed };
    },
    check: (dir) => {
      const after = runVitest(dir, 'src/renderer/src/workbench/splitLayout.test.ts');
      const testsUntouched = spawnSync('git', ['-C', dir, 'diff', '--quiet', '--', 'src/renderer/src/workbench/splitLayout.test.ts']).status === 0;
      const ok = after.failed === 0 && after.passed > 0 && testsUntouched;
      return { ok, detail: `tests ${after.passed} ok / ${after.failed} fallan; tests intactos=${testsUntouched}` };
    },
  },
  {
    id: 'T3',
    title: 'Test nuevo',
    turns: 1,
    // Un caso que NO existe en el fichero (el de 140 ya lo cubre F1.5: Codex lo detectó en el piloto).
    prompts: ['Añade a src/renderer/src/workbench/tabActions.test.ts un test nuevo para tabDropSide: con un ancho NaN (left 100, width NaN, clientX 120) tiene que lanzar un error. Sigue el estilo de los tests de ese fichero y no cambies tabActions.ts.'],
    prepare: (dir) => ({ itsBefore: countIts(dir, 'src/renderer/src/workbench/tabActions.test.ts') }),
    check: (dir, _run, prepared) => {
      const its = countIts(dir, 'src/renderer/src/workbench/tabActions.test.ts');
      const result = runVitest(dir, 'src/renderer/src/workbench/tabActions.test.ts');
      const sourceUntouched = spawnSync('git', ['-C', dir, 'diff', '--quiet', '--', 'src/renderer/src/workbench/tabActions.ts']).status === 0;
      const hasNaN = fs.readFileSync(path.join(dir, 'src/renderer/src/workbench/tabActions.test.ts'), 'utf8').includes('NaN');
      const ok = its > prepared.itsBefore && result.passed > 0 && result.failed === 0 && hasNaN && sourceUntouched;
      return { ok, detail: `its ${prepared.itsBefore}->${its}; tests ${result.passed} ok / ${result.failed} fallan; fuente intacta=${sourceUntouched}` };
    },
  },
  {
    id: 'T4',
    title: 'Skill y MCP',
    turns: 1,
    prompts: [`Llama a la herramienta bench_marca del servidor MCP «bench» y responde solo con el texto que devuelva.`],
    prepare: (dir) => {
      writeProjectCapabilities(dir);
      return {};
    },
    check: (_dir, run) => {
      const called = run.tools.some((name) => name.includes('bench_marca'));
      const answered = run.text.includes(MCP_MARK);
      const skillListed = run.init.includes('bench-saludo');
      return { ok: called && answered, detail: `MCP llamada=${called} respuesta=${answered} skill en init=${skillListed}`, extra: { skillListed } };
    },
  },
  {
    id: 'T5',
    title: 'Mensaje durante el turno',
    turns: 2,
    // El segundo se envia mientras el primero sigue ejecutando su comando (a los MID_TURN_DELAY_MS).
    prompts: [
      'Ejecuta exactamente el comando «node -e "setTimeout(()=>{},6000)"» con la herramienta de shell y, cuando termine, responde solo ALFA.',
      'Responde solo BETA.',
    ],
    midTurnDelayMs: 2500,
    doneText: 'BETA',
    prepare: () => ({}),
    check: (_dir, run) => {
      const alfa = run.text.indexOf('ALFA');
      const beta = run.text.indexOf('BETA');
      const ok = alfa !== -1 && beta !== -1 && alfa < beta;
      return { ok, detail: `ALFA@${alfa} BETA@${beta}` };
    },
  },
];

// T4: servidor MCP y skill del PROYECTO, los mismos para las dos rutas (el CLI los lee del cwd).
function writeProjectCapabilities(dir) {
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { bench: { command: process.execPath, args: [MCP_SERVER] } } }, null, 2));
  fs.mkdirSync(path.join(dir, '.claude', 'skills', 'bench-saludo'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'skills', 'bench-saludo', 'SKILL.md'), '---\nname: bench-saludo\ndescription: Skill de prueba del benchmark de Mage. Úsala si te piden un saludo de prueba.\n---\n\nResponde «hola de bench».\n');
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ enableAllProjectMcpServers: true, permissions: { allow: ['mcp__bench__bench_marca'] } }, null, 2));
}

// Codex lee los servidores MCP de su `config.toml` (CODEX_HOME), no del proyecto.
export function codexMcpConfig() {
  const quote = (value) => JSON.stringify(value);
  return `[mcp_servers.bench]\ncommand = ${quote(process.execPath)}\nargs = [${quote(MCP_SERVER)}]\n`;
}
