import { z } from 'zod';
import type { PermissionScope } from '@shared/events';
import { touchesPrTurnCommand } from '@shared/permissionPolicy';

// «Permitir en esta sesión» y «Permitir siempre» en Claude. MEDIDO con el CLI 2.1.319 (spike/permission-suggestions-spike.mjs):
// el can_use_tool trae `permission_suggestions`; sus `addRules` con behavior `allow` son las reglas del CLI para esa
// llamada (un Bash: el comando entero seguido de ` *`). Mage las devuelve en `updatedPermissions` con el destino del
// alcance y el CLI las aplica (y, con `userSettings`, las escribe en el settings.json de su CLAUDE_CONFIG_DIR). Los
// `addDirectories` y `setMode` de las sugerencias NO se reenvían: ampliarían otra cosa que la que el usuario ve.

export interface ClaudeRule {
  readonly toolName: string;
  readonly ruleContent?: string;
}

const RULE = z.object({ toolName: z.string().min(1), ruleContent: z.string().optional() }).passthrough();
const ADD_ALLOW_RULES = z.object({ type: z.literal('addRules'), behavior: z.literal('allow'), rules: z.array(RULE) }).passthrough();
const DESTINATION: Readonly<Record<PermissionScope, string>> = { session: 'session', always: 'userSettings' };

// Reglas de las sugerencias (las mal formadas se ignoran); sin ninguna, la herramienta entera.
export function allowRulesOf(suggestions: unknown, toolName: string): readonly ClaudeRule[] {
  const entries = Array.isArray(suggestions) ? suggestions : [];
  const rules = entries.flatMap((entry) => {
    const parsed = ADD_ALLOW_RULES.safeParse(entry);
    return parsed.success ? parsed.data.rules.map((rule) => (rule.ruleContent === undefined ? { toolName: rule.toolName } : { toolName: rule.toolName, ruleContent: rule.ruleContent })) : [];
  });
  return rules.length > 0 ? rules : [{ toolName }];
}

// Como la escribe el CLI en `permissions.allow`: `Bash(npm test *)`, o solo `Write`.
export function formatRule(rule: ClaudeRule): string {
  return rule.ruleContent === undefined ? rule.toolName : `${rule.toolName}(${rule.ruleContent})`;
}

export interface ScopeContext {
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly requiresUserInteraction: boolean;
  readonly suppressAlwaysAllow: boolean;
}

// Una pregunta, una petición en la que el CLI pide no ofrecer reglas, o un comando de la barrera del turno de PR: solo
// «esta vez». El resto: sesión y siempre.
export function allowScopesFor(ctx: ScopeContext): readonly PermissionScope[] {
  if (ctx.requiresUserInteraction || ctx.suppressAlwaysAllow) return [];
  if (ctx.toolName === 'Bash' && touchesPrTurnCommand(String(ctx.input.command ?? ''))) return [];
  return ['session', 'always'];
}

export function updatedPermissionsFor(rules: readonly ClaudeRule[], scope: PermissionScope): readonly unknown[] {
  if (rules.length === 0) throw new Error(`Sin reglas que aplicar con el alcance ${scope}`);
  return [{ type: 'addRules', rules, behavior: 'allow', destination: DESTINATION[scope] }];
}
