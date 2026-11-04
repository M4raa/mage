import { shortcutText } from '../keybindings/resolver';
import { isMacPlatform } from '../keybindings/platform';
import { useWorkbenchStore } from '../workbenchStore';
import type { PermissionKeys } from './PermissionDecisionButtons';

// Las teclas efectivas (por defecto del catalogo o reasignadas en Configuracion) de las tres decisiones
// de un permiso, ya formateadas para pintarlas.
export function usePermissionKeys(): PermissionKeys {
  const overrides = useWorkbenchStore((s) => s.settings.keybindingOverrides);
  const isMac = isMacPlatform();
  return {
    allow: shortcutText('permission.allow', overrides, isMac),
    allowAlways: shortcutText('permission.allowAlways', overrides, isMac),
    deny: shortcutText('permission.deny', overrides, isMac),
  };
}
