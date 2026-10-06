import { describe, expect, it } from 'vitest';
import { resolve, join } from 'node:path';
import { projectVerificationFile, projectVerificationMcp } from '../../spike/codex-fixtures.mjs';

const workspace = resolve('artificial-workspace');
const file = (diff) => ({ type: 'fileChange', status: 'completed', changes: [
  { path: join(workspace, 'mage-edit.txt'), kind: { type: 'add' }, diff },
] });

describe('projectVerificationFile', () => {
  it('projectVerificationFile_contenidoExacto_proyectaSoloDatosAnonimos', () => {
    const item = { ...file('MAGE_EDIT_OK\n'), metadata: 'dato-artificial' };

    const result = projectVerificationFile(item, workspace);

    expect(result).toEqual({ type: 'fileChange', id: 'edit-measured', status: 'completed', changes: [
      { path: '<workspace>/mage-edit.txt', kind: { type: 'add' }, diff: 'MAGE_EDIT_OK\n' },
    ] });
  });

  it.each([null, {}, file(''), { ...file('MAGE_EDIT_OK\n'), changes: [] },
    { ...file('MAGE_EDIT_OK\n'), changes: [{ path: join(workspace, 'otro.txt'), kind: { type: 'add' }, diff: 'MAGE_EDIT_OK\n' }] },
    { ...file('MAGE_EDIT_OK\n'), changes: [{ path: 'mage-edit.txt', kind: { type: 'add', extra: 'dato' }, diff: 'MAGE_EDIT_OK\n' }] },
  ])('projectVerificationFile_cambioFueraDelContrato_rechaza_%#', (item) => {
    const act = () => projectVerificationFile(item, workspace);

    expect(act).toThrow('Edición fuera del contrato artificial de verificación.');
  });
  it('projectVerificationMcp_bloqueConCampoExtra_rechazaAntesDePersistir', () => {
    const item = { type: 'mcpToolCall', server: 'mage_verify', tool: 'probe', status: 'completed',
      result: { content: [{ type: 'text', text: 'MAGE_MCP_ENV_OK', private: 'dato-artificial' }] } };

    const act = () => projectVerificationMcp(item);

    expect(act).toThrow('Resultado MCP fuera del contrato artificial de verificación.');
  });
  it('projectVerificationFile_marcadorConContenidoAdicional_rechazaSinCopiarContenido', () => {
    const item = file('MAGE_EDIT_OK\ncontenido-adicional-artificial\n');

    const act = () => projectVerificationFile(item, workspace);

    expect(act).toThrow('Edición fuera del contrato artificial de verificación.');
  });
});
