import { describe, expect, it } from 'vitest';
import { parseNotifyParams } from './notifyParams';

describe('parseNotifyParams', () => {
  it('parseNotifyParams_conDestino_devuelveLosParametros', () => {
    // Arrange
    const raw = { title: 'Turno completado', body: 'proj', target: { tabId: 't1', sessionId: 's1', opensActivity: true } };

    // Act / Assert
    expect(parseNotifyParams(raw)).toEqual(raw);
  });

  it('parseNotifyParams_sinDestino_esValido', () => {
    expect(parseNotifyParams({ title: 'CI terminado', body: '' })).toEqual({ title: 'CI terminado', body: '' });
  });

  it('parseNotifyParams_tituloVacio_lanzaConElCamino', () => {
    expect(() => parseNotifyParams({ title: '', body: 'x' })).toThrow('title');
  });

  it('parseNotifyParams_campoDesconocido_lanza', () => {
    expect(() => parseNotifyParams({ title: 'a', body: 'b', icon: 'file:///c:/x.png' })).toThrow('NotifyShow');
  });

  it('parseNotifyParams_destinoSinSesion_lanza', () => {
    expect(() => parseNotifyParams({ title: 'a', body: 'b', target: { tabId: 't1' } })).toThrow('target.sessionId');
  });

  it('parseNotifyParams_null_lanza', () => {
    expect(() => parseNotifyParams(null)).toThrow('NotifyShow');
  });
});
