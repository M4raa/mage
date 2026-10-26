# Llavero para las cuentas de API en Linux

Las cuentas de API requieren un llavero seguro. Las cuentas de suscripción usan las credenciales de
su CLI y no requieren la bóveda de Mage. Mage nunca instala paquetes del sistema ni ejecuta sudo;
los siguientes comandos los ejecuta el usuario.

Esta guía recoge el requisito y el diagnóstico de Linux de 0.1.3. Las mediciones se hicieron en WSL
Ubuntu 26.04, Debian 13 y Arch sin escritorio. Ubuntu 24.04 no se ha probado.

## Instalar los componentes

Ubuntu/Debian:

```sh
sudo apt update
sudo apt install gnome-keyring libsecret-tools dbus-daemon
```

Arch:

```sh
sudo pacman -S --needed gnome-keyring libsecret dbus
```

## Arrancar y desbloquear sin escritorio

Si no existe un bus de sesión, abre primero una shell dentro de uno:

```sh
dbus-run-session -- bash
```

En esa misma shell, arranca/desbloquea el llavero introduciendo su contraseña por stdin. No pongas la
contraseña en los argumentos del proceso ni en un fichero:

```bash
read -r -s -p 'Contraseña del llavero: ' keyring_password
printf '\n'
printf '%s' "$keyring_password" | gnome-keyring-daemon --unlock --components=secrets
unset keyring_password
```

Si el daemon ya se había iniciado sin una colección por defecto, sal de esa sesión desechable y
vuelve a iniciarla: el primer arranque con `--unlock` debe recibir la contraseña. No borres un llavero
existente para resolver un error. En una sesión existente con una colección bloqueada, `--unlock`
debe usar la contraseña de esa colección.

Arranca Mage desde la misma shell para que herede el bus. En Linux sin DISPLAY/WAYLAND_DISPLAY, Mage pide
el Secret Service (`--password-store=gnome-libsecret`) si no le has indicado otro: sin él, Chromium usa
`basic_text` aunque el llavero esté desbloqueado y la bóveda no se podría usar. Con escritorio, Chromium
elige como siempre (por ejemplo, KWallet en KDE).

## Diagnóstico

- **Ausente:** no está instalado el proveedor de llavero; mostrar el comando de la distribución.
- **No arrancado:** hay proveedor instalado, pero no hay bus o no tiene propietario
  `org.freedesktop.secrets`; mostrar cómo iniciar el bus/daemon en la shell de Mage.
- **Bloqueado:** el servicio existe y la colección por defecto declara `Locked=true`; mostrar cómo
  desbloquearla por stdin. No depender de un diálogo gráfico.
- **Sin colección / fallo / tiempo agotado:** explicarlo como tal; no confundirlo con ausencia del
  paquete. Un backend identificado como `gnome_libsecret` no demuestra que el cifrado esté disponible.

Mage lo comprueba una vez al arrancar, antes de admitir sesiones, con `dbus-send` y sin activar
servicios: un máximo total de 3 segundos y 500 ms por consulta D-Bus. Si el llavero está desbloqueado,
comprueba además la disponibilidad del cifrado y un round trip con texto sintético. En las tres distribuciones,
las llamadas en frío medidas con llavero bloqueado o sin arrancar respondieron en menos de 100 ms,
con error y sin bloquearse. No se prevé construir un supervisor externo de arranque; queda como
contingencia solo si una medición futura demuestra un bloqueo real de safeStorage síncrono.
Un propietario arrancado sin bóveda no intenta inicializarla en segundo plano: habilitarla requiere
cerrar y reabrir explícitamente después de desbloquear el llavero. Nunca se reinicia un propietario
que ya sirve sesiones.

Mientras no haya backend seguro y cifrado disponible, crear o usar una cuenta de API falla con:

> No se puede crear ni usar esta cuenta de API: el llavero seguro de Linux está {estado}. Las cuentas
> de suscripción siguen disponibles. Sigue las instrucciones de instalación, arranque y desbloqueo
> del llavero para tu distribución; después cierra y vuelve a abrir Mage para habilitar la bóveda.

El error incluye el enlace a esta guía y los comandos de la distribución detectada mediante
`/etc/os-release` (ID/ID_LIKE). Una distribución desconocida se declara como tal, sin inventar un
comando. Nunca usar `basic_text`, `unknown`, `setUsePlainTextEncryption` ni otra alternativa en claro.

Un host iniciado sin pantalla no puede abrir luego la GUI. Hay que cerrar y reabrir con pantalla por
decisión explícita del usuario; solicitar la GUI no mata sesiones ni reinicia el host.
