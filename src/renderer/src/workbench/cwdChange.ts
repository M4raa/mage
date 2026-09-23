// ¿Se puede cambiar la carpeta (cwd) de una conversacion? (F2)
//
// PURO y compartido entre la UI y el store a proposito: la UI lo usa para deshabilitar el boton con un
// motivo visible, y el store para no fiarse de que la UI lo haya hecho. Una sola regla en un sitio.
//
// Por que hay regla y no se puede cambiar siempre: el cwd NO es decoracion. El CLI guarda la
// transcripcion bajo `projects/<cwd-codificado>`, asi que cambiarlo con la sesion ya viva dejaria la
// conversacion partida entre dos carpetas — y `--resume` la buscaria donde ya no esta (el mismo fallo
// que costo el handoff roto: "--resume sin cwd -> No conversation found").

export interface CwdChangeContext {
  // Hay un proceso del CLI vivo para esta pestaña.
  readonly hasLiveSession: boolean;
  // La pestaña reanuda una conversacion anterior: su transcripcion ya existe bajo el cwd viejo.
  readonly hasResumeTarget: boolean;
}

export type CwdChangeVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

export function canChangeCwd(context: CwdChangeContext): CwdChangeVerdict {
  if (context.hasLiveSession) {
    return { allowed: false, reason: 'La sesión ya está en marcha: su transcripción vive en esta carpeta.' };
  }
  if (context.hasResumeTarget) {
    return { allowed: false, reason: 'Es una conversación anterior: se reanuda en la carpeta donde se creó.' };
  }
  return { allowed: true };
}

// Ruta acortada para pintarla en un hueco estrecho conservando lo que identifica al proyecto: el
// principio (la unidad/raiz) y sobre todo el FINAL, que es el nombre de la carpeta. Devuelve la ruta
// intacta si ya cabe.
export function shortenPath(path: string, maxLength = 48): string {
  if (path.length <= maxLength) return path;
  // Separador real de la ruta, sin depender del SO del renderer.
  const separator = path.includes('\\') ? '\\' : '/';
  const segments = path.split(separator).filter((segment) => segment.length > 0);
  if (segments.length <= 2) return `…${path.slice(-(maxLength - 1))}`;

  const first = segments[0] ?? '';
  const last = segments[segments.length - 1] ?? '';
  const candidate = `${first}${separator}…${separator}${last}`;
  // Si ni con elipsis cabe, manda el final: el nombre de la carpeta es lo que identifica el proyecto.
  return candidate.length <= maxLength ? candidate : `…${separator}${last}`;
}
