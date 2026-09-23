<div align="center">

<img src="resources/brand/icon-256.png" alt="Mage" width="112">

# Mage

**Un escritorio para agentes de código.** Varios agentes a la vez, varias cuentas,
y el control de lo que cada uno toca antes de que lo toque.

[![check](https://github.com/M4raa/mage/actions/workflows/check.yml/badge.svg)](https://github.com/M4raa/mage/actions/workflows/check.yml)
[![versión](https://img.shields.io/badge/versión-0.1.0--beta-blue)](https://github.com/M4raa/mage/releases)
[![licencia](https://img.shields.io/badge/licencia-MIT-green)](LICENSE)
[![plataforma](https://img.shields.io/badge/instalador-Windows%20x64-0078D4)](https://github.com/M4raa/mage/releases)

[![Electron](https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-22+-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

[Instalar](#instalar) · [Qué necesitas](#qué-tienes-que-poner-tú) · [Cómo funciona](#cómo-funciona-por-dentro) · [Desarrollo](#desarrollo) · [Contribuir](CONTRIBUTING.md)

</div>

---

## TL;DR

Instalas el CLI de Claude Code, inicias sesión con tu suscripción, y Mage te da una ventana decente
para usarlo: varias conversaciones abiertas en paneles divisibles, varias cuentas con su consumo a la
vista, y un diálogo que te enseña cada comando o edición **antes** de que ocurra para que decidas.

Mage **no** es un agente y **no** tiene modelo propio: lanza el binario real del CLI que ya tienes
instalado, en modo headless, y le pone cara. Nada se factura a ninguna API — consume tu suscripción,
igual que si lo ejecutaras en la terminal.

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
| Una cuenta por máquina | Varias cuentas, cambiando entre ellas sin volver a loguearte |
| El historial es *scrollback* | Transcripciones indexadas, buscables y reabribles |
| — | Panel de ficheros, temas importables de Open VSX, atajos reasignables |

---

## Instalar

> [!IMPORTANT]
> **Mage no trae el agente dentro.** Antes de abrirlo necesitas el CLI de Claude Code instalado y con
> sesión iniciada. Lee [Qué tienes que poner tú](#qué-tienes-que-poner-tú) — sin eso la app arranca,
> pero no podrás abrir una conversación.

1. Descarga `Mage-<versión>-win-x64-setup.exe` de la sección de **[releases](https://github.com/M4raa/mage/releases)**.
2. Ejecútalo. Se instala **por usuario**, sin permisos de administrador.
3. Al primer arranque sale un asistente de tres pasos: comprueba el motor, eliges tema y escala, y te
   enseña los atajos.

> [!WARNING]
> **El instalador no está firmado todavía.** Windows enseñará la pantalla azul de SmartScreen:
> *Más información* → *Ejecutar de todas formas*. La firma está en camino vía
> [SignPath Foundation](https://signpath.org/), que exige que el proyecto ya esté publicado — por eso esta
> primera beta sale sin ella.

<details>
<summary><b>macOS y Linux</b></summary>

El código es multiplataforma desde el primer día y no hay una sola ruta ni comando específico de un
sistema fuera de la capa de SO. Pero **nunca se ha construido ni probado** en esos dos: hay
configuración de empaquetado (`pnpm dist:mac`, `pnpm dist:linux`) y no hay instaladores publicados.
Si lo levantas ahí desde el código, cuéntalo en una issue.

</details>

### Qué tienes que poner tú

Mage es la interfaz; el agente es un proceso aparte que lanza por ti.

- **El CLI de Claude Code**, instalado y con sesión iniciada:

  ```bash
  npm i -g @anthropic-ai/claude-code
  claude auth login      # elige la opción de suscripción, no la de API
  ```

  Mage lo localiza solo (y si no lo encuentra, te da el comando). No lo instala ni te loguea por ti.

- **Tu propia suscripción de Claude.** El uso se factura a tu cuenta, bajo tus términos con Anthropic.
  Mage no revende acceso ni incluye ninguno.

> [!TIP]
> ¿Ya tienes varias cuentas de Claude en la misma máquina? Es justo el caso para el que se escribió el
> gestor de cuentas: Mage aísla las credenciales de cada una y cambias de una a otra sin repetir el
> login.

---

## Qué trae

- **Varias conversaciones a la vez.** Pestañas por panel, y paneles que se dividen en horizontal y
  vertical. Cada conversación en su directorio de trabajo.
- **Permisos delante.** Cuando el agente quiere ejecutar algo o escribir un fichero, lo ves antes:
  el comando entero, el diff, la ruta. Apruebas, rechazas o lo dejas recordado.
- **Multicuenta.** Varias cuentas de Claude conviviendo, con su uso, sus límites y su ventana de
  renovación a la vista.
- **Análisis de uso y transcripciones.** Qué se ha gastado, en qué, y el historial completo indexado
  y reabrible.
- **Multi-proveedor.** El núcleo es agnóstico: además del CLI de Claude Code hay soporte para `agy` y
  para proveedores compatibles con OpenAI a través de una pasarela local.
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
│        ├── claude    → CLI real, stream-json, OAuth     │
│        ├── agy       → CLI real                         │
│        └── gateway   → proxy local OpenAI-compatible    │
└───────────────────────┬─────────────────────────────────┘
                        │  spawn + NDJSON por stdio
                  ┌─────┴──────┐
                  │  claude -p │   proceso real del CLI
                  └────────────┘
```

Cada agente es un **proceso real del CLI** en headless (`--input-format stream-json
--output-format stream-json`), hablando NDJSON validado con esquemas Zod en la frontera. El entorno
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

**Node 22+** y **pnpm 11+** (fijado en `packageManager`). Hace falta el CLI de Claude Code igual que
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

**Mage no está afiliada a Anthropic.** Ejecuta el CLI de Claude Code que instales tú, con tu cuenta.
«Claude» y «Claude Code» son marcas de Anthropic.

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
