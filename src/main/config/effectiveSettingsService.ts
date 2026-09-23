import { join } from 'node:path';
import { z } from 'zod';
import type { EffectiveSettings, HookEntry, PermissionRule, SettingsOrigin } from '@shared/ipc';

// Hooks y reglas de permisos EFECTIVOS de una conversacion (2.9.b), leidos de las CUATRO fuentes que el
// CLI mezcla:
//   - `<configDir>/settings.json`            -> la cuenta
//   - `<cwd>/.claude/settings.json`          -> el proyecto (versionado)
//   - `<cwd>/.claude/settings.local.json`    -> el proyecto, local y NO versionado (2.3b)
//   - `settings-common.json` de Mage         -> la config compartida entre cuentas (D1)
//
// La local se añadio con el panel de Permisos del chat (2.3b): es donde el CLI escribe las reglas que el
// usuario acepta con su propio "always allow", asi que sin ella el panel enseñaba una lista vacia
// mientras el agente dejaba de preguntar — la peor combinacion posible.
//
// DATO MEDIDO (2026-08-02) del que depende toda la vista: los `hooks` y `permissions.allow` se
// CONCATENAN entre fuentes, no se pisan. Por eso la vista muestra la UNION etiquetada con su origen y
// nunca finge una precedencia que el CLI no aplica.
//
// Solo `mageCommon` es EDITABLE desde Mage: los otros dos ficheros son del usuario y del proyecto, y
// Mage no los reescribe (misma politica que ya declara la seccion de Config. compartida).

export interface EffectiveSettingsDeps {
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => string;
  // Ruta del `settings-common.json` de Mage (la resuelve SharedConfigService, que es su dueño).
  readonly commonSettingsPath: string;
  // Aviso de fuente ilegible: nunca se traga, pero tampoco ciega la vista (las otras dos se leen igual).
  readonly log: (level: 'warn', message: string) => void;
}

// Esquema TOLERANTE: son ficheros ajenos (los edita el usuario a mano) y pueden traer cualquier cosa.
// Lo que no encaje se ignora en vez de invalidar el fichero entero.
const HOOK_COMMAND_SCHEMA = z.object({ type: z.string().optional(), command: z.string() }).passthrough();
const HOOK_MATCHER_SCHEMA = z
  .object({ matcher: z.string().optional(), hooks: z.array(HOOK_COMMAND_SCHEMA).optional() })
  .passthrough();
const SETTINGS_SCHEMA = z
  .object({
    hooks: z.record(z.string(), z.array(HOOK_MATCHER_SCHEMA)).optional(),
    permissions: z
      .object({
        allow: z.array(z.string()).optional(),
        deny: z.array(z.string()).optional(),
        ask: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export class EffectiveSettingsService {
  constructor(private readonly deps: EffectiveSettingsDeps) {}

  read(params: { readonly cwd: string; readonly accountDir: string }): EffectiveSettings {
    const sources: readonly { readonly origin: SettingsOrigin; readonly path: string }[] = [
      { origin: 'account', path: join(params.accountDir, 'settings.json') },
      { origin: 'project', path: join(params.cwd, '.claude', 'settings.json') },
      { origin: 'projectLocal', path: join(params.cwd, '.claude', 'settings.local.json') },
      { origin: 'mageCommon', path: this.deps.commonSettingsPath },
    ];
    const hooks: HookEntry[] = [];
    const rules: PermissionRule[] = [];
    for (const source of sources) {
      const parsed = this.readSource(source.path);
      if (parsed === null) continue;
      hooks.push(...toHookEntries(parsed, source.origin));
      rules.push(...toPermissionRules(parsed, source.origin));
    }
    return { hooks, rules, editableOrigin: 'mageCommon' };
  }

  // Una fuente ausente devuelve null (no es un error: casi ningun proyecto tiene `.claude/settings.json`)
  // y una ILEGIBLE tambien, pero avisando: una fuente rota no puede dejar la vista en blanco.
  private readSource(path: string): z.infer<typeof SETTINGS_SCHEMA> | null {
    if (!this.deps.exists(path)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.deps.readFile(path));
    } catch (err) {
      this.deps.log('warn', `No se pudo leer "${path}": ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    const result = SETTINGS_SCHEMA.safeParse(parsed);
    if (!result.success) {
      this.deps.log('warn', `"${path}" no tiene la forma esperada de settings.json; se ignora`);
      return null;
    }
    return result.data;
  }
}

// `hooks` del CLI: { <evento>: [ { matcher?, hooks: [ {command} ] } ] }.
function toHookEntries(settings: z.infer<typeof SETTINGS_SCHEMA>, origin: SettingsOrigin): readonly HookEntry[] {
  const entries: HookEntry[] = [];
  for (const [event, matchers] of Object.entries(settings.hooks ?? {})) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks ?? []) {
        entries.push({ event, matcher: matcher.matcher ?? null, command: hook.command, origin });
      }
    }
  }
  return entries;
}

// Las reglas NO se deduplican entre fuentes a proposito: la realidad del CLI es que se concatenan, y
// enseñar una sola cuando hay dos escondería que la misma regla esta declarada en dos sitios.
function toPermissionRules(settings: z.infer<typeof SETTINGS_SCHEMA>, origin: SettingsOrigin): readonly PermissionRule[] {
  const permissions = settings.permissions;
  if (permissions === undefined) return [];
  return [
    // `deny` primero: es el que MANDA en el CLI, y leer la lista de arriba abajo tiene que contar la
    // historia en el orden en que se aplica.
    ...(permissions.deny ?? []).map((pattern): PermissionRule => ({ pattern, effect: 'deny', origin })),
    ...(permissions.ask ?? []).map((pattern): PermissionRule => ({ pattern, effect: 'ask', origin })),
    ...(permissions.allow ?? []).map((pattern): PermissionRule => ({ pattern, effect: 'allow', origin })),
  ];
}
