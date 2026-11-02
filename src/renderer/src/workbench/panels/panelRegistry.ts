// Registro de paneles acoplables estilo JetBrains (F6, PLAN-F6-PANELES.md §3.1/§4.1). Modulo PURO de
// codigo (no serializado) — mismo patron que keybindings/actionCatalog.ts de D5: catalogo estatico
// con los metadatos de cada panel y su punto de render, consumido por panelLayout.ts (reconciliacion)
// y por el shell (LeftDock/RightDock/BottomDock, Fase 3, stripes + panes).
//
// Fase 3: los seis apuntan ya a su componente real (movido de sitio, no reescrito — ver cada fichero).
// 'permissions' salio de Inspector.tsx (funcion NO exportada) a su propio fichero, PermissionPanel.tsx,
// autonoma (lee el permiso pendiente directo del store en vez de recibirlo por prop, igual que el
// resto de paneles de contenido). Los otros cuatro (ChatSidebar, TranscriptContextPanel,
// TranscriptLogPanel, MemoryPanel, McpPanel) ya eran autonomos y se importan tal cual.

import { createElement } from 'react';
import { t } from '../../i18n/uiLanguage';
import type { Anchor, PanelId, ZoneKey } from '@shared/panelLayout';
import type { IconName } from '../components/Icon';
import { ChatSidebar } from '../components/ChatSidebar';
import { PermissionPanel } from '../components/PermissionPanel';
import { TranscriptContextPanel } from '../components/TranscriptContextPanel';
import { TranscriptLogPanel } from '../components/TranscriptLogPanel';
import { MemoryPanel } from '../components/MemoryPanel';
import { McpPanel } from '../components/McpPanel';
import { InstructionsPanel } from '../components/InstructionsPanel';
import { CommandsPanel } from '../components/CommandsPanel';
import { AgentsPanel } from '../components/AgentsPanel';
import { ToolsPanel } from '../components/ToolsPanel';
import { ArtifactsPanel } from '../components/ArtifactsPanel';
import { FilesPanel } from '../components/FilesPanel';
import { UsagePanel } from '../components/UsagePanel';
import { ActivityPanel } from '../components/ActivityPanel';

export interface PanelDefinition {
  readonly id: PanelId;
  readonly title: string;
  readonly icon: IconName; // forma propia de la suite (`panel*`), monocroma y sin emoji
  readonly defaultAnchor: Anchor;
  readonly defaultZone: ZoneKey;
  readonly render: () => React.JSX.Element;
}

// Catalogo v1 (§4.1) + 'usage' (feedback del usuario tras ver F6 en vivo: el uso de la cuenta activa
// pasa de popover flotante a panel acoplable mas, "otro panel del stack" del borde izquierdo).
//
// Zonas 'a' ("arriba") y 'b' ("medio", antes llamada "arriba-abajo"/"abajo" sin distinguir de la
// zona compartida de abajo) de cada lado renderizan SIEMPRE en el panel de SU MISMO lado (izquierda o
// derecha); la zona compartida de abajo (anchor 'bottom', §3.1 de PLAN-F6-PANELES.md) es una tercera
// posicion distinta, con icono en la barra lateral pero panel en el borde inferior — ver AccountRail.tsx/
// RightDock.tsx.
//
// Las cinco de la derecha comparten TODAS la misma zona ('a'), feedback del usuario (2026-08-06): tras
// probar el split Permiso+Contexto/Logs+Memoria+MCP en vivo, se prefiere volver al tablist unico (un
// panel activo a la vez, switch por icono, sin pestañas — ver ZonePane.tsx) y dejar 'b' libre para lo
// que el usuario decida mover ahi a mano.
type PanelTitleKey = 'menu.panel.conversations' | 'menu.panel.usage' | 'menu.panel.permissions' | 'menu.panel.context' | 'menu.panel.logs' | 'menu.panel.memory' | 'menu.panel.instructions' | 'menu.panel.commands' | 'menu.panel.agents' | 'menu.panel.tools' | 'menu.panel.artifacts' | 'menu.panel.files' | 'menu.panel.activity';

// Como se escribe cada panel aqui: el titulo es una CLAVE del catalogo de textos (o el literal, para «MCP»).
type PanelSpec = Omit<PanelDefinition, 'title'> & ({ readonly titleKey: PanelTitleKey } | { readonly title: string });

// `title` es un GETTER: se traduce al LEERLO, no al importar el modulo (el idioma aun no se conoce), y sigue siendo un
// `string` para quien lo lee (stripes, menus, atajos).
function definePanel(spec: PanelSpec): PanelDefinition {
  if ('title' in spec) return spec;
  const { titleKey, ...rest } = spec;
  return {
    ...rest,
    get title() {
      return t(titleKey);
    },
  };
}

