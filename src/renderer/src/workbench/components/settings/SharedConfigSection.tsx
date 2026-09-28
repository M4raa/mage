import { useEffect } from 'react';
import { useSharedConfigStore } from '../../sharedConfigStore';
import { CommonRulesEditor } from './CommonRulesEditor';
import { McpServersEditor } from './McpServersEditor';

// Seccion "Config. compartida" (D1): los dos ficheros de Mage (fuera de cualquier CLAUDE_CONFIG_DIR)
// que se inyectan por flag (--mcp-config/--settings) en TODAS las cuentas al lanzar una conversacion,
// sin pisar nunca lo propio de cada cuenta.
//
// Antes esto era un par de textareas con JSON crudo, y "vacío" era literalmente un `{}` que no decia
// nada. Ahora se edita por bloques (un servidor MCP, una regla, un hook) y el estado vacio explica
// que falta; el fichero en disco sigue siendo el mismo JSON, que es lo que el CLI sabe leer.
export function SharedConfigSection(): React.JSX.Element {
  const snapshot = useSharedConfigStore((s) => s.snapshot);
  const isLoading = useSharedConfigStore((s) => s.isLoading);
  const loadError = useSharedConfigStore((s) => s.loadError);
  const load = useSharedConfigStore((s) => s.load);

  // Se recarga al abrir la seccion: el usuario puede haber editado los ficheros a mano por fuera.
  useEffect(() => {
    void load();
  }, []);

  if (loadError !== null && snapshot === null) {
    return (
      <div className="p-[14px_16px]">
        <div role="alert" className="text-[11px] text-mg-danger">
          No se pudo cargar la configuración compartida: {loadError}
        </div>
      </div>
    );
  }
  if (snapshot === null) {
    return <p className="p-[14px_16px] text-[11px] text-mg-muted">{isLoading ? 'Cargando configuración compartida…' : ''}</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto p-[14px_16px]">
      <p className="text-[11px] leading-[1.5] text-mg-sec">
        Lo que definas aquí se <strong>suma</strong> a la configuración de <strong>todas</strong> tus cuentas al lanzar
        una conversación, sin sustituir nunca la suya. Mage es la fuente de estos MCP compartidos: la primera vez se
        importan de <code>~/.claude/mcp-shared.json</code> y de los MCP de cada cuenta, y a partir de ahí se gestionan
        aquí. Para ver los que carga una conversación concreta, mira la pestaña <strong>MCP</strong> del Inspector.
      </p>

      {/* Colisiones de la importacion inicial (P-026 2.5, D10): mismo nombre con otra configuracion. */}
      {snapshot.mcpCommonImportNotes.length > 0 && (
        <div role="status" data-mcp-import-notes="true" className="flex flex-col gap-[3px] rounded-[7px] border border-mg-border-subtle bg-mg-code p-[8px_10px]">
          <span className="text-[10px] font-semibold text-mg-sec">Importados por primera vez, con avisos</span>
          <ul className="flex flex-col gap-[2px]">
            {snapshot.mcpCommonImportNotes.map((note) => (
              <li key={note} className="text-[10px] text-mg-sec">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      <McpServersEditor />
      <CommonRulesEditor />

      <Warnings title="mcp-common.json" warnings={snapshot.mcpCommonWarnings} />
      <Warnings title="settings-common.json" warnings={snapshot.settingsCommonWarnings} />
    </div>
  );
}

// Avisos de forma que calcula el main al leer el fichero (claves que el motor descartaria). Se siguen
// enseñando aunque la edicion ya no sea JSON crudo: pueden venir de una edicion hecha a mano.
function Warnings({ title, warnings }: { readonly title: string; readonly warnings: readonly string[] }): React.JSX.Element {
  if (warnings.length === 0) return <></>;
  return (
    <div className="flex flex-col gap-[3px] rounded-[7px] border border-mg-warn-border bg-mg-warn-bg p-[8px_10px]">
      <span className="text-[10px] font-semibold text-mg-warn-text">Avisos de {title}</span>
      <ul className="flex flex-col gap-[2px]">
        {warnings.map((warning) => (
          <li key={warning} className="text-[10px] text-mg-warn-text">
            {warning}
          </li>
        ))}
      </ul>
    </div>
  );
}
