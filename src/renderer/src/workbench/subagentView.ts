// Lo que necesita el drill-down a la transcripcion de un subagente (`subagents/agent-<agentId>.jsonl`).
// La lista de invocaciones que se derivaba aqui de la transcripcion en disco (`buildSubagentList`) se
// quito en P-028 38: el panel de agentes sale ahora de los bloques en vivo (`conversationAgentRows`).
export interface SubagentInvocation {
  readonly toolUseId: string;
  readonly entryIndex: number; // index de la linea assistant que lo invoco; -1 si viene de los bloques
  readonly agentType: string | null; // input.subagent_type
  readonly description: string | null; // input.description
  readonly agentId: string | null; // toolUseResult.agentId; null si aun sin resultado
  readonly status: string | null;
}
