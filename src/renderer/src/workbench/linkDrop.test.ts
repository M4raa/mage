import { describe, expect, it } from 'vitest';
import { droppedLink, isLinkDrag } from './linkDrop';
import { TAB_DRAG_MIME } from './tabActions';

describe('isLinkDrag', () => {
  it('isLinkDrag_enlaceDelNavegador_true', () => {
    // Preparar.
    const types = ['text/uri-list', 'text/html', 'text/plain'];

    // Ejecutar y comprobar.
    expect(isLinkDrag(types)).toBe(true);
  });

  it('isLinkDrag_ficheros_false', () => {
    expect(isLinkDrag(['Files', 'text/uri-list'])).toBe(false);
  });

  it('isLinkDrag_pestanaDeMage_false', () => {
    expect(isLinkDrag([TAB_DRAG_MIME, 'text/uri-list'])).toBe(false);
  });

  it('isLinkDrag_soloTexto_false', () => {
    expect(isLinkDrag(['text/plain'])).toBe(false);
  });
});

describe('droppedLink', () => {
  it('droppedLink_conComentario_laPrimeraUrl', () => {
    // Preparar.
    const getData = () => '# c\r\nhttps://a.example/x\r\nhttps://b.example';

    // Ejecutar y comprobar.
    expect(droppedLink(getData)).toBe('https://a.example/x');
  });

  it('droppedLink_soloComentarios_null', () => {
    expect(droppedLink(() => '# uno\n# dos\n')).toBeNull();
  });

  it('droppedLink_vacio_null', () => {
    expect(droppedLink(() => '')).toBeNull();
  });
});
