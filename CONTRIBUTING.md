# Contribuir a Mage

Gracias por mirar. Esto explica cómo levantar el proyecto, qué se espera de un cambio y qué cosas
tienen una razón detrás que no se ve a simple vista.

El proyecto se escribe en **castellano en los comentarios y en inglés en los identificadores**. Las
issues y los PR puedes escribirlos en castellano o en inglés, lo que te resulte natural.

## Levantar el proyecto

```bash
pnpm install
pnpm dev          # la app, con recarga en caliente
pnpm check        # typecheck (node + web) + lint + tests + avisos de terceros al día
pnpm build        # además atrapa fallos de bundle que el typecheck no ve
```

Necesitas **Node 22+**, **pnpm 11+** y, para usarla de verdad, el CLI de Claude Code instalado y con
sesión iniciada. Mage no trae el agente dentro: lanza el que tengas tú.

## Antes de abrir un PR

1. **`pnpm check` en verde.** Incluye `pnpm notices:check`: si tocas dependencias, regenera los avisos
   de terceros con `pnpm notices` y commitea el resultado — publicar binarios con ese fichero
   desfasado incumple las licencias de las dependencias.
2. **Si el cambio se ve, `pnpm verify:gui`.** Arranca la app real con un perfil aislado y mide el DOM
   por CDP. No escribas un driver de usar y tirar: **añade una comprobación al harness**. Nunca pulsa
   `Enter` en el prompt, porque eso dispararía un turno real contra tu suscripción.
3. **Deja una prueba que falle si tu lógica se rompe.** La lógica de negocio vive en módulos puros
   (parser, cálculo de uso, `AccountService`, los adapters) justo para que se pueda probar sin FS, sin
   red y sin procesos.

## Cómo está escrito esto

Lee [`CLAUDE.md`](CLAUDE.md) antes de un cambio grande: es la guía corta del proyecto, con los
invariantes que no se rompen. Los tres que más gente pisa:

- **El motor es el CLI real** en modo headless `stream-json`, consumiendo la suscripción del usuario
  por OAuth. **No se usa el Agent SDK**, que factura por API.
- **Multiplataforma de verdad.** Nada de rutas ni comandos por sistema fuera de las abstracciones que
  ya existen (`LinkService`, `OpenWithService`, los resolutores de binario). `path.join`, `os.homedir()`.
- **Nunca se loguea ni se emite una credencial.** Ni tokens, ni `oauthAccount`, ni identificadores de
  máquina.

Y las skills de [`.claude/skills/`](.claude/skills/) ahorran tiempo: recogen, con su causa raíz
medida, errores que este proyecto ya pagó — el protocolo real del CLI, qué hace falta al tocar el
proceso `main`, y cómo se verifica la interfaz sin fiarse del ojo.

## Estilo

Lo esencial: funciones cortas con una responsabilidad, precondiciones al principio y salida temprana,
dependencias inyectadas por parámetros (no instanciadas dentro), `===`, sin números mágicos, y parseo
validado en la frontera —lo que entra del CLI pasa por esquemas Zod—. Nada de `catch` que silencia un
error: si algo falla, el mensaje lleva el valor que recibió.

## Issues

- **Fallos**: cuenta qué esperabas, qué pasó, y tu sistema operativo y versión de Mage (están en
  Configuración → Acerca de Mage). Si hay un error en pantalla, cópialo entero.
- **Ideas**: di el problema que tienes, no solo la solución que imaginas. La mitad de las buenas
  decisiones de este proyecto salieron de entender el problema de otra manera.
- **Seguridad**: no abras una issue. Ver [`SECURITY.md`](SECURITY.md).

## Lo que probablemente no entre

- Reimplementar el agente, o llamar a la API de pago en vez de lanzar el CLI.
- Código específico de un sistema operativo fuera de su abstracción.
- Telemetría de cualquier clase. Mage no tiene servidor propio ni lo va a tener.
