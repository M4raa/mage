#!/usr/bin/env bash
# Ejecutar como root solo para preparar/copiar y cambiar UID. Electron siempre es no privilegiado.
# MAGE_F0_ELECTRON_DIST debe indicar una distribución Linux de Electron 44 ya instalada.
set -euo pipefail
ulimit -c 0
source_dist=${MAGE_F0_ELECTRON_DIST:?Falta MAGE_F0_ELECTRON_DIST}
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
root=$(mktemp -d /tmp/mage-host-008-XXXXXX)
cleanup() {
  case "$root" in /tmp/mage-host-008-*) rm -rf -- "$root";; *) exit 70;; esac
  if test -e "$root"; then echo "CLEANUP_FAILED=$root"; return 71; fi
  echo "CLEANUP_ABSENT=$root"
}
trap cleanup EXIT
chmod 755 "$root"
cp -a "$source_dist" "$root/electron"
cp "$source_dir/f0-keyring.cjs" "$root/probe.cjs"
cp "$source_dir/f0-keyring-matrix.py" "$root/runner.py"
chmod 644 "$root/probe.cjs" "$root/runner.py"
if getent passwd 1000 >/dev/null; then account=$(getent passwd 1000 | cut -d: -f1); else account=nobody; fi
echo "DISTRO=$WSL_DISTRO_NAME"
grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release
gnome-keyring-daemon --version
for state in locked not-running; do
  case_dir="$root/$state"
  mkdir -p "$case_dir"/{home,data,config,runtime,empty-system,profile}
  chmod 700 "$case_dir/runtime"
  chown -R "$account" "$case_dir"
  bus_args=()
  if test "$state" = not-running; then
    # Mantener el caso c sin servicio: el bus normal puede ACTIVARLO al primer acceso libsecret.
    # No se incluyen directorios de activación; sigue instalado el paquete del sistema.
    cat > "$case_dir/bus.conf" <<EOF
<busconfig><type>session</type><listen>unix:tmpdir=$case_dir/runtime</listen><auth>EXTERNAL</auth>
<policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy>
</busconfig>
EOF
    bus_args+=(--config-file="$case_dir/bus.conf")
  fi
  runuser -u "$account" -- env -u DISPLAY -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS \
    HOME="$case_dir/home" XDG_CONFIG_HOME="$case_dir/config" XDG_DATA_HOME="$case_dir/data" \
    XDG_DATA_DIRS="$case_dir/empty-system" XDG_RUNTIME_DIR="$case_dir/runtime" \
    MAGE_F0_PROFILE="$case_dir/profile" MAGE_F0_CIPHER="$case_dir/synthetic.bin" \
    MAGE_F0_CIPHER_SEED="$root/locked/synthetic.bin" \
    MAGE_KEYRING_STATE="$state" MAGE_ELECTRON="$root/electron/electron" MAGE_PROBE="$root/probe.cjs" \
    dbus-run-session "${bus_args[@]}" -- python3 "$root/runner.py"
done
