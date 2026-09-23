// Limpia los artefactos generados (cross-platform, sin dependencias).
//
// `release/` y `.verify-out/` NO estaban aqui, y entre los dos habia 534 MB sin gestionar en el disco
// de desarrollo: 356 MB de empaquetados y 178 MB en 69 ejecuciones acumuladas del harness desde agosto.
// De `.verify-out/` se PODA en vez de borrar: sus informes y capturas son la evidencia de la ultima
// verificacion, y perder la de hoy por limpiar seria peor que el disco ocupado.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Cuantas ejecuciones del harness se conservan. Suficiente para comparar con la anterior cuando algo
// cambia de un dia para otro, que es para lo que se miran.
const KEEP_VERIFY_RUNS = 5;

const FULL_TARGETS = ['out', 'dist', 'release', 'coverage'];
for (const dir of FULL_TARGETS) {
  rmSync(dir, { recursive: true, force: true });
  console.log(`[clean] eliminado: ${dir}/`);
}

pruneVerifyOut();

// Deja solo las N ejecuciones mas recientes de `.verify-out/` (una carpeta por ejecucion, con nombre
// ISO). Se ordena por nombre y no por mtime: el nombre ES la marca de tiempo, y no depende de que
// copiar los ficheros haya conservado las fechas.
function pruneVerifyOut() {
  let runs;
  try {
    runs = readdirSync('.verify-out').filter((name) => statSync(join('.verify-out', name)).isDirectory());
  } catch {
    return; // nunca se ha corrido el harness: nada que podar
  }
  const stale = runs.sort().slice(0, Math.max(0, runs.length - KEEP_VERIFY_RUNS));
  for (const name of stale) rmSync(join('.verify-out', name), { recursive: true, force: true });
  console.log(`[clean] .verify-out/: ${stale.length} ejecuciones podadas, ${runs.length - stale.length} conservadas`);
}
