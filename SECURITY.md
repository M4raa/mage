# Política de seguridad

## Qué maneja Mage, para que sepas qué estás mirando

Mage **lanza procesos** del CLI de un agente de código en tu máquina y **lee y escribe ficheros** en
las carpetas que autorices. Además toca cosas sensibles por diseño:

- El **directorio de configuración** del CLI (`~/.claude` y similares), donde vive el fichero de
  credenciales de tu sesión.
- Variables de entorno del proceso hijo, que se sanean antes de lanzarlo (`scrubAgentEnv`) para que
  una credencial del entorno no se cuele en el agente.
- Los valores de los **servidores MCP** que reparte Mage a Claude (variables de entorno y cabeceras, también las
  claves que guardas en la bóveda) se escriben en el fichero de configuración MCP de cada cuenta,
  `<datos de Mage>/shared-config/generated/claude-<huella>.mcp.json`, que se reescribe en cada arranque: en Linux y
  macOS con permisos `0600`, en Windows dentro de la carpeta de datos de tu perfil. No van en el entorno del CLI
  porque, medido con Claude Code 2.1.319, el CLI pasa su entorno entero a los comandos que ejecuta el agente (un
  `env` los habría enseñado), mientras que el `env` de un servidor del fichero solo le llega a ese servidor. Es un
  fichero tuyo más: un agente con permiso para leer fuera de su carpeta podría abrirlo. A Codex se le siguen
  pasando por el entorno de su proceso.
- Un **proxy local** en `127.0.0.1` para los proveedores compatibles con la API de OpenAI.
- Un **host local** para otros clientes de la misma máquina (terminal, widget, MCP): un *named pipe* en Windows o
  un socket Unix en Linux y macOS (directorio `0700`, socket `0600`), nunca un puerto de red. Hay dos credenciales:
  - El **token de arranque**: 32 bytes aleatorios que se generan en cada arranque y viven en un fichero que solo lee
    tu usuario (`<datos de Mage>/run/host-token`); no se pasa por variables de entorno ni llega a los agentes ni a la
    interfaz. Toda conexión lo presenta, pero como cualquier proceso de tu usuario puede leer ese fichero (también un
    agente), por sí solo **solo deja leer**: listar proyectos, cuentas y sesiones, su estado y sus resultados, y pedir
    el emparejamiento. Crear o enviar, cambiar opciones, contestar permisos, dar de alta cuentas o parar Mage
    responden «no está emparejado».
  - El **token de cliente**, para un cliente **emparejado**. La primera vez que un cliente (por ejemplo `mage chat`)
    necesita algo más que leer, Mage enseña en su ventana «¿Autorizas a «…» a controlar Mage?», con «Rechazar» como
    opción por defecto. Sin respuesta en 2 minutos, o si Mage corre sin ventana, se rechaza. Si lo autorizas, Mage
    entrega al cliente un token propio UNA vez y guarda solo su SHA-256, con el nombre, el tipo, la fecha de alta y la
    del último uso, en `<datos de Mage>/host-clients.json`. La terminal guarda el suyo en
    `<datos de Mage>/run/client-token`, legible solo por tu usuario. Cualquiera se revoca en Configuración › Hooks y
    permisos › Clientes emparejados: revocar corta en el acto las conexiones abiertas con ese token, y el cliente
    tendrá que volver a pedir permiso.

  Las sesiones que lanza Mage no pasan por el diálogo: su servidor MCP (`mage mcp`) presenta, además del token de
  arranque, una credencial de su sesión que solo recibe el proceso de esa sesión (nunca está en disco) y que deja de
  valer cuando la sesión termina. Con ella solo se abre el canal MCP, cuyas herramientas aplican sus propios límites
  (qué sesiones puede ver o crear, profundidad, cuentas); no da acceso a los demás métodos de escritura. En Windows,
  Node no permite restringir el descriptor de seguridad del pipe, así que la barrera real son estos tokens.

Mage **no envía telemetría** ni tiene servidor propio: no hay ningún sitio al que tu contenido viaje
por parte del proyecto. Las peticiones que hace Mage por su cuenta están todas en la sección siguiente.

## Conexiones que hace Mage por su cuenta

Los CLI que lanza Mage hablan con su fabricante como lo harían en tu terminal. Aparte de eso, el proceso
principal de Mage hace estas peticiones:

