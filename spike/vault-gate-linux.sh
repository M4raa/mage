#!/usr/bin/env bash
# F2.7 (D1): la comprobación de la bóveda en Linux sin escritorio, en cuatro estados del llavero. Ejecutar como root
# solo para preparar y cambiar de UID: Electron corre siempre sin privilegios, sin --no-sandbox y sin DISPLAY.
# Bus, HOME, XDG, perfil y llavero son desechables, con contraseña y texto sintéticos.
#
#   MAGE_VG_ELECTRON_DIST=<dist de Electron 44 para Linux> MAGE_VG_BUNDLE=<vault-gate-bundle.cjs> bash spike/vault-gate-linux.sh
set -euo pipefail
ulimit -c 0
source_dist=${MAGE_VG_ELECTRON_DIST:?Falta MAGE_VG_ELECTRON_DIST}
bundle=${MAGE_VG_BUNDLE:?Falta MAGE_VG_BUNDLE}
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
root=$(mktemp -d /tmp/mage-vault-gate-run-XXXXXX)
cleanup() {
  case "$root" in /tmp/mage-vault-gate-run-*) rm -rf -- "$root";; *) exit 70;; esac
  if test -e "$root"; then echo "CLEANUP_FAILED=$root"; return 71; fi
  echo "CLEANUP_ABSENT=$root"
}
trap cleanup EXIT
chmod 755 "$root"
cp -a "$source_dist" "$root/electron"
cp "$source_dir/vault-gate-probe.cjs" "$root/probe.cjs"
cp "$bundle" "$root/bundle.cjs"
chmod 644 "$root"/*.cjs
if getent passwd 1000 >/dev/null; then account=$(getent passwd 1000 | cut -d: -f1); else account=nobody; fi
echo "DISTRO=$WSL_DISTRO_NAME"
grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release
gnome-keyring-daemon --version || echo 'gnome-keyring-daemon ausente'

cat > "$root/inner.sh" <<'INNER'
set -euo pipefail
bus() { dbus-send --session --print-reply --reply-timeout=1500 "$@"; }
if test "$STATE" = unlocked || test "$STATE" = locked; then
  printf '%s' 'mage-vault-gate-desechable' | gnome-keyring-daemon --unlock --components=secrets \
    --control-directory="$XDG_RUNTIME_DIR/keyring" >/dev/null
  for _ in $(seq 1 30); do bus --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.NameHasOwner string:org.freedesktop.secrets | grep -q 'boolean true' && break; sleep 0.1; done
fi
if test "$STATE" = locked; then
  collection=$(bus --dest=org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service.ReadAlias string:default | sed -n 's/.*object path "\(.*\)".*/\1/p')
  bus --dest=org.freedesktop.secrets /org/freedesktop/secrets org.freedesktop.Secret.Service.Lock "array:objpath:$collection" >/dev/null
  bus --dest=org.freedesktop.secrets "$collection" org.freedesktop.DBus.Properties.Get string:org.freedesktop.Secret.Collection string:Locked | grep -q 'boolean true'
  echo "{\"state\":\"locked\",\"collection\":\"$collection\",\"lockedConfirmed\":true}"
fi
profile=$(mktemp -d "$CASE/mage-vault-gate-XXXXXX"); home=$(mktemp -d "$CASE/mage-vault-gate-XXXXXX")
began=$(date +%s%N)
result=$(MAGE_VG_PROFILE="$profile" MAGE_VG_HOME="$home" MAGE_VG_BUNDLE="$ROOT/bundle.cjs" \
  timeout 30 "$ROOT/electron/electron" --disable-gpu --ozone-platform=headless "$ROOT/probe.cjs" 2>/dev/null | grep '^{' || echo '{"error":"sin respuesta"}')
echo "{\"state\":\"$STATE\",\"totalMs\":$(( ($(date +%s%N) - began) / 1000000 )),\"probe\":$result}"
if test "$STATE" = unlocked || test "$STATE" = locked; then pkill -u "$(id -u)" -f "control-directory=$XDG_RUNTIME_DIR/keyring" || true; fi
INNER

for state in unlocked locked not-running no-bus; do
  case_dir="$root/$state"
  mkdir -p "$case_dir"/{home,data,config,runtime,empty-system}
  chmod 700 "$case_dir/runtime"
  chown -R "$account" "$case_dir"
  common=(env -u DISPLAY -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS -u XDG_CURRENT_DESKTOP
    HOME="$case_dir/home" XDG_CONFIG_HOME="$case_dir/config" XDG_DATA_HOME="$case_dir/data"
    XDG_DATA_DIRS="$case_dir/empty-system" XDG_RUNTIME_DIR="$case_dir/runtime" ROOT="$root" CASE="$case_dir" STATE="$state")
  if test "$state" = no-bus; then
    runuser -u "$account" -- "${common[@]}" bash "$root/inner.sh"
    continue
  fi
  bus_args=()
  if test "$state" = not-running; then
    # Sin directorios de activación: el bus no puede arrancar el llavero por su cuenta.
    cat > "$case_dir/bus.conf" <<EOF
<busconfig><type>session</type><listen>unix:tmpdir=$case_dir/runtime</listen><auth>EXTERNAL</auth>
<policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy>
</busconfig>
EOF
    chown "$account" "$case_dir/bus.conf"
    bus_args+=(--config-file="$case_dir/bus.conf")
  fi
  runuser -u "$account" -- "${common[@]}" dbus-run-session "${bus_args[@]}" -- bash "$root/inner.sh"
done
