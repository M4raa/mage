; Instalador de Mage con su aspecto (grupo B de la 0.1.2). electron-builder lo recoge solo por el nombre
; (`installer.nsh` en buildResources) y lo incluye ANTES de las paginas de su plantilla, asi que aqui
; solo se fijan colores y textos y se sustituyen las paginas de bienvenida y final por las nuestras.
; Todo lo demas —carpeta, instalacion, accesos directos, actualizaciones— es la plantilla de siempre.
;
; Colores: los del tema oscuro de la app (--color-mg-window y --color-mg-text de main.css), los mismos
; que llevan installerSidebar.bmp e installerHeader.bmp (`pnpm icons`). MUI los aplica a la franja de
; cabecera y a las paginas de bienvenida y final; las del medio son controles del sistema y no se tocan.
; El fichero se compila con -INPUTCHARSET UTF8: los acentos van tal cual.

!define MUI_BGCOLOR "141414"
!define MUI_TEXTCOLOR "F0F0F0"
; Sin tema visual, la casilla «Abrir Mage» del final hace caso a los colores: con tema, Windows la
; pinta en negro sobre el fondo oscuro y no se lee (fallo conocido de MUI, #443).
!define MUI_FORCECLASSICCONTROLS

!macro customHeader
  ; Lo que sale abajo a la izquierda, en lugar de «Nullsoft Install System».
  BrandingText "Mage ${VERSION}"
!macroend

; Bienvenida (la plantilla no trae ninguna). Al actualizar desde la app no se enseña, y tampoco la de
; «¿Para quién se instalará?» que la plantilla pone justo detras (medido con la prueba local de
; actualizacion: salia en cada update, con la opcion ya tomada). El usuario eligio «Reiniciar ahora»:
; solo tiene que ver el progreso y el final. La carpeta ya la salta la plantilla por su cuenta.
!macro customWelcomePage
  Function mageSkipPageIfUpdated
    ${if} ${isUpdated}
      Abort
    ${endif}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_PRE mageSkipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Te damos la bienvenida a Mage"
  !define MUI_WELCOMEPAGE_TEXT "Mage reúne tus agentes de código en una sola ventana: varias conversaciones a la vez, varias cuentas y su uso siempre a la vista.$\r$\n$\r$\nPor defecto se instala solo para tu usuario, sin permisos de administrador. Si ya tenías Mage, tus cuentas, conversaciones y ajustes se quedan como estaban.$\r$\n$\r$\nPulsa Siguiente para continuar."
  !insertmacro MUI_PAGE_WELCOME
  ; Para la pagina siguiente, la de modo de instalacion (su PRE llama a esta funcion si esta definida).
  ; ponytail: da por hecho que la siguiente ES esa (perMachine: false y sin licencia). Con licencia o
  ; perMachine: true, la definicion caeria en otra pagina y makensis se quejaria de un PRE repetido.
  !define MUI_PAGE_CUSTOMFUNCTION_PRE mageSkipPageIfUpdated
!macroend

; Final: el de la plantilla con nuestro texto. `StartApp` es copia de assistedInstaller.nsh (abre Mage
; como el usuario, con --updated si viene de una actualizacion); si se actualiza electron-builder, hay
; que mirar que siga igual.
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "Abrir Mage ahora"
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !define MUI_FINISHPAGE_TITLE "Mage está listo"
  ; Tambien sale al terminar una actualizacion (su casilla es la que relanza Mage): el texto vale para las dos.
  !define MUI_FINISHPAGE_TEXT "Lo tienes en el menú Inicio y en el escritorio.$\r$\n$\r$\nMage se actualiza solo: cuando haya una versión nueva, te avisará para reiniciar."
  !insertmacro MUI_PAGE_FINISH
!macroend

; Bienvenida del desinstalador.
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Desinstalar Mage"
  !define MUI_WELCOMEPAGE_TEXT "Se quitará Mage de este equipo.$\r$\n$\r$\nTus conversaciones, cuentas y ajustes no se borran: si vuelves a instalarlo, los encontrarás como los dejaste.$\r$\n$\r$\nPulsa Siguiente para continuar."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
