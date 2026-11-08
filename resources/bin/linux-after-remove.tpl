#!/bin/bash
# Copia del after-remove de electron-builder (app-builder-lib 26.15.3) con UN cambio: /usr/bin/mage solo se borra si es
# NUESTRO enlace al lanzador; el de otro paquete (la herramienta mage de Go) se queda (U25). Revisar al actualizar electron-builder.
MAGE_LINK='/usr/bin/${executable}'
if [ -L "$MAGE_LINK" ] && [ "$(readlink "$MAGE_LINK")" = '/opt/${sanitizedProductName}/resources/bin/${executable}' ]; then
    rm -f "$MAGE_LINK"
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
