---
name: protocolo-cli
description: Cómo averiguar de qué es capaz un CLI de agente (claude, agy, codex…) antes de escribir un adapter. Mide el binario real; ni el --help ni la documentación publicada son fiables. Este proyecto se ha equivocado por creerse a los dos.
---

# Medir el protocolo de un CLI antes de programar contra él

Regla del proyecto: **el binario real manda**. Se ha incumplido dos veces y las dos costaron trabajo.

## Los dos precedentes, para que no haya tentación

1. **La documentación de segunda mano miente por antigüedad.** Describe otra versión: la respuesta
   real del CLI 2.1.220 traía campos que no figuraban en ella. Sirve como **spec** del protocolo, nunca
   como verdad sobre la versión instalada.
2. **`--help` miente por omisión.** La nota del 2026-07-15 descartó `agy` como motor porque *"no expone
   ningún protocolo de salida estructurada"*. Era falso: tenía `--output-format json|stream-json`, solo
   que no aparecía en `--help`. Se dio por bueno lo que decía la ayuda sin sondear el binario.

## El oráculo de flags ocultos (gratis, no gasta peticiones)

Para CLIs escritos en Go (`agy`) y muchos otros, lanzar un flag suelto distingue tres casos:

| Respuesta | Significa |
|---|---|
| `flags provided but not defined: -foo` | el flag **no existe** |
| `flag needs an argument: -foo` | el flag **existe** (aunque no salga en `--help`) |
| otra cosa | indeterminado: hay que ejecutarlo |

Automatizado en `spike/agy-spike.mjs`. Cópialo para cualquier CLI nuevo antes de dar nada por
descartado.

## Qué hay que medir SIEMPRE, y en este orden

1. **Versión exacta** del binario, y anótala en el hallazgo. `agy` se auto-actualizó **nueve versiones
   de parche a mitad de un spike**, documentando flags que antes ocultaba. Un hallazgo sin versión no
   es reproducible.
2. **Salida estructurada**: ¿hay NDJSON/JSON? ¿qué eventos? ¿trae `usage` real?
3. **Entrada**: ¿acepta stdin estructurado (`--input-format`) o es un proceso por turno?
4. **Permisos** ← *el decisivo para Mage*. ¿Se pueden delegar en la app
   (`--permission-prompt-tool`) o solo hay auto-aprobar todo? Sin puente de permisos no se puede
   cumplir la **decisión nº 2** del proyecto (diálogos propios).
5. **Multi-turno**: ¿hay `--resume`/`--conversation`? ¿conserva contexto? ¿cachea?
6. **Directorio de trabajo**: ¿respeta el `cwd`? `agy` **no**: sin `--add-dir` escribe en su propio
   scratch aunque reporte el cwd correcto en su evento `init`. Comprueba siempre dónde acaba un
   fichero escrito, no dónde dice que lo escribió.

## Invariantes que no se negocian al añadir un proveedor

- **Suscripción, no API**: `ANTHROPIC_API_KEY` fuera del proceso hijo. Un adapter que factura API
  contradice el invariante nº 1 aunque funcione.
- **Nunca loguear** credenciales, tokens, `oauthAccount`, `userID`, `machineID`.
- **Multiplataforma**: sin rutas ni comandos hardcodeados por SO.

## Deja el spike en el repo

Como `spike/engine-spike.mjs` y `spike/agy-spike.mjs`: no es código de producción, es la prueba
reproducible de que el contrato es el que dices. Con CLIs que se mueven semanalmente, un script que
re-mide en segundos vale mucho más que un párrafo afirmando lo que se midió una vez.
