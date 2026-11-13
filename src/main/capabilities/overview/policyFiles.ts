// Formas MEDIDAS con Claude Code 2.1.319 (2026-11-13), en seis cuentas:
// policy-limits.json = { restrictions: { <nombre>: { allowed: boolean } }, compliance_taints: [], monitoring_notice: null, defaults: { remote_control_at_startup: boolean } }, con nombres que cambian por cuenta;
// remote-settings.json = { channelsEnabled: boolean } o {};
// managed-settings.json no existe en la máquina medida (su ruta sale del binario: capabilitiesOverview.ts).
// Tolerante a propósito: lo que no encaja se enseña como dato crudo y seguro, nunca se tira en silencio.
import { z } from 'zod';
import type {
  AccountPoliciesView,
  ManagedFileView,
  PolicyEntryView,
  PolicyRestrictionView,
} from '@shared/capabilities';

export const SENSITIVE_KEY = /(token|secret|password|passwd|key|auth|credential|cookie|header|uuid)/i;
export const HIDDEN_VALUE = '•••';

const TEXT_MAX_CHARS = 80;
const KNOWN_POLICY_KEYS: ReadonlySet<string> = new Set(['restrictions', 'compliance_taints', 'monitoring_notice', 'defaults']);
const RECORD = z.record(z.string(), z.unknown());
const RESTRICTION = z.object({ allowed: z.boolean() }).passthrough();
const POLICY_LIMITS = z
  .object({
    restrictions: RECORD.catch({}),
    compliance_taints: z.array(z.unknown()).catch([]),
    monitoring_notice: z.unknown().optional(),
    defaults: RECORD.catch({}),
  })
  .passthrough();

type ParsedObject =
  | { readonly state: 'absent' | 'unreadable' }
  | { readonly state: 'ok'; readonly value: Readonly<Record<string, unknown>> };

const byName = (a: { readonly name: string }, b: { readonly name: string }): number => a.name.localeCompare(b.name, 'en');

// Texto → objeto. null = el fichero no existe. Un JSON roto o que no es un objeto se dice ('unreadable'); cualquier otro error se propaga.
export function parseJsonObject(text: string | null): ParsedObject {
  if (text === null) return { state: 'absent' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    if (err instanceof SyntaxError) return { state: 'unreadable' };
    throw err;
  }
  const record = RECORD.safeParse(json);
  if (!record.success || Array.isArray(json)) return { state: 'unreadable' };
  return { state: 'ok', value: record.data };
}

// Un valor ajeno como texto que no puede filtrar un secreto: claves sensibles ocultas, objetos solo con sus claves.
export function safeValueText(key: string, value: unknown): string {
  if (SENSITIVE_KEY.test(key)) return HIDDEN_VALUE;
  if (typeof value === 'string') return value.length > TEXT_MAX_CHARS ? `${value.slice(0, TEXT_MAX_CHARS)}…` : value;
  if (typeof value === 'boolean' || typeof value === 'number' || value === null) return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') return `{${Object.keys(value).join(', ')}}`;
  return typeof value;
}

// Cada par del registro como entrada segura, ordenada por nombre.
export function toEntries(record: Readonly<Record<string, unknown>>): readonly PolicyEntryView[] {
  return Object.entries(record)
    .map(([name, value]) => ({ name, value: safeValueText(name, value) }))
    .sort(byName);
}

interface SplitRestrictions {
  readonly valid: readonly PolicyRestrictionView[];
  readonly invalid: readonly PolicyEntryView[];
}

function splitRestrictions(restrictions: Readonly<Record<string, unknown>>): SplitRestrictions {
  const valid: PolicyRestrictionView[] = [];
  const invalid: PolicyEntryView[] = [];
  for (const [name, raw] of Object.entries(restrictions)) {
    const parsed = RESTRICTION.safeParse(raw);
    if (parsed.success) valid.push({ name, allowed: parsed.data.allowed });
    else invalid.push({ name: `restrictions.${name}`, value: safeValueText(name, raw) });
  }
  return { valid: valid.sort(byName), invalid };
}

function noticeEntries(notice: unknown): readonly PolicyEntryView[] | null {
  if (notice === null || notice === undefined) return null;
  if (typeof notice === 'object' && !Array.isArray(notice)) return toEntries(notice as Record<string, unknown>);
  return [{ name: 'monitoring_notice', value: safeValueText('monitoring_notice', notice) }];
}

// policy-limits.json → la parte de políticas de la vista (sin remote-settings).
export function parsePolicyLimits(text: string | null): Omit<AccountPoliciesView, 'remoteState' | 'remote'> {
  const parsed = parseJsonObject(text);
  if (parsed.state !== 'ok') {
    return { state: parsed.state, restrictions: [], defaults: [], complianceTaints: [], monitoringNotice: null, extra: [] };
  }
  const limits = POLICY_LIMITS.parse(parsed.value);
  const split = splitRestrictions(limits.restrictions);
  const unknownTopLevel = Object.fromEntries(Object.entries(parsed.value).filter(([key]) => !KNOWN_POLICY_KEYS.has(key)));
  return {
    state: 'ok',
    restrictions: split.valid,
    defaults: toEntries(limits.defaults),
    complianceTaints: limits.compliance_taints.map((taint, index) => safeValueText(`taint${index}`, taint)),
    monitoringNotice: noticeEntries(limits.monitoring_notice),
    extra: [...toEntries(unknownTopLevel), ...split.invalid],
  };
}

// remote-settings.json → sus entradas seguras.
export function parseRemoteSettings(text: string | null): Pick<AccountPoliciesView, 'remoteState' | 'remote'> {
  const parsed = parseJsonObject(text);
  if (parsed.state !== 'ok') return { remoteState: parsed.state, remote: [] };
  return { remoteState: 'ok', remote: toEntries(parsed.value) };
}

// Un fichero de ajustes gestionados → sus entradas seguras (un objeto solo con sus claves).
export function parseManagedFile(file: string, text: string | null): ManagedFileView {
  const parsed = parseJsonObject(text);
  if (parsed.state !== 'ok') return { file, state: parsed.state, entries: [] };
  return { file, state: 'ok', entries: toEntries(parsed.value) };
}
