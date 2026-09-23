// Boton de bug de la cabecera: construye la URL del formulario de fallo de GitHub con lo que Mage ya
// sabe de si mismo. Modulo PURO a proposito (la logica fuera del componente), asi que se prueba sin
// DOM, sin IPC y sin red.
//
// Como funciona el prerelleno: `.github/ISSUE_TEMPLATE/fallo.yml` es un *issue form*, y GitHub admite
// valores iniciales por query string donde cada parametro casa con el `id` de un campo. En un
// `dropdown` el valor es la ETIQUETA literal de la opcion, no su indice. Lo que no se manda sale
// vacio, que es justo lo que se quiere en «qué pasa» y «cómo reproducirlo»: los escribe la persona.

// Repositorio publico de Mage. Al renombrarlo hay que tocar tambien `electron-builder.yml`
// (`publish.repo`), `scripts/install.sh` (`REPO=`) y `.github/ISSUE_TEMPLATE/config.yml`: son YAML y
// shell, no pueden importar de aqui.
export const GITHUB_REPO = 'M4raa/mage';

const BUG_TEMPLATE = 'fallo.yml';
const IDEA_TEMPLATE = 'idea.yml';

// La etiqueta va EXPLICITA en la URL ademas de en el `labels:` de `fallo.yml`, por si la plantilla no
// resuelve (repo recien creado, plantilla renombrada): asi la issue sigue naciendo etiquetada.
//
// TIENE QUE EXISTIR YA EN EL REPOSITORIO. GitHub DESCARTA EN SILENCIO cualquier valor de `labels=`
// que no sea una etiqueta del repo — no avisa, simplemente abre la issue sin etiqueta. Por eso se usa
// `bug`, que viene de serie en todo repo nuevo, y no `fallo`, que habria que crear a mano. Medido el
// 2026-09-21 contra `M4raa/mage`: con `labels=fallo` el formulario salia con "No labels".
const BUG_LABEL = 'bug';
// Misma regla para las ideas: `enhancement` viene de serie, `idea` no. Tiene que seguir casando con
// el `labels:` de `.github/ISSUE_TEMPLATE/idea.yml`.
const IDEA_LABEL = 'enhancement';

function issueUrl(params: URLSearchParams): string {
  return `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
}

// Las TRES opciones del desplegable `so` de la plantilla, literales. Cualquier otro texto deja el
// desplegable sin elegir, o sea lo mismo que no mandar nada.
export type IssueOs = 'Windows' | 'macOS' | 'Linux';

// `navigator.platform` esta deprecado pero sigue siendo lo que responde Chromium en Electron, y es la
// misma fuente que ya usa TitleBar para colocar los semaforos de macOS. Devuelve null ante lo que no
// reconoce en vez de adivinar: un SO equivocado en el informe manda a quien lo lea por mal camino.
export function issueOsFromPlatform(platform: string): IssueOs | null {
  const normalized = platform.toLowerCase();
  if (normalized.includes('win')) return 'Windows';
  if (normalized.includes('mac')) return 'macOS';
  if (normalized.includes('linux') || normalized.includes('x11')) return 'Linux';
  return null;
}

export interface BugReportContext {
  // null cuando «Acerca de» no ha podido resolverse: el informe sale igual, solo sin la version.
  readonly appVersion: string | null;
  readonly platform: string;
}

export function buildBugReportUrl({ appVersion, platform }: BugReportContext): string {
  const params = new URLSearchParams({ template: BUG_TEMPLATE, labels: BUG_LABEL });
  // Cada dato SOLO si se conoce. Un "null" o un "" escritos en el formulario son peores que el hueco
  // vacio: parecen un dato real y nadie los corrige antes de enviar.
  const version = appVersion?.trim() ?? '';
  if (version.length > 0) params.set('version', version);
  const os = issueOsFromPlatform(platform);
  if (os !== null) params.set('so', os);
  return issueUrl(params);
}

// La idea NO lleva contexto, y no es un olvido: `idea.yml` no tiene campos `version` ni `so` -- lo que
// se pregunta ahi es el problema, no la maquina-. Mandar parametros que no casan con ningun `id` no
// falla, simplemente no hace nada, asi que este boton se ahorra ademas la llamada a `getAbout()`.
export function buildIdeaUrl(): string {
  return issueUrl(new URLSearchParams({ template: IDEA_TEMPLATE, labels: IDEA_LABEL }));
}
