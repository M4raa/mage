// Entrada de `tasks-e1.mjs`: reexporta el código REAL del modo de tareas de Mage para que el spike lo use sin copiarlo.
// Lo empaqueta esbuild; no hace nada por sí misma.
export { buildTaskInstructions } from '../src/main/tasks/taskInstructions';
export { withTaskDirectories } from '../src/main/tasks/taskLaunch';
export { checkDeliverables } from '../src/main/tasks/deliverableChecker';
export { nodeDeliverableFs } from '../src/main/tasks/taskNodeFs';
export { scrubAgentEnv } from '../src/main/os/agentEnv';
export { parseDeliverables, taskVerdictOf } from '@shared/tasks';
