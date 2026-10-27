import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Devolución 19: el renderer reescribe `resumeSessionId` con el `newSessionId` de un `conversation_reset`. En Codex y agy
// ese campo es el id del hilo, así que un reset suyo sustituiría el hilo por otro id. Hoy solo lo emiten Claude (`/clear`,
// normalize.ts) y el runtime propio. Si un adapter de Codex o agy empieza a emitirlo, este test obliga a revisar antes
// `conversationIdOfTab` y el `conversation_reset` del store.
const OWN_CONVERSATION_EVENT_SOURCES = ['codexAdapter.ts', 'codexProtocol.ts', 'agyAdapter.ts', 'agyNormalize.ts'];

describe('adapters de Codex y agy', () => {
  it.each(OWN_CONVERSATION_EVENT_SOURCES)('%s_noEmiteConversationReset', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');

    expect(source.includes('conversation_reset')).toBe(false);
  });
});
