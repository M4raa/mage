// Meta-prompt PURO para la mejora de prompts (M2.3). Se le pasa a un `claude -p` puntual con un
// modelo barato; instruye a devolver SOLO el prompt reescrito (sin responderlo ni ejecutarlo).
// Modulo separado y testeable: el texto es la parte con logica; el servicio solo orquesta el spawn.
export function buildImprovePrompt(draft: string): string {
  const trimmed = draft.trim();
  if (trimmed.length === 0) throw new Error('El borrador de prompt esta vacio');
  return [
    'Eres un asistente que MEJORA prompts destinados a un agente de codigo.',
    'Reescribe el siguiente prompt para que sea claro, especifico y accionable, conservando su',
    'intencion y su idioma original. NO respondas al prompt ni ejecutes la tarea que describe.',
    'Devuelve UNICAMENTE el prompt mejorado: sin comillas, sin preambulo y sin explicaciones.',
    '',
    'Prompt original:',
    trimmed,
  ].join('\n');
}

// Instruccion (PURA, sin argumentos) para generar un PROMPT DE HANDOFF: se ejecuta con
// `claude --resume <sessionId> -p ...`, de modo que el modelo ya tiene el contexto de la conversacion
// y produce un prompt autocontenido para arrancar un chat nuevo que continue el trabajo.
export function buildHandoffPrompt(): string {
  return [
    'Genera un PROMPT DE HANDOFF autocontenido para arrancar un chat NUEVO que continue este trabajo',
    'SIN acceso a esta conversacion. Escribelo como instrucciones directas para ese nuevo agente.',
    'Incluye, conciso y estructurado: (1) objetivo general; (2) contexto y decisiones ya tomadas;',
    '(3) estado actual / lo hecho; (4) proximos pasos concretos; (5) ficheros o rutas clave.',
    'Conserva el idioma de la conversacion. Devuelve UNICAMENTE el prompt de handoff, sin preambulo,',
    'sin explicaciones y sin vallas de codigo alrededor.',
  ].join('\n');
}
