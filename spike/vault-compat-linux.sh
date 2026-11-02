#!/usr/bin/env bash
# F2.7, paso previo (devolución 16): compatibilidad de bóvedas en Linux (WSL sin escritorio). Ejecutar como root solo
# para preparar y cambiar de UID: Electron corre siempre sin privilegios y sin --no-sandbox. Bus, HOME, XDG, perfil y
# llavero son desechables, con contraseña y texto sintéticos; nunca se toca el llavero del usuario.
#
#   MAGE_VC_ELECTRON_DIST=<dist de Electron 44 para Linux> MAGE_VC_BUNDLES=<salida de vault-compat.mjs --build-only>
#   MAGE_VC_FROM=v0.1.2 bash spike/vault-compat-linux.sh
set -euo pipefail
ulimit -c 0
source_dist=${MAGE_VC_ELECTRON_DIST:?Falta MAGE_VC_ELECTRON_DIST}
bundles=${MAGE_VC_BUNDLES:?Falta MAGE_VC_BUNDLES}
from=${MAGE_VC_FROM:-v0.1.2}
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
root=$(mktemp -d /tmp/mage-vault-compat-run-XXXXXX)
cleanup() {
  case "$root" in /tmp/mage-vault-compat-run-*) rm -rf -- "$root";; *) exit 70;; esac
  if test -e "$root"; then echo "CLEANUP_FAILED=$root"; return 71; fi
  echo "CLEANUP_ABSENT=$root"
}
trap cleanup EXIT
chmod 755 "$root"
cp -a "$source_dist" "$root/electron"
cp "$source_dir/vault-compat.cjs" "$root/probe.cjs"
cp "$bundles/secretStore-$from.cjs" "$root/old.cjs"
cp "$bundles/secretStore-HEAD.cjs" "$root/current.cjs"
chmod 644 "$root"/*.cjs
if getent passwd 1000 >/dev/null; then account=$(getent passwd 1000 | cut -d: -f1); else account=nobody; fi
echo "DISTRO=$WSL_DISTRO_NAME"
grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release

# Lo que corre DENTRO del bus desechable, como usuario sin privilegios.
cat > "$root/inner.sh" <<'INNER'
set -euo pipefail
probe() { # perfil impl accion [flags...]
  local profile=$1 impl=$2 action=$3; shift 3
  MAGE_VC_PROFILE="$profile" MAGE_VC_IMPL="$impl" MAGE_VC_ACTION="$action" \
    timeout 30 "$ROOT/electron/electron" --disable-gpu --ozone-platform=headless "$@" "$ROOT/probe.cjs" 2>/dev/null | grep '^{' || echo '{"ok":false,"error":"sin respuesta"}'
}
pair() { # etiqueta flags...
  local label=$1; shift
  local profile; profile=$(mktemp -d "$CASE/mage-vault-compat-XXXXXX")
  echo "{\"case\":\"$label\",\"phase\":\"write-$FROM\",\"result\":$(probe "$profile" "$ROOT/old.cjs" write "$@")}"
  echo "{\"case\":\"$label\",\"phase\":\"read-HEAD\",\"result\":$(probe "$profile" "$ROOT/current.cjs" read "$@")}"
  rm -rf -- "$profile"
}
if test "$KEYRING" = unlocked; then
  printf '%s' 'mage-vault-compat-desechable' | gnome-keyring-daemon --unlock --components=secrets \
    --control-directory="$XDG_RUNTIME_DIR/keyring" >/dev/null
  sleep 0.3
fi
owner=$(dbus-send --session --print-reply --reply-timeout=500 --dest=org.freedesktop.DBus /org/freedesktop/DBus \
  org.freedesktop.DBus.NameHasOwner string:org.freedesktop.secrets | grep -c 'boolean true' || true)
echo "{\"keyring\":\"$KEYRING\",\"secretServiceOwner\":$owner}"
pair "$KEYRING-sin-flag"
pair "$KEYRING-gnome-libsecret" --password-store=gnome-libsecret
if test "$KEYRING" = unlocked; then pkill -u "$(id -u)" -f "control-directory=$XDG_RUNTIME_DIR/keyring" || true; fi
INNER

for keyring in unlocked none; do
  case_dir="$root/$keyring"
  mkdir -p "$case_dir"/{home,data,config,runtime,empty-system}
  chmod 700 "$case_dir/runtime"
  bus_args=()
  if test "$keyring" = none; then
    # Sin directorios de activación: el bus no puede arrancar el llavero por su cuenta.
    cat > "$case_dir/bus.conf" <<EOF
<busconfig><type>session</type><listen>unix:tmpdir=$case_dir/runtime</listen><auth>EXTERNAL</auth>
<policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy>
</busconfig>
EOF
    bus_args+=(--config-file="$case_dir/bus.conf")
  fi
  chown -R "$account" "$case_dir"
  runuser -u "$account" -- env -u DISPLAY -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS -u XDG_CURRENT_DESKTOP \
    HOME="$case_dir/home" XDG_CONFIG_HOME="$case_dir/config" XDG_DATA_HOME="$case_dir/data" \
    XDG_DATA_DIRS="$case_dir/empty-system" XDG_RUNTIME_DIR="$case_dir/runtime" \
    ROOT="$root" CASE="$case_dir" FROM="$from" KEYRING="$keyring" \
    dbus-run-session "${bus_args[@]}" -- bash "$root/inner.sh"
done
