import { isAbsolute, join } from 'node:path';
import type { CapabilityEngine, CapabilityPackage } from './capabilityPackage';

// 'native' = lo instala el gestor del CLI; 'ownedFiles' = lo escribe el registro de propiedad de Mage;
// 'mageMcp' = un MCP con clave: Mage lo añade en cada lanzamiento y la clave vive en su bóveda.
export type InstallRoute = 'native' | 'ownedFiles' | 'mageMcp';

export function installRouteFor(pkg: CapabilityPackage, engine: CapabilityEngine): InstallRoute {
  if (!pkg.engines.includes(engine)) {
    throw new Error(`El paquete ${pkg.id} no declara el motor ${engine} (declara: ${pkg.engines.join(', ')})`);
  }
  switch (pkg.kind) {
    case 'mcp':
      return mcpRoute(pkg);
    case 'plugin':
      return 'native';
    case 'skill':
      return skillRoute(pkg, engine);
    case 'agent':
      throw new Error(
        `Los agentes sueltos todavía no se instalan: comparten el directorio agents/ y el registro de propiedad trabaja con un directorio por paquete (${pkg.id})`,
      );
    case 'hook':
      throw new Error(
        `Un hook suelto no tiene gestor nativo ni fichero propio: se distribuye dentro de un plugin (${pkg.id})`,
      );
  }
}

function mcpRoute(pkg: CapabilityPackage): InstallRoute {
  if ((pkg.requires.secrets ?? []).length === 0) return 'native';
  if (pkg.native?.type === 'mcpStdio') return 'mageMcp';
  throw new Error(`Un MCP con clave solo se admite como stdio (${pkg.id})`);
}

function skillRoute(pkg: CapabilityPackage, engine: CapabilityEngine): InstallRoute {
  if (engine === 'claude') return 'ownedFiles';
  throw new Error(
    `No está medido dónde lee Codex las skills sueltas: el paquete ${pkg.id} no se instala en Codex`,
  );
}

// Medido en C2: `<config>/skills/<nombre>/SKILL.md`.
export function claudeSkillRoot(configDir: string, packageId: string): string {
  if (configDir.trim() === '' || !isAbsolute(configDir)) {
    throw new Error(
      `Falta el config dir de la cuenta (CLAUDE_CONFIG_DIR): nunca se usa el del usuario por defecto. ` +
        `Recibido: ${JSON.stringify(configDir)}`,
    );
  }
  return join(configDir, 'skills', packageId);
}
