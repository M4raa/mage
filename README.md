<div align="center">

<img src="resources/brand/icon-256.png" alt="Mage" width="112">

# Mage

**Un escritorio para agentes de código.** Varios agentes a la vez, varias cuentas,
y el control de lo que cada uno toca antes de que lo toque.

[![check](https://github.com/M4raa/mage/actions/workflows/check.yml/badge.svg)](https://github.com/M4raa/mage/actions/workflows/check.yml)
[![versión](https://img.shields.io/badge/versión-0.1.2--beta-blue)](https://github.com/M4raa/mage/releases)
[![licencia](https://img.shields.io/badge/licencia-MIT-green)](LICENSE)
[![plataforma](https://img.shields.io/badge/instalador-Windows%20x64-0078D4)](https://github.com/M4raa/mage/releases)
[![linux y macos](https://img.shields.io/badge/Linux%20y%20macOS-pr%C3%B3ximamente-lightgrey)](#macos-y-linux--pr%C3%B3ximamente)

[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-22+-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

[Instalar](#instalar) · [Qué necesitas](#qué-tienes-que-poner-tú) · [Cómo funciona](#cómo-funciona-por-dentro) · [Desarrollo](#desarrollo) · [Contribuir](CONTRIBUTING.md)

</div>

---

## TL;DR

Instalas el CLI de tu agente (Claude Code, Codex o Antigravity `agy`), inicias sesión con tu
suscripción, y Mage te da una ventana decente para usarlo: varias conversaciones abiertas en paneles
divisibles, varias cuentas con su consumo a la vista, y un diálogo que te enseña cada comando o edición
**antes** de que ocurra para que decidas.

Mage **no** es un agente y **no** tiene modelo propio: lanza el binario real del CLI que ya tienes
instalado, en modo headless, y le pone cara. Cada cuenta consume tu suscripción, igual que si lo
ejecutaras en la terminal, o la clave de API que tú des de alta en esa cuenta. Para los modelos que
no tienen CLI (un endpoint compatible con OpenAI, como Ollama o LM Studio) Mage trae un bucle de
agente propio.

Windows x64 hoy. El instalador no está firmado todavía. MIT.

---

## Qué problema resuelve

El CLI de un agente de código es excelente y vive en una terminal. Eso significa una conversación cada
vez, sin historial navegable, sin ver qué cuenta estás gastando, y con los permisos resueltos a base
de `y/n` sobre un comando que apenas cabe en la línea.

Mage no sustituye nada de eso: lo envuelve.

| En la terminal | En Mage |
|---|---|
| Una conversación por ventana | Varias, en pestañas y paneles divisibles, cada una en su carpeta |
| `y/n` a ciegas | El comando, el fichero o el diff completo delante, y tú decides |
| ¿Cuánto llevo gastado? | Uso y límites de cada cuenta, con su ventana de renovación |
| Una cuenta por máquina | Varias cuentas, de suscripción o de API, cambiando entre ellas sin volver a loguearte |
| Cada CLI guarda su historial a su manera | El de Claude, Codex y agy en la misma barra lateral, buscable y reabrible, y una conversación se puede **migrar** a otro proveedor |
| El historial es *scrollback* | Transcripciones indexadas, buscables y reabribles |
| — | Panel de ficheros, temas importables de Open VSX, atajos reasignables |

---

## Instalar

> [!IMPORTANT]
> **Mage no trae el agente dentro.** Antes de abrirlo necesitas el CLI de al menos un agente (Claude
> Code, Codex o `agy`) instalado y con sesión iniciada. Lee [Qué tienes que poner tú](#qué-tienes-que-poner-tú) — sin eso la app arranca,
> pero no podrás abrir una conversación.

1. Descarga `mage-setup-beta-<versión>.exe` de la sección de **[releases](https://github.com/M4raa/mage/releases)**. Hay también un `.msi`, para desplegar
   por política de grupo o con `msiexec /qn`; para instalarlo tú, el que quieres es el `.exe`.
2. Ejecútalo. Se instala **por usuario**, sin permisos de administrador.
3. Al primer arranque sale un asistente de tres pasos: comprueba el motor, eliges tema y escala, y te
   enseña los atajos.

> [!WARNING]
> **El instalador no está firmado todavía.** Windows enseñará la pantalla azul de SmartScreen:
> *Más información* → *Ejecutar de todas formas*. La firma está en camino vía
> [SignPath Foundation](https://signpath.org/), que exige que el proyecto ya esté publicado; mientras llega,
> la beta sale sin ella.

### macOS y Linux — próximamente

El código es multiplataforma desde el primer día: no hay una sola ruta ni comando específico de un
sistema fuera de la capa de SO. Lo que falta no es código, es **haberlo construido y visto arrancar**
en esas dos máquinas, y de eso no se publica un instalador.

La configuración de empaquetado ya está escrita —`AppImage`, `.deb` y `.rpm` para Linux x64; `.dmg`
para macOS Intel y Apple Silicon— y los jobs de CI están preparados y desactivados. Mientras tanto,
desde el código:

```bash
pnpm install && pnpm dist:linux   # o: pnpm dist:mac
```

**Si lo levantas ahí, cuéntalo en una issue**: un informe de que arranca (o de que no) es lo único que
falta para activar esos dos instaladores.

### Qué tienes que poner tú

Mage es la interfaz; el agente es un proceso aparte que lanza por ti.

- **El CLI de al menos un agente**, instalado y con sesión iniciada. El de Claude Code:

  ```bash
  npm i -g @anthropic-ai/claude-code
  claude auth login      # elige la opción de suscripción, no la de API
  ```

  Codex y `agy` se instalan con sus propias instrucciones. Mage localiza cada binario solo (y si no lo
  encuentra, te lo dice). No los instala por ti; las cuentas de cada uno se dan de alta desde Mage, que
  abre el inicio de sesión del propio CLI y nunca ve tu contraseña ni tu token.

- **Tu propia suscripción** (o clave de API) de cada proveedor. El uso se factura a tu cuenta, bajo tus
  términos con el fabricante. Mage no revende acceso ni incluye ninguno.

> [!TIP]
> ¿Ya tienes varias cuentas en la misma máquina? Es justo el caso para el que se escribió el
> gestor de cuentas: Mage aísla las credenciales de cada una y cambias de una a otra sin repetir el
> login.

### Instrucciones del proyecto para todos los agentes

Cada CLI lee su propio fichero: Claude Code, `CLAUDE.md`; Codex, `AGENTS.md`; `agy`, `GEMINI.md` o
`AGENTS.md`. Para escribirlas una sola vez, la convención que recomendamos es:

- **`AGENTS.md`** con las instrucciones de verdad.
- **`CLAUDE.md`** con una sola línea, `@AGENTS.md`, para que Claude Code importe el mismo fichero.

Si tu proyecto solo tiene `CLAUDE.md`, Mage hace de puente: en cada conversación se lo da a Codex como
su `AGENTS.md` y a `agy` como su `GEMINI.md`, junto con tu `~/.claude/CLAUDE.md` global, **sin escribir
nada en tu repositorio**. Si el proyecto ya tiene el fichero propio de ese CLI, se usa el suyo y Mage
no añade nada. El Inspector › Instrucciones de la conversación dice qué está recibiendo.

---

## Qué trae

- **Varias conversaciones a la vez.** Pestañas por panel, y paneles que se dividen en horizontal y
  vertical. Cada conversación en su directorio de trabajo.
- **Permisos delante.** Cuando el agente quiere ejecutar algo o escribir un fichero, lo ves antes:
  el comando entero, el diff, la ruta. Apruebas, rechazas o lo dejas recordado.
- **Multicuenta.** Varias cuentas de Claude, Codex y `agy` conviviendo, cada una por suscripción o por
  clave de API (la pestaña dice «Factura API»), con su uso, sus límites y su ventana de renovación a la
  vista.
- **Análisis de uso y transcripciones.** Qué se ha gastado, en qué, y el historial completo indexado
  y reabrible, con los mismos tokens y el mismo panel de contexto en los tres proveedores.
- **Multi-proveedor.** El núcleo es agnóstico: el CLI real de Claude Code, el de Codex y el de `agy`, y
  un runtime propio para endpoints compatibles con OpenAI (Ollama, LM Studio…). Una conversación se
  puede **migrar** de un proveedor a otro sin empezar de cero.
- **MCP compartidos.** Los servidores MCP, los conectores por cuenta y las extensiones `.mcpb` se
  gestionan en un sitio y los cargan los proveedores que elijas.
- **Avisos.** Notificaciones propias (campana en la cabecera) de lo que pasa en las conversaciones que
  no estás viendo, y una pestaña de novedades al actualizar.
- **Tuyo.** Temas importables de Open VSX, escala de interfaz del 80 % al 150 %, atajos reasignables,
  paneles acoplables.

---

## Cómo funciona por dentro

```
┌─────────────────────────────────────────────────────────┐
│  renderer  ·  React + Zustand + Tailwind                │
│  pestañas, chat, paneles, ajustes                       │
└───────────────────────┬─────────────────────────────────┘
                        │  preload: contextBridge tipado
                        │  (el renderer NO ve Node)
┌───────────────────────┴─────────────────────────────────┐
│  main  ·  orquestación                                  │
│  cuentas · credenciales · uso · transcripciones         │
│                                                         │
│      ProviderAdapter ── un modelo de eventos común      │
│        ├── claude  → CLI real, stream-json              │
│        ├── codex   → CLI real, app-server (JSON-RPC)    │
│        ├── agy     → CLI real, stream-json              │
│        └── runtime propio → endpoints OpenAI-compatibles│
└───────────────────────┬─────────────────────────────────┘
                        │  spawn + NDJSON / JSON-RPC por stdio
                  ┌─────┴──────┐
                  │ claude -p  │   proceso real del CLI
                  │ codex · agy│   (uno por conversación)
                  └────────────┘
```

Cada agente es un **proceso real del CLI** en headless: `claude` y `agy` hablan `stream-json` y `codex`
su `app-server` (JSON-RPC), siempre validado con esquemas Zod en la frontera. Los modelos sin CLI
corren en el runtime propio de Mage, que habla Chat Completions y emite los mismos eventos. El entorno
del hijo se limpia de toda variable de credencial antes de lanzarlo.

> [!NOTE]
> Mage **no** usa el Agent SDK. El SDK factura contra la API; el CLI consume tu suscripción por OAuth.
> Esa decisión es un invariante del proyecto, no una preferencia.

Dos abstracciones no se saltan nunca: **`ProviderAdapter`** (cada proveedor detrás del mismo modelo de
eventos) y la capa de SO (`LinkService`, `OpenWithService`, los resolutores de binario). Ninguna ruta
ni comando específico de un sistema vive fuera de ahí — es lo que hace que el mismo código valga para
los tres.

---

## Desarrollo

```bash
pnpm install
pnpm dev
```

**Node 22+** y **pnpm 11+** (fijado en `packageManager`). Hace falta el CLI de al menos un agente igual que
para usarla.

> [!CAUTION]
> Si tienes la versión instalada de Mage abierta, **ciérrala antes** — incluido el icono de la
> bandeja. Comparten perfil de usuario y bloqueo de instancia única, y la de desarrollo se cerrará
> sola. Alternativa: `pnpm dev` con un `--user-data-dir` propio.

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Arranca en desarrollo. HMR en el renderer; **`main` necesita reinicio completo** |
| `pnpm check` | Typecheck (main + renderer) y tests. La puerta mínima antes de commitear |
| `pnpm build` | Compila los tres targets. Atrapa fallos de bundle que el typecheck no ve |
| `pnpm test` · `pnpm test:coverage` | Tests (Vitest) y su informe de cobertura |
| `pnpm verify:gui` | Arranca la app real con perfil aislado y mide el DOM por CDP. Informe y capturas en `.verify-out/` |
| `pnpm dist:win` · `dist:mac` · `dist:linux` | Empaqueta con electron-builder (instalador en `release/`) |
| `pnpm smoke:packaged` | Arranca el **.exe empaquetado** y comprueba que monta. Un `build` verde no prueba esto |
| `pnpm shots` | Regenera las capturas del README con un HOME falso y datos inventados |
| `pnpm clean` | Borra artefactos y poda las ejecuciones viejas del harness |

### Dónde está cada cosa

| Ruta | Qué vive ahí |
|---|---|
| `src/main` | Orquestación: procesos del CLI, parseo NDJSON, cuentas, credenciales, uso. Todo lo que toca el SO o la red |
| `src/preload` | El único puente. `contextBridge` con API tipada |
| `src/renderer` | React + Zustand + Tailwind |
| `src/shared` | El contrato entre main y renderer, con sus esquemas Zod |
| `spike/` | Spikes reproducibles contra los CLI reales. Un CLI nuevo **se mide**, no se deduce de su `--help` |

### Documentación

| Documento | Para qué |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | **Empieza aquí.** Invariantes que no se rompen y estándares de código |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Cómo levantar el proyecto y qué se espera de un PR |
| [`SECURITY.md`](SECURITY.md) | Qué toca Mage de tu máquina, y cómo avisar de un fallo en privado |
| [`.claude/skills/`](.claude/skills/) | Tres trampas que este proyecto ya pagó: el protocolo real del CLI, qué hace falta al tocar `main`, y cómo se verifica la interfaz |

---

## Contribuir

Issues y PR son bienvenidos. [`CONTRIBUTING.md`](CONTRIBUTING.md) explica cómo levantar el proyecto,
qué se espera de un cambio y los invariantes que no se rompen.

Dentro de la app hay un botón de informar de fallos en la barra de título: abre el formulario de issue
con la versión y el sistema operativo ya rellenos.

> [!WARNING]
> Si encuentras un fallo de **seguridad**, no abras una issue pública: [`SECURITY.md`](SECURITY.md)
> explica cómo avisar en privado.

---

## Avisos

**Mage no está afiliada a Anthropic, OpenAI ni Google.** Ejecuta los CLI que instales tú, con tus
cuentas. «Claude» y «Claude Code» son marcas de Anthropic; «Codex» y «OpenAI», de OpenAI; «Gemini» y
«Antigravity», de Google.

**Mage ejecuta comandos en tu máquina**, porque eso es lo que hace un agente de código. Por eso los
permisos van delante y no detrás. Lee [`SECURITY.md`](SECURITY.md) para saber qué toca exactamente.

---

## Licencia

**MIT** — ver [`LICENSE`](LICENSE). Úsalo, cópialo, modifícalo y redistribúyelo conservando el aviso
de copyright.

El **nombre «Mage» y el arte de marca** (`resources/brand/`, `design/`) **no** entran en esa licencia:
una licencia de software no cede marcas. Haz el fork que quieras; ponle otro nombre y otro icono.

Las dependencias son también software libre y conservan las suyas. El texto completo, con el aviso de
copyright de cada paquete, viaja en [`THIRD-PARTY-NOTICES.txt`](THIRD-PARTY-NOTICES.txt) —generado con
`pnpm notices`— y se consulta desde la propia app en **Configuración → Acerca de Mage**.
