import type { MentionPreview, MentionPreviewParams } from '@shared/mentions';
import { guardMention } from './mentionGuard';
import { classifyMention, SNIFF_BYTES } from './mentionKind';
import type { MentionResolverDeps } from './mentionResolver';

export const PREVIEW_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PREVIEW_TEXT_MAX_LINES = 20;
export const PREVIEW_TEXT_MAX_CHARS = 2000;
// Bytes que se leen para la vista previa de texto: de sobra para 2000 caracteres.
const PREVIEW_TEXT_READ_BYTES = 16 * 1024;

const NONE: MentionPreview = { kind: 'none' };

// Vista previa de un fichero mencionado: mismas comprobaciones de confianza y de carpeta que la resolucion.
export async function previewMention(params: MentionPreviewParams, deps: MentionResolverDeps): Promise<MentionPreview> {
  if (typeof params.absPath !== 'string' || params.absPath.length === 0) {
    throw new Error(`absPath de vista previa invalida: ${JSON.stringify(params.absPath)}`);
  }
  const guard = guardMention(params.cwd, params.accountDir, params.absPath, deps);
  if (guard.state !== 'ok') return NONE;
  const stat = await deps.stat(guard.real);
  const head = stat === null ? null : await deps.readHead(guard.real, SNIFF_BYTES);
  if (stat === null || head === null) return NONE;
  const { kind, mime } = classifyMention(params.absPath, head);
  if (kind === 'image') return stat.bytes <= PREVIEW_IMAGE_MAX_BYTES ? imagePreview(guard.real, mime, deps) : NONE;
  return kind === 'text' ? textPreview(guard.real, deps) : NONE;
}

async function imagePreview(real: string, mime: string, deps: MentionResolverDeps): Promise<MentionPreview> {
  const data = (await deps.readFile(real)).toString('base64');
  return { kind: 'image', dataUrl: `data:${mime};base64,${data}` };
}

async function textPreview(real: string, deps: MentionResolverDeps): Promise<MentionPreview> {
  const bytes = await deps.readHead(real, PREVIEW_TEXT_READ_BYTES);
  if (bytes === null) return NONE;
  const lines = Buffer.from(bytes).toString('utf8').split('\n').slice(0, PREVIEW_TEXT_MAX_LINES);
  return { kind: 'text', head: lines.join('\n').slice(0, PREVIEW_TEXT_MAX_CHARS) };
}
