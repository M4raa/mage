; Instalador de Mage con su aspecto (grupo B de la 0.1.2). electron-builder lo recoge solo por el nombre
; (`installer.nsh` en buildResources) y lo incluye ANTES de las paginas de su plantilla, asi que aqui
; solo se fijan colores y textos y se sustituyen las paginas de bienvenida y final por las nuestras.
; Todo lo demas —carpeta, instalacion, accesos directos, actualizaciones— es la plantilla de siempre.
; Textos en castellano e ingles (F3.7): cada uno es un LangString de la macro customHeader, que la plantilla inserta
; justo despues de cargar los idiomas (antes no existen ${LANG_SPANISHINTERNATIONAL} ni ${LANG_ENGLISH}; electron-builder carga el castellano como SpanishInternational, LCID 3082); las paginas los usan
; como $(nombre), que se resuelve al ejecutar.
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

!include nsDialogs.nsh
!include LogicLib.nsh
!include WinMessages.nsh

!ifndef BUILD_UNINSTALLER
  Var magePathCheckbox
  Var mageAddToPath
!endif

!macro customHeader
  ; Lo que sale abajo a la izquierda, en lugar de «Nullsoft Install System».
  BrandingText "Mage ${VERSION}"

  LangString mageWelcomeTitle ${LANG_SPANISHINTERNATIONAL} "Te damos la bienvenida a Mage"
  LangString mageWelcomeTitle ${LANG_ENGLISH} "Welcome to Mage"
  LangString mageWelcomeText ${LANG_SPANISHINTERNATIONAL} "Mage reúne tus agentes de código en una sola ventana: varias conversaciones a la vez, varias cuentas y su uso siempre a la vista.$\r$\n$\r$\nPor defecto se instala solo para tu usuario, sin permisos de administrador. Si ya tenías Mage, tus cuentas, conversaciones y ajustes se quedan como estaban.$\r$\n$\r$\nPulsa Siguiente para continuar."
  LangString mageWelcomeText ${LANG_ENGLISH} "Mage brings your coding agents together in one window: several conversations at once, several accounts, and their usage always in sight.$\r$\n$\r$\nBy default it installs only for your user, without administrator rights. If you already had Mage, your accounts, conversations and settings stay as they were.$\r$\n$\r$\nClick Next to continue."
  LangString mageFinishRun ${LANG_SPANISHINTERNATIONAL} "Abrir Mage ahora"
  LangString mageFinishRun ${LANG_ENGLISH} "Open Mage now"
  LangString mageFinishTitle ${LANG_SPANISHINTERNATIONAL} "Mage está listo"
  LangString mageFinishTitle ${LANG_ENGLISH} "Mage is ready"
  LangString mageFinishText ${LANG_SPANISHINTERNATIONAL} "Lo tienes en el menú Inicio y en el escritorio.$\r$\n$\r$\nMage se actualiza solo: cuando haya una versión nueva, te avisará para reiniciar."
  LangString mageFinishText ${LANG_ENGLISH} "You will find it in the Start menu and on the desktop.$\r$\n$\r$\nMage updates itself: when there is a new version, it will ask you to restart."
  LangString mageUnWelcomeTitle ${LANG_SPANISHINTERNATIONAL} "Desinstalar Mage"
  LangString mageUnWelcomeTitle ${LANG_ENGLISH} "Uninstall Mage"
  LangString mageUnWelcomeText ${LANG_SPANISHINTERNATIONAL} "Se quitará Mage de este equipo.$\r$\n$\r$\nTus conversaciones, cuentas y ajustes no se borran: si vuelves a instalarlo, los encontrarás como los dejaste.$\r$\n$\r$\nPulsa Siguiente para continuar."
  LangString mageUnWelcomeText ${LANG_ENGLISH} "Mage will be removed from this computer.$\r$\n$\r$\nYour conversations, accounts and settings are not deleted: if you install it again, you will find them as you left them.$\r$\n$\r$\nClick Next to continue."
  LangString magePathTitle ${LANG_SPANISHINTERNATIONAL} "Comando de terminal"
  LangString magePathTitle ${LANG_ENGLISH} "Terminal command"
  LangString magePathSubtitle ${LANG_SPANISHINTERNATIONAL} "Usa Mage también desde la terminal."
  LangString magePathSubtitle ${LANG_ENGLISH} "Use Mage from the terminal too."
  LangString magePathCheckboxText ${LANG_SPANISHINTERNATIONAL} "Añadir el comando mage al PATH de tu usuario (podrás escribir «mage chat» en cualquier terminal nueva)"
  LangString magePathCheckboxText ${LANG_ENGLISH} "Add the mage command to your user PATH (you will be able to type $\"mage chat$\" in any new terminal)"
  LangString magePathFailed ${LANG_SPANISHINTERNATIONAL} "No se pudo cambiar el PATH; puedes añadir a mano esta carpeta:"
  LangString magePathFailed ${LANG_ENGLISH} "Could not change the PATH; you can add this folder by hand:"
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
  !define MUI_WELCOMEPAGE_TITLE "$(mageWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(mageWelcomeText)"
  !insertmacro MUI_PAGE_WELCOME
  ; Para la pagina siguiente, la de modo de instalacion (su PRE llama a esta funcion si esta definida).
  ; ponytail: da por hecho que la siguiente ES esa (perMachine: false y sin licencia). Con licencia o
  ; perMachine: true, la definicion caeria en otra pagina y makensis se quejaria de un PRE repetido.
  !define MUI_PAGE_CUSTOMFUNCTION_PRE mageSkipPageIfUpdated
