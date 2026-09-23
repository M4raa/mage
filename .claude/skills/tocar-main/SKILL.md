---
name: tocar-main
description: Qué hacer al modificar código del proceso `main` de Mage (src/main/**) y al cambiar catálogos persistidos (panelRegistry, keybindings, settings). Evita el "residuo de máquina" que ha costado tiempo dos veces.
---

# Tocar `main` (o un catálogo persistido)

Dos reglas que este proyecto ha re-descubierto por las malas. Ninguna es opinión: las dos están
medidas y registradas en la bitacora del proyecto.

## 1. Cambiar `src/main/**` → reinicio COMPLETO de `pnpm dev`

El HMR de electron-vite recarga el **renderer**, no el proceso `main`. Si tocas `src/main/**`
(IPC, stores, motor, ventanas) y solo recargas, estás probando el `main` VIEJO contra el renderer
nuevo. Los síntomas son desconcertantes: un canal IPC que "no existe", un handler que ignora un
parámetro nuevo, un store que no persiste.

```bash
# Matar el dev por completo (no basta con recargar la ventana) y relanzar:
pnpm dev
```

Está anotado en cinco entradas distintas del ROADMAP ("Toca `main` → reinicio COMPLETO de
`pnpm dev`"). Si lo estás dudando, reinicia: cuesta 5 segundos.

## 2. Reordenar un catálogo persistido → borra su fichero de estado UNA vez

Los catálogos del renderer se **reconcilian** contra un fichero persistido en `userData`. Reconciliar
resuelve ids que desaparecen, pero **no** reasigna lo que ya estaba colocado. Si cambias el
`defaultAnchor`/`defaultZone` de un panel que YA existía, el fichero viejo gana y ves el layout
antiguo — o peor, iconos **duplicados**.

| Cambias… | Borra una vez |
|---|---|
| `defaultZone`/`defaultAnchor` en `src/renderer/src/workbench/panels/panelRegistry.ts` | `%APPDATA%/Mage/panels-layout.json` |
| Estructura de `workspace-state.json` | `%APPDATA%/Mage/workspace-state.json` |
| Forma de `AppSettings` sin `.catch()` tolerante | `%APPDATA%/Mage/app-settings.json` |

En macOS/Linux es `~/Library/Application Support/Mage/` y `~/.config/Mage/`.

**No es automatizable y no es un bug**: reconciliar sin pisar es lo correcto para el usuario que ya
tiene su layout colocado a mano. Lo que hay que hacer es **avisarlo en el commit**, porque cualquiera
con el fichero viejo verá lo mismo. Pasó dos veces: la primera se documentó como riesgo… y volvió a
pasar en la sesión siguiente.

## Antes de dar algo por terminado

`pnpm check` (typecheck node+web + tests) **y** `pnpm build`. El build atrapa cosas que el typecheck
no: entradas nuevas, imports que no resuelven en el bundle, ficheros que el asar necesita.

## 3. «El dev no aplica mis cambios» → mira si tienes la app INSTALADA abierta

Mage tiene **instancia única** (grupo G) y la versión de desarrollo comparte `userData` con la
instalada (`%APPDATA%\mage`, y Windows no distingue mayúsculas). Así que si tienes abierto el Mage
instalado —o sigue vivo en el **tray**—, `pnpm dev` arranca Electron, **pierde el lock, se cierra**, y
lo único que ves es la ventana de la instancia vieja saltando al frente. Parece que el dev ignora tus
cambios; lo que pasa es que el dev **no está corriendo**.

Medido (2026-08-18): con la instalada abierta, tras 30 s hay **0** procesos `electron.exe` y un
`Mage.exe` más (el renderer que la instancia vieja recrea al recibir `second-instance`). Con
`--user-data-dir` propio, **4** procesos `electron.exe`: arranca perfectamente.

```bash
# Opción A (la normal): cerrar la instalada del todo, TRAY INCLUIDO, y entonces:
pnpm dev

# Opción B: dev con perfil propio (no ves tus pestañas ni tu config, pero nunca colisiona):
pnpm dev -- --user-data-dir="$TEMP/mage-dev"
```

Desde esta sesión, la segunda instancia lo **dice** por stderr antes de cerrarse (`[mage] Ya hay otra
instancia…`). Si ves esa línea en la salida de `pnpm dev`, es esto.
