# Guía de Mage

Lo mínimo para usar Mage. Lo que toca de tu máquina y a dónde se conecta está en [SECURITY.md](../SECURITY.md).

## Instalar

Windows x64: descarga `mage-<versión>.exe` de los [releases](https://github.com/M4raa/mage/releases) y ejecútalo.
Se instala por usuario, sin permisos de administrador. El `.msi` es para despliegues gestionados. Mage no trae
ningún agente dentro: necesitas instalado y con sesión iniciada el CLI de al menos uno (Claude Code, Codex o
`agy`). Mage lo localiza solo, y si no lo encuentra te lo dice.

## Cuentas

Cada cuenta es una carpeta de configuración propia del CLI, y Mage no comparte credenciales entre ellas. Las
cuentas se dan de alta desde Mage, que abre el inicio de sesión del propio CLI: Mage nunca ve tu contraseña.
Entre las cuentas de Claude sí se comparten, por enlace a `~/.claude`, estas carpetas: `paste-cache`,
`plugins`, `projects`, `sessions`, `skills`, `todos`, `commands` y `agents`.

## Suscripción o clave de API

Se elige por cuenta, y las dos formas conviven:

- **Suscripción:** la cuenta usa el inicio de sesión del CLI y consume tu plan, igual que en la terminal.
- **Clave de API:** la clave se guarda cifrada con el cifrado del sistema (`safeStorage` de Electron) y solo
  llega al proceso de esa cuenta. Sus pestañas dicen «Factura API».

Mage borra del entorno de cada agente las claves que tengas exportadas (`ANTHROPIC_API_KEY` y similares), así
que una cuenta de suscripción nunca factura por API sin querer.

## El comando `mage`

El instalador `.exe` añade `mage` al PATH de tu usuario; el `.msi`, no. En Linux, el `.deb` lo deja en
`/usr/bin/mage`, y el AppImage se usa como `Mage.AppImage --cli <argumentos>`.

- `mage chat`: conversa desde la terminal con una sesión de Mage (`--session`, `--conversation` o `--new`).
- `mage stop [--force]`: cierra el Mage sin ventanas de ese perfil.
- `mage account add --provider claude|codex --name <nombre>`: da de alta una cuenta de API; la clave se pide sin eco.
- `mage mcp`: el servidor MCP de Mage por stdio, el que lanzan Claude y Codex.
- `mage help`: la ayuda.

## Tus datos en local

Las conversaciones son las de cada CLI, en sus carpetas de siempre. Lo que guarda Mage vive en su carpeta de
datos: `%APPDATA%\Mage` en Windows, `~/Library/Application Support/Mage` en macOS y `~/.config/Mage` en Linux.
Ahí están los ajustes (`app-settings.json`), el índice de conversaciones (`conversation-index.json`), el texto
de los pensamientos que el CLI no guarda (`thinking/`), el estado de los rebobinados (`rewind-state.json`), las
tareas programadas (`tasks/`), el registro de consumo por API (`api-usage.json`) y la bóveda cifrada de claves
(`secrets.json`). Nada de eso sale de tu máquina.
