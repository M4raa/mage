import { useWorkbenchStore } from './workbenchStore';

// ¿Que sesion tiene que MOSTRAR el Inspector para la pestaña activa?
//
// La viva si la hay, y si no el `resumeSessionId` de una conversacion reabierta del historial. Esa
// segunda mitad es la que faltaba: en Mage la sesion arranca PEREZOSA (no hay proceso del CLI hasta el
// primer mensaje), asi que una conversacion recien abierta tiene transcripcion completa en disco y
// `sessionIdByChat` vacio. Los paneles de Contexto y Logs miraban solo el mapa de sesiones vivas y
// contestaban "Sin conversacion activa" encima de una conversacion abierta y llena — reporte del
// usuario, y no es un caso raro: es lo que pasa SIEMPRE al abrir algo del historial.
//
// Vive aqui y no repetido en cada panel porque ya iban tres copias (`AgentsPanel` tenia la version
// correcta, Contexto y Logs la incompleta) y esa divergencia es justo el bug.
export function useActiveTranscriptSessionId(): string | undefined {
  return useWorkbenchStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (tab === undefined) return undefined;
    return s.sessionIdByChat[s.activeTabId] ?? tab.resumeSessionId;
  });
}
