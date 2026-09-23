import { describe, expect, it } from 'vitest';
import { tagMcpServersByOrigin } from './mcpOriginView';

describe('tagMcpServersByOrigin', () => {
  it('tagMcpServersByOrigin_sinServidores_devuelveArrayVacio', () => {
    expect(tagMcpServersByOrigin([], ['database'])).toEqual([]);
  });

  it('tagMcpServersByOrigin_nombreEnComunes_seEtiquetaComun', () => {
    const result = tagMcpServersByOrigin([{ name: 'database', status: 'connected' }], ['database']);

    expect(result).toEqual([{ name: 'database', status: 'connected', origin: 'comun' }]);
  });

  it('tagMcpServersByOrigin_nombreFueraDeComunes_seEtiquetaPropio', () => {
    const result = tagMcpServersByOrigin([{ name: 'proyecto-x', status: 'connected' }], ['database']);

    expect(result).toEqual([{ name: 'proyecto-x', status: 'connected', origin: 'propio' }]);
  });

  it('tagMcpServersByOrigin_sinListaDeComunes_todoEsPropio', () => {
    const result = tagMcpServersByOrigin([{ name: 'proyecto-x', status: 'connected' }], []);

    expect(result).toEqual([{ name: 'proyecto-x', status: 'connected', origin: 'propio' }]);
  });

  it('tagMcpServersByOrigin_mezclaDeComunesYPropios_etiquetaCadaUno', () => {
    const result = tagMcpServersByOrigin(
      [
        { name: 'database', status: 'connected' },
        { name: 'proyecto-x', status: 'connected' },
      ],
      ['database', 'chrome-devtools'],
    );

    expect(result).toEqual([
      { name: 'database', status: 'connected', origin: 'comun' },
      { name: 'proyecto-x', status: 'connected', origin: 'propio' },
    ]);
  });
});