!macroend

; Pagina propia antes de instalar (U9): la casilla del PATH, MARCADA por defecto. No sale al actualizar (se respeta lo
; elegido la primera vez) ni al instalar para todos los usuarios (el PATH de usuario seria el del administrador).
!macro customPageAfterChangeDir
  Page custom magePathPageShow magePathPageLeave

  Function magePathPageShow
    ${if} ${isUpdated}
    ${orIf} $installMode == "all"
      Abort
    ${endif}
    ${if} $mageAddToPath == ""
      StrCpy $mageAddToPath ${BST_CHECKED}
    ${endif}
    !insertmacro MUI_HEADER_TEXT "$(magePathTitle)" "$(magePathSubtitle)"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateCheckbox} 0 0 100% 24u "$(magePathCheckboxText)"
    Pop $magePathCheckbox
    ${NSD_SetState} $magePathCheckbox $mageAddToPath
    nsDialogs::Show
  FunctionEnd

  Function magePathPageLeave
    ${NSD_GetState} $magePathCheckbox $mageAddToPath
  FunctionEnd
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
    !define MUI_FINISHPAGE_RUN_TEXT "$(mageFinishRun)"
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !define MUI_FINISHPAGE_TITLE "$(mageFinishTitle)"
  ; Tambien sale al terminar una actualizacion (su casilla es la que relanza Mage): el texto vale para las dos.
  !define MUI_FINISHPAGE_TEXT "$(mageFinishText)"
  !insertmacro MUI_PAGE_FINISH
!macroend

; Tras copiar los ficheros. Al actualizar no se toca nada: ni el idioma heredado ni el PATH.
!macro customInstall
  ${ifNot} ${isUpdated}
  ${andIf} $installMode != "all"
    ; Idioma elegido en este instalador: Mage lo hereda en su primer arranque (userData/installer-language).
    CreateDirectory "$APPDATA\${PRODUCT_NAME}"
    FileOpen $0 "$APPDATA\${PRODUCT_NAME}\installer-language" w
    ${if} $LANGUAGE == ${LANG_SPANISHINTERNATIONAL}
      FileWrite $0 "es"
    ${else}
      FileWrite $0 "en"
    ${endif}
    FileClose $0
    ${if} $mageAddToPath == ${BST_CHECKED}
      nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\mage-path.ps1" -Action add -Directory "$INSTDIR\resources\bin"'
      Pop $0
      ${if} $0 != 0
        DetailPrint "$(magePathFailed) $INSTDIR\resources\bin"
      ${endif}
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
    ${endif}
  ${endif}
!macroend

; Desinstalar de verdad quita la carpeta del PATH; una actualizacion (el desinstalador viejo con --updated) no.
; Si la casilla se desmarco, `remove` no encuentra la carpeta y no cambia nada.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\mage-path.ps1" -Action remove -Directory "$INSTDIR\resources\bin"'
    Pop $0
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${endif}
!macroend

; Bienvenida del desinstalador.
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(mageUnWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(mageUnWelcomeText)"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