| Para qué | A dónde | Qué envía | Cuándo |
|---|---|---|---|
| Panel de uso de las cuentas de Claude por suscripción | `GET https://api.anthropic.com/api/oauth/usage` | El token de acceso de esa cuenta, leído de su `.credentials.json`; `anthropic-beta: oauth-2025-04-20`; `User-Agent: claude-code/<versión>` | Al consultar el uso; como mucho una vez cada 3 minutos por cuenta |
| Renovar la sesión de esa cuenta | `POST https://platform.claude.com/v1/oauth/token` | El *refresh token* de la cuenta y el identificador de cliente público de Claude Code | Solo si la consulta de uso o la de artifacts responde 401. El token nuevo se escribe en el `.credentials.json` de esa cuenta |
| Lista y lectura de artifacts de las cuentas de Claude por suscripción | `GET https://api.anthropic.com/api/frame/artifacts`, `GET https://api.anthropic.com/api/frame/<id>` y `GET https://<id>.frame.claudeusercontent.com/_f/…` | El token de acceso de esa cuenta, leído de su `.credentials.json`; `anthropic-beta: oauth-2025-04-20`; `User-Agent: claude-code/<versión>`; cabeceras `X-Frame-*` del CLI. Al host del contenido solo el token de lectura de ese artifact que devuelve la anterior | Al abrir el panel de artifacts y al abrir uno |
| Estado del servicio de Claude | `GET https://status.claude.com/api/v2/summary.json` | Nada tuyo | Cuando la interfaz enseña el estado |
| Buscar e importar temas | `https://open-vsx.org` | El texto que buscas | Solo al buscar o importar un tema |
| Actualizaciones | Releases de GitHub de `M4raa/mage` | Nada tuyo | Al arrancar y al pedirlo en Configuración |
| Proveedores que das de alta tú (Ollama, LM Studio…) | La URL que pusiste | Tus mensajes y, si la diste, tu clave | Al probar el proveedor y en cada turno |

**Por qué se presenta como Claude Code.** El endpoint de uso responde 429 a cualquier otro `User-Agent`, así
que Mage manda el del CLI, con la versión del `claude` que tienes instalado: la lee ejecutando `claude --version`
en tu máquina, sin red, y si no puede usa una fija. La renovación usa el cliente OAuth público de Claude Code
porque es el que emitió ese token. Son tus credenciales y no salen de tu máquina hacia ningún otro sitio. No es
una integración oficial: Anthropic puede cambiar esos endpoints, y entonces el panel de uso deja de funcionar.

El token OAuth de la cuenta se usa también para listar y leer sus artifacts, siempre desde el proceso principal; el
token de lectura de un artifact (y el resto de lo que devuelve su lectura) no sale de ese proceso ni va a un log. Lo
que se descarga de un artifact se guarda en una carpeta de caché dentro de los datos de Mage y se enseña en un
navegador aislado, sin cookies de claude.ai ni acceso a otros ficheros.

## Cómo informar de una vulnerabilidad

**No abras una issue pública.** Usa el aviso privado de GitHub:

> Security → Report a vulnerability (*private vulnerability reporting*)

Cuenta qué encontraste, cómo reproducirlo y qué impacto tiene. Si puedes, incluye versión de Mage
(Configuración → Acerca de Mage) y sistema operativo.

**Qué esperar:** acuse de recibo en unos días y, si el fallo se confirma, un arreglo en una versión
nueva con crédito a quien lo encontró, salvo que prefieras no aparecer. Esto lo mantiene una persona
en su tiempo: no hay acuerdos de nivel de servicio ni programa de recompensas.

## Versiones con soporte

Solo la **última versión publicada**. El proyecto está en beta y no se retro-portan arreglos.

## Qué cuenta y qué no

Cuenta, por ejemplo: que una credencial acabe en un log o en una transcripción, que una ruta escape
de la carpeta autorizada, que el proxy local acepte peticiones de fuera de la máquina, que el host local acepte una conexión sin el token o deje escribir a un cliente sin emparejar, que el flujo
de permisos pueda saltarse, o que una actualización se pueda suplantar.

No cuenta que Mage ejecute comandos: **es lo que hace**. El agente pide permiso y tú decides; si das
permiso a algo destructivo, se ejecuta. Lo mismo con abrir una carpeta ajena: lanzar un agente dentro
de un repositorio ejecuta lo que ese repositorio traiga (sus *hooks*, su configuración, sus servidores
MCP). Por eso Mage pregunta antes la primera vez que trabaja en una carpeta nueva.

En Claude, publicar un artifact, `git push` y crear o comentar en GitHub con `gh` piden permiso siempre, también en
Auto y Aceptar ediciones; solo «Omitir permisos» se lo salta.
