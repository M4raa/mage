import { ERROR_FORMAT_LOCALE, validateAttachment } from '@shared/attachments';
import type { ImageAttachment } from '@shared/ipc';
import type { MentionKind, MentionOutcome, MentionRef, MentionResolution, MentionResolveParams } from '@shared/mentions';
import { planDelivery, type DeliveryPlan } from '@shared/mentionDelivery';
import { inlineBlock, pathOnlyNote } from './mentionDelivery';
import { guardMention, type MentionGuardDeps } from './mentionGuard';
import { classifyMention, SNIFF_BYTES } from './mentionKind';

export interface MentionResolverDeps extends MentionGuardDeps {
  readonly stat: (absPath: string) => Promise<{ readonly bytes: number } | null>;
  readonly readHead: (absPath: string, bytes: number) => Promise<Uint8Array | null>;
  readonly readFile: (absPath: string) => Promise<Buffer>;
}

type Outcome = { readonly outcome: MentionOutcome; readonly kind: MentionKind | null; readonly text?: string; readonly attachment?: ImageAttachment };

// Resuelve las menciones de un mensaje EN EL MOMENTO DE ENVIAR. Todo se rehace aqui leyendo el disco:
// del renderer solo se usan las rutas. Un fichero concreto nunca lanza: su resultado va en `outcomes`.
export async function resolveMentions(params: MentionResolveParams, deps: MentionResolverDeps): Promise<MentionResolution> {
  assertRefs(params.refs);
  const results: Outcome[] = [];
  // En orden y de uno en uno: el texto y los adjuntos conservan el orden de las menciones.
  for (const ref of params.refs) results.push(await resolveOne(ref, params, deps));
  return {
    text: results.map((result) => result.text ?? '').join(''),
    attachments: results.flatMap((result) => (result.attachment === undefined ? [] : [result.attachment])),
    outcomes: params.refs.map((ref, index) => ({ relPath: ref.relPath, outcome: results[index]!.outcome, kind: results[index]!.kind })),
  };
}

function assertRefs(refs: readonly MentionRef[]): void {
  if (!Array.isArray(refs)) throw new Error(`refs de menciones invalidas (se esperaba un array): ${JSON.stringify(refs)}`);
  for (const ref of refs) {
    const valid = typeof ref === 'object' && ref !== null && isFilled(ref.absPath) && isFilled(ref.relPath);
    if (!valid) throw new Error(`ref de mencion invalida (absPath y relPath son strings no vacios): ${JSON.stringify(ref)}`);
  }
}

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

async function resolveOne(ref: MentionRef, params: MentionResolveParams, deps: MentionResolverDeps): Promise<Outcome> {
  const guard = guardMention(params.cwd, params.accountDir, ref.absPath, deps);
  if (guard.state === 'outside') return { outcome: 'outsideFolder', kind: null };
  if (guard.state === 'missing') return { outcome: 'missing', kind: null };
  const stat = await deps.stat(guard.real);
  const head = stat === null ? null : await deps.readHead(guard.real, SNIFF_BYTES);
  if (stat === null || head === null) return { outcome: 'missing', kind: null };
  const { kind, mime } = classifyMention(ref.relPath, head);
  const plan = planDelivery(kind, stat.bytes, params.provider);
  return deliver({ plan, kind, mime, real: guard.real, relPath: ref.relPath, bytes: stat.bytes }, deps);
}

interface DeliveryContext {
  readonly plan: DeliveryPlan;
  readonly kind: MentionKind;
  readonly mime: string;
  readonly real: string;
  readonly relPath: string;
  readonly bytes: number;
}

async function deliver(context: DeliveryContext, deps: MentionResolverDeps): Promise<Outcome> {
  const { plan, kind, real } = context;
  const pathOnly: Outcome = { outcome: 'pathOnly', kind, text: pathOnlyNote(real) };
  if (plan === 'pathOnly') return pathOnly;
  if (plan === 'inline') {
    return { outcome: 'inline', kind, text: inlineBlock(context.relPath, (await deps.readFile(real)).toString('utf8')) };
  }
  if (!isAttachable(context.mime, context.bytes)) return pathOnly;
  const data = (await deps.readFile(real)).toString('base64');
  return { outcome: 'attached', kind, attachment: { mediaType: context.mime as ImageAttachment['mediaType'], data } };
}

// Un adjunto que no pasa la validacion (tamano, tipo) se degrada a «solo la ruta»: es el comportamiento
// decidido, y el resultado queda en `outcomes`, asi que no se pierde en silencio.
function isAttachable(mime: string, bytes: number): boolean {
  try {
    validateAttachment({ mediaType: mime, byteLength: bytes }, ERROR_FORMAT_LOCALE);
    return true;
  } catch {
    return false;
  }
}
