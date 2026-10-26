# Política de seguridad

## Qué maneja Mage, para que sepas qué estás mirando

Mage **lanza procesos** del CLI de un agente de código en tu máquina y **lee y escribe ficheros** en
las carpetas que autorices. Además toca cosas sensibles por diseño:

- El **directorio de configuración** del CLI (`~/.claude` y similares), donde vive el fichero de
  credenciales de tu sesión.
- Variables de entorno del proceso hijo, que se sanean antes de lanzarlo (`scrubAgentEnv`) para que
  una credencial del entorno no se cuele en el agente.
- Un **proxy local** en `127.0.0.1` para los proveedores compatibles con la API de OpenAI.
- Un **host local** para otros clientes de la misma máquina (terminal, widget, MCP): un *named pipe* en Windows o
  un socket Unix en Linux y macOS (directorio `0700`, socket `0600`), nunca un puerto de red. Cada conexión tiene que
  presentar un token aleatorio de 32 bytes que se genera en cada arranque y vive en un fichero que solo lee tu
  usuario (`<datos de Mage>/run/host-token`); no se pasa por variables de entorno ni llega a los agentes ni a la
  interfaz. En Windows, Node no permite restringir el descriptor de seguridad del pipe, así que la barrera real es
  ese token.

Mage **no envía telemetría** ni tiene servidor propio: no hay ningún sitio al que tu contenido viaje
por parte del proyecto. Las conexiones de red son las de los proveedores que configures y la
comprobación de actualizaciones.

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
de la carpeta autorizada, que el proxy local acepte peticiones de fuera de la máquina, que el host local acepte una conexión sin el token, que el flujo
de permisos pueda saltarse, o que una actualización se pueda suplantar.

No cuenta que Mage ejecute comandos: **es lo que hace**. El agente pide permiso y tú decides; si das
permiso a algo destructivo, se ejecuta. Lo mismo con abrir una carpeta ajena: lanzar un agente dentro
de un repositorio ejecuta lo que ese repositorio traiga (sus *hooks*, su configuración, sus servidores
MCP). Por eso Mage pregunta antes la primera vez que trabaja en una carpeta nueva.
