import { beforeEach, describe, expect, it } from 'vitest';
import { notifyCostAdvice } from './PromptBar';
import { useWorkbenchStore } from '../workbenchStore';
import { useNotificationStore } from '../notificationStore';
import { EMPTY_NOTIFICATIONS } from '../notifications';
import { displayTitle } from '../conversationTitle';
import type { CostAdvice } from '../costAdvice';

beforeEach(() => useNotificationStore.setState(EMPTY_NOTIFICATIONS, true));

describe('notifyCostAdvice', () => {
  it('notifyCostAdvice_pestañaSinTitulo_cuerpoEsElTituloDeReserva', () => {
    const tab = { id: 'tab-sin-titulo', accountId: 'c', accountAlias: 'a', cwd: '/p', model: 'sonnet', provider: 'claude', title: '', privacy: 'shared' } as const;
    useWorkbenchStore.setState({ tabs: [tab] });
    const advice = { severity: 'warn', message: 'Coste mayor' } as unknown as CostAdvice;

    notifyCostAdvice(advice, tab.id);

    const toast = useNotificationStore.getState().toasts.find((n) => n.source === 'prompt');
    expect(toast?.body).toBe(displayTitle(''));
    expect(toast?.body).not.toBe('');
  });
});
