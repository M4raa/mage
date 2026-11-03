// Entrada del bundle de `library-spike.mjs` (punto de control (a) de la biblioteca): el código de producción, sin copiar nada.
export { LibraryService } from '../src/main/capabilities/library/libraryService';
export { libraryStatePath, saveLibraryState } from '../src/main/capabilities/library/libraryState';
export { bundledContents, loadBundledCatalog } from '../src/main/capabilities/catalog/libraryCatalog';
export { nodeCapabilityFs } from '../src/main/capabilities/capabilityFs';
export { parseCapabilityPackage } from '../src/main/capabilities/capabilityPackage';
export { execFileRunner } from '../src/main/capabilities/commandRunner';
export { NativeCommandError, runNativeCommand } from '../src/main/capabilities/nativeRunner';
export { nativeListCommand } from '../src/main/capabilities/nativeCommands';
export { parseCodexMcpList } from '../src/main/config/codexMcp';
export { findCodexBinary } from '../src/main/os/codexBinaryResolver';
export { resolveClaudeBinary } from '../src/main/os/claudeBinaryResolver';
export { scrubAgentEnv } from '../src/main/os/agentEnv';
