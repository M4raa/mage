# CLAUDE.md — Mage

Guía que se auto-carga en cada sesión. Concisa a propósito: el detalle vive en los documentos
enlazados. **Léelos antes de picar.**

## Documentos del proyecto
- **`README.md`** — qué es Mage, cómo se instala y qué tienes que aportar tú.
- **`CONTRIBUTING.md`** — cómo levantar el proyecto y qué se espera de un cambio.
- **`SECURITY.md`** — qué toca Mage de tu máquina y cómo avisar de un fallo en privado.
- **`.claude/skills/`** — tres trampas ya pagadas, con su causa raíz medida. Léelas ANTES de tocar
  esas áreas: `protocolo-cli` (un CLI se mide, no se deduce de su `--help`), `tocar-main` (el HMR no
  recarga `main`) y `verificacion-gui` (los seis errores ya cometidos verificando la interfaz).

## Qué es Mage (una línea)
App de escritorio **multiplataforma** (Electron+React+TS+Vite+Zustand+Tailwind), **wrapper
multiagéntico y multi-proveedor** sobre agentes de código tipo Claude Code, con UI propia,
multicuenta, análisis de uso/logs y más.

## Invariantes (no romper)
- **Motor:** cada agente = CLI real de Claude Code en headless stream-json
  (`claude -p --input-format stream-json --output-format stream-json --verbose
  --permission-prompt-tool stdio --include-partial-messages ...`). Consume la **suscripción** con login OAuth. El entorno del
  hijo se sanea con `scrubAgentEnv` (`src/main/os/agentEnv.ts`), que borra **todas** las variables de
  credencial —no solo `ANTHROPIC_API_KEY`: también `ANTHROPIC_AUTH_TOKEN` y `ANTHROPIC_BASE_URL`, que
  desactivan OAuth o redirigen el Bearer—. **Única excepción, y es a propósito:** `gatewayAdapter`
  fija después `ANTHROPIC_BASE_URL` a `127.0.0.1` y `ANTHROPIC_API_KEY` a un ticket `sk-mage-<id>` que
  no es credencial de ningún proveedor. **NO** usar el Agent SDK (factura API).
- **Multiplataforma (crítico):** Windows/macOS/Linux. Nada de rutas/comandos hardcodeados por SO;
  todo tras abstracción (`LinkService`, `OpenWithService` y los tres resolutores de binario:
  `claudeBinaryResolver`, `agyBinaryResolver` y su núcleo común `agentBinaryResolver`); usar
  `path.join`/`os.homedir()`.
- **Multi-proveedor:** núcleo `AgentSession` provider-agnostic vía `ProviderAdapter` + modelo de
  eventos común. hoy hay **TRES** implementaciones: `claudeAdapter`, `agyAdapter` y `gatewayAdapter` (proveedores
  OpenAI-compatibles vía un proxy local que traduce el protocolo).
- **Seguridad:** nunca loguear/emitir credenciales, tokens, `oauthAccount`, `userID`, `machineID`.
- **Estado en disco de cada cuenta:** cada cuenta tiene su propio config dir y Mage **no comparte
  credenciales entre ellas**. Los detalles de cómo se resuelve están comentados en
  `src/main/accounts/` — léelos antes de "arreglar por consistencia" nada de ahí: hay dos decisiones
  que parecen inconsistentes y no lo son.
- **Fuente del protocolo:** el paquete **público** `@anthropic-ai/claude-agent-sdk` (sus esquemas del
  wire format) y, por encima de él, **lo medido contra el binario real** en `spike/`. Ese es el orden:
  el binario manda, el SDK documenta, y cuando discrepan gana la medición (lo recoge la skill
  `protocolo-cli`). **No se copia código de nadie**: los esquemas de Mage son reimplementación propia,
  tolerante y parcial (`.catch()`/`.passthrough()`, campos que el protocolo no documenta), con la
  versión del CLI contra la que se midieron anotada al lado.

## Orden de trabajo
Por milestones (M1 MVP → M2 funcionalidad → M3 UI/UX). Entra en
modo plan para diseñar cada milestone; verifica end-to-end (arranca lo construido, no solo tests).

## Herramientas del repo (úsalas antes de reinventarlas)
- **`pnpm check`** = typecheck (node+web) + tests. **`pnpm build`** además atrapa fallos de bundle.
- **`pnpm verify:gui`** — arranca la app real con **perfil aislado**, mide el DOM por CDP y deja informe
  + capturas en `.verify-out/`. **No escribas un driver CDP desechable: añade una comprobación aquí.**
  Envía **un solo turno real por ejecución**: la última comprobación, contra Claude con el modelo y el
  esfuerzo más bajos, tras afirmar el proveedor de la pestaña. Antes mira el uso de la cuenta: con más
  del 70 % gastado avisa y deja elegir real o local (servidor falso); sin terminal interactiva elige
  local y lo dice en el informe (`--turn=local|real` fuerza uno). Ninguna otra comprobación pulsa
  `Enter` en el prompt ni spawnea el CLI.
- **`spike/`** — spikes reproducibles contra los CLI reales (`engine-spike.mjs`, `agy-spike.mjs`).
  Un CLI nuevo se **mide**, no se deduce de su `--help` (que ya mintió una vez).
- **`.claude/skills/`** — `tocar-main` (el HMR no recarga `main`; borrar el estado al reordenar un
  catálogo), `verificacion-gui` (los **seis** errores ya cometidos) y `protocolo-cli`. Léelos cuando toques
  esas áreas: recogen fallos que este proyecto YA pagó.

## Estándares de código (OBLIGATORIOS)
Idioma: **identificadores en inglés, comentarios en castellano.** Tres pilares: **corrección**
(todos los casos, no solo happy path), **rendimiento** (coste acorde al volumen real),
**mantenibilidad**.
- **Responsabilidad única:** funciones ≤30–40 líneas, ≤3–4 parámetros (si no, objeto de contexto).
- **Preparación-Ejecución + guard clauses:** precondiciones al inicio, salir pronto; nunca >3
  niveles de indentación; caso nominal al final.
- **Inyección de dependencias** por constructor/parámetros (nunca instanciar dentro) → testable
  con mocks. En React, deps por props/hooks; lógica de negocio fuera de los componentes.
- **Rendimiento:** evitar O(n²) (indexar en `Map`, acceso O(1)); colecciones expresivas y
  consistentes.
- **Parseo seguro en la frontera:** validar fechas/números externos (incl. NDJSON del CLI con
  esquemas Zod); UTC interno. Dinero nunca en `float`; tokens enteros.
- **Contratos de error:** lanzar `Error` con mensaje que incluye el valor recibido; prohibido
  `catch { return default }` silencioso; validar precondiciones en funciones públicas.
- **`===`/`!==`.** DRY, sin magic numbers (constantes/config). Generalizar con genéricos.
- **Legibilidad:** arrow simples inline, extraer las complejas; nombres por intención con verbos.
- **Testing (Vitest):** lógica de negocio (parser, cálculo de uso/tokens, `AccountService`,
  `ProviderAdapter`) en módulos **puros**; patrón **AAA**; nombres
  `metodo_condicion_resultadoEsperado`; cubrir happy path + límites (0, negativo, vacío, `null`)
  + errores; mocks para FS/red/procesos.
- **Antipatrones prohibidos:** `catch` que silencia; comparaciones laxas; dinero en `float`;
  magic numbers; >3 niveles de indentación sin guard clauses; ternarios anidados; deps
  instanciadas dentro de funciones; tests acoplados a orden/estado; parseo directo de
  fechas/decimales externos sin validar.