const PANEL_SPECS: readonly PanelSpec[] = [
  { id: 'conversations', titleKey: 'menu.panel.conversations', icon: 'panelConversations', defaultAnchor: 'left', defaultZone: 'a', render: () => createElement(ChatSidebar) },
  { id: 'usage', titleKey: 'menu.panel.usage', icon: 'panelUsage', defaultAnchor: 'left', defaultZone: 'b', render: () => createElement(UsagePanel) },
  { id: 'permissions', titleKey: 'menu.panel.permissions', icon: 'panelPermissions', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(PermissionPanel) },
  { id: 'context', titleKey: 'menu.panel.context', icon: 'panelContext', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(TranscriptContextPanel) },
  { id: 'logs', titleKey: 'menu.panel.logs', icon: 'panelLogs', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(TranscriptLogPanel) },
  { id: 'memory', titleKey: 'menu.panel.memory', icon: 'panelMemory', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(MemoryPanel) },
  { id: 'mcp', title: 'MCP', icon: 'panelMcp', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(McpPanel) },
  // 2.9.b. Van a la MISMA zona que las cinco anteriores (tablist unico del Inspector). Anadir ids
  // nuevos NO obliga a borrar `panels-layout.json`: `reconcileLayoutWithRegistry` los añade al final y
  // solo abre uno si la zona estaba vacia — en una instalacion existente aparecen tres iconos nuevos y
  // ninguno se abre solo. Lo que si obligaria a borrarlo es cambiar el `defaultZone` de uno que YA
  // existia, y aqui no se cambia ninguno.
  { id: 'instructions', titleKey: 'menu.panel.instructions', icon: 'panelInstructions', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(InstructionsPanel) },
  { id: 'commands', titleKey: 'menu.panel.commands', icon: 'panelCommands', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(CommandsPanel) },
  { id: 'agents', titleKey: 'menu.panel.agents', icon: 'panelAgents', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(AgentsPanel) },
  // Herramientas que la sesion cargo de verdad. Mismo criterio que las de arriba: id NUEVO en la misma
  // zona, asi que `reconcileLayoutWithRegistry` lo añade al final sin abrirlo solo y sin obligar a
  // borrar `panels-layout.json`.
  { id: 'tools', titleKey: 'menu.panel.tools', icon: 'panelTools', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(ToolsPanel) },
  // Artifacts publicados por la conversacion activa (peticion del usuario). Mismo criterio que los de
  // arriba: id nuevo en la misma zona, asi que aparece sin abrirse solo ni obligar a borrar el layout.
  { id: 'artifacts', titleKey: 'menu.panel.artifacts', icon: 'panelArtifacts', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(ArtifactsPanel) },
  // Ficheros que la conversacion ha CREADO (2.10, peticion del usuario: "que aparezca a la derecha como
  // un artifact y asi poder ver el plan, poder editarlo"). Mismo criterio que los de arriba: id NUEVO en
  // la misma zona, asi que `reconcileLayoutWithRegistry` lo añade al final sin abrirlo solo y sin
  // obligar a borrar `panels-layout.json`. Lo que SI lo abre solo es que el agente cree un fichero
  // (`revealPanelById('files')` desde el store) — es justo lo que se pidio.
  { id: 'files', titleKey: 'menu.panel.files', icon: 'panelFiles', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(FilesPanel) },
  // Lo que el agente HACE, paso a paso (P-026 3.4): las herramientas salieron del chat. Id nuevo en la
  // misma zona: aparece sin abrirse solo; lo abre la linea de estado del chat (`revealPanelById`).
  { id: 'activity', titleKey: 'menu.panel.activity', icon: 'panelActivity', defaultAnchor: 'right', defaultZone: 'a', render: () => createElement(ActivityPanel) },
];

export const PANEL_REGISTRY: readonly PanelDefinition[] = PANEL_SPECS.map(definePanel);

export function findPanelDefinition(id: PanelId): PanelDefinition | undefined {
  return PANEL_REGISTRY.find((p) => p.id === id);
}

// Resuelve una lista de ids de panel (p.ej. ZoneState.panelIds) a sus PanelDefinition reales, en el
// mismo orden, descartando en silencio cualquier id que no exista en el registro ACTUAL — no deberia
// pasar tras reconcileLayoutWithRegistry (§3.3), pero esta funcion de presentacion no lo asume (nunca
// lanza: un id huerfano simplemente no pinta icono/pestaña, no rompe el resto de la stripe).
export function resolvePanelDefinitions(ids: readonly PanelId[]): readonly PanelDefinition[] {
  return ids.map(findPanelDefinition).filter((p): p is PanelDefinition => p !== undefined);
}
