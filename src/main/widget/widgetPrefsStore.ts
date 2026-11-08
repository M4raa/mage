import { z } from 'zod';
import type { WidgetPrefs } from '@shared/widget';
import { readSnapshot, writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';

// Preferencias propias del widget: `userData/widget-prefs.json`. Un fichero ilegible o con otra forma se
// avisa en el log y se parte de los valores por defecto (no se sobrescribe hasta la primera escritura).
export const DEFAULT_WIDGET_PREFS: WidgetPrefs = { expanded: false, doNotDisturb: false };

const WIDGET_PREFS_SCHEMA = z.object({ expanded: z.boolean(), doNotDisturb: z.boolean() }).strict();
export const WIDGET_PREFS_PATCH_SCHEMA = WIDGET_PREFS_SCHEMA.partial().strict();

export interface WidgetPrefsStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
  readonly log: (level: 'warn', message: string, data?: unknown) => void;
}

export class WidgetPrefsStore {
  // Se lee una vez y se cachea: main es el único escritor.
  private prefs: WidgetPrefs | null = null;

  constructor(private readonly deps: WidgetPrefsStoreDeps) {}

  // Las preferencias actuales (las del fichero la primera vez; los valores por defecto si no hay o no valen).
  load(): WidgetPrefs {
    if (this.prefs === null) this.prefs = this.readFromDisk();
    return this.prefs;
  }

  // Fusiona el parche y persiste; si no cambia nada, no escribe.
  update(patch: Partial<WidgetPrefs>): WidgetPrefs {
    const current = this.load();
    const next: WidgetPrefs = { ...current, ...definedOnly(patch) };
    if (next.expanded === current.expanded && next.doNotDisturb === current.doNotDisturb) return current;
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify(next, null, 2));
    this.prefs = next;
    return next;
  }

  private readFromDisk(): WidgetPrefs {
    const raw = readSnapshot(this.deps, this.deps.filePath);
    if (raw === null) return DEFAULT_WIDGET_PREFS;
    const parsed = this.parseJson(raw);
    if (parsed === undefined) return DEFAULT_WIDGET_PREFS;
    const result = WIDGET_PREFS_SCHEMA.safeParse(parsed);
    if (!result.success) return this.fallback(result.error.message);
    return result.data;
  }

  // El `try` envuelve SOLO el JSON.parse; si no parsea, se registra y se devuelve `undefined`.
  private parseJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch (error) {
      this.fallback(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  private fallback(detail: string): WidgetPrefs {
    this.deps.log('warn', `widget-prefs.json inválido, se usan los valores por defecto: ${detail}`);
    return DEFAULT_WIDGET_PREFS;
  }
}

// Quita las claves `undefined` de un parche para que no pisen el valor actual al fusionar.
function definedOnly(patch: Partial<WidgetPrefs>): Partial<WidgetPrefs> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}
