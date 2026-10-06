import type { ProviderAccountEntry } from './providerAccounts';
import { z } from 'zod';

const DIRECTORY = z.string().trim().min(1);

export function requireCodexSubscription(raw: unknown, find: (home: string) => ProviderAccountEntry | null): ProviderAccountEntry {
  const parsed = DIRECTORY.safeParse(raw);
  if (!parsed.success) throw new Error(`Directorio de cuenta inválido (tipo ${typeof raw}, longitud ${typeof raw === 'string' ? raw.length : 0}).`);
  const entry = find(parsed.data);
  if (entry === null || entry.authKind !== 'subscription' || entry.providerId !== 'codex') throw new Error('Se requiere una cuenta de suscripción de Codex registrada.');
  return entry;
}
