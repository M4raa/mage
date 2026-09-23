#!/bin/sh
# Instalador de Mage para Linux y macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/M4raa/mage/main/scripts/install.sh | sh
#
# POSIX `sh` a proposito (no bash): tiene que correr igual en Debian, Alpine y macOS sin depender de
# que haya bash instalado ni de en que ruta este.
#
# QUE HACE: baja de la ultima release el paquete que corresponde a este sistema y arquitectura, y lo
# instala en el sitio habitual de cada uno. NO instala el CLI del agente — eso lo trae el usuario, y
# se le dice al terminar.
#
# AVISO HONESTO: los paquetes de Linux y macOS **no se han construido ni probado nunca** (el job de
# CI existe, desactivado). Este script esta escrito y revisado, pero hasta que no haya una release con
# esos artefactos no se ha podido ejecutar de principio a fin.
set -eu

REPO="M4raa/mage"
API="https://api.github.com/repos/${REPO}/releases/latest"

decir() { printf '%s\n' "$*"; }
morir() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || morir "hace falta curl"

so="$(uname -s)"
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *) morir "arquitectura no soportada: $arch" ;;
esac

decir "Buscando la ultima release de Mage..."
json="$(curl -fsSL "$API")" || morir "no se pudo consultar la release (¿hay alguna publicada?)"

# Extrae la URL del primer artefacto cuyo nombre case con el patron. `grep -o` sobre el JSON en vez de
# depender de jq, que no viene de serie en muchos sistemas.
url_de() {
  printf '%s' "$json" | grep -o "https://[^\"]*$1" | head -n 1
}

case "$so" in
  Linux)
    if command -v apt-get >/dev/null 2>&1; then
      url="$(url_de "${arch}\.deb")"
      [ -n "$url" ] || morir "esta release no trae paquete .deb para $arch"
      tmp="$(mktemp -d)"
      decir "Descargando $url"
      curl -fsSL -o "$tmp/mage.deb" "$url"
      decir "Instalando (pedira contraseña de administrador)..."
      sudo apt-get install -y "$tmp/mage.deb"
      rm -rf "$tmp"
    elif command -v rpm >/dev/null 2>&1; then
      url="$(url_de "${arch}\.rpm")"
      [ -n "$url" ] || morir "esta release no trae paquete .rpm para $arch"
      tmp="$(mktemp -d)"
      decir "Descargando $url"
      curl -fsSL -o "$tmp/mage.rpm" "$url"
      decir "Instalando (pedira contraseña de administrador)..."
      sudo rpm -i "$tmp/mage.rpm"
      rm -rf "$tmp"
    else
      # Sin gestor de paquetes conocido: AppImage al directorio del usuario, que no necesita permisos.
      url="$(url_de "${arch}\.AppImage")"
      [ -n "$url" ] || morir "esta release no trae AppImage para $arch"
      destino="${HOME}/.local/bin"
      mkdir -p "$destino"
      decir "Descargando $url"
      curl -fsSL -o "${destino}/mage" "$url"
      chmod +x "${destino}/mage"
      decir "Instalado en ${destino}/mage"
      case ":${PATH}:" in
        *":${destino}:"*) ;;
        *) decir "AVISO: ${destino} no esta en tu PATH; añadelo para poder escribir 'mage'." ;;
      esac
    fi
    ;;
  Darwin)
    url="$(url_de "${arch}\.dmg")"
    [ -n "$url" ] || morir "esta release no trae .dmg para $arch"
    tmp="$(mktemp -d)"
    decir "Descargando $url"
    curl -fsSL -o "$tmp/mage.dmg" "$url"
    decir "Montando la imagen..."
    punto="$(hdiutil attach -nobrowse -readonly "$tmp/mage.dmg" | tail -n 1 | awk '{ print $3 }')"
    [ -n "$punto" ] || morir "no se pudo montar el .dmg"
    cp -R "${punto}/Mage.app" /Applications/
    hdiutil detach "$punto" >/dev/null
    rm -rf "$tmp"
    decir "Instalado en /Applications/Mage.app"
    # La app NO esta firmada ni notarizada (no hay via gratuita en macOS), asi que
    # Gatekeeper la bloqueara la primera vez. Decirlo AQUI evita el "no se puede abrir" sin contexto.
    decir "La primera vez: clic derecho sobre Mage.app -> Abrir -> Abrir (no esta firmada)."
    ;;
  *)
    morir "sistema no soportado: $so (este script es para Linux y macOS)"
    ;;
esac

decir ""
decir "Listo. Mage NO trae el agente dentro: necesitas ademas"
decir "  1. el CLI de Claude Code:  npm i -g @anthropic-ai/claude-code"
decir "  2. tu propia sesion:       claude auth login"
