# Novedades de Mage

Lo que cambia de una versión a otra, contado para quien usa la app. La más reciente va arriba. Mage
enseña estas mismas notas en su pestaña de novedades al actualizarse, y en Configuración › Notas de
versión.

## 0.1.2 — en desarrollo

### Añadido
- Pestaña de **novedades**: al actualizar Mage se abre sola con las notas de la versión instalada, y
  en su menú lateral están todas las anteriores. También se abre desde Configuración › Notas de versión.
- **MCP y conectores** se divide en tres pestañas, como en Claude Desktop: **Servidores**, **Conectores**
  y **Extensiones**.
- Los servidores MCP comunes se comparten con **todos los proveedores**: Claude y Codex los cargan al
  abrir cada sesión, y a agy se le copian con **Sincronizar con agy** (o solos, si activas la
  sincronización automática), sin tocar lo que agy ya tenía y con una copia previa de su fichero. Una
  columna dice qué proveedores carga cada uno, lo propio de cada CLI lleva su insignia («Solo Claude»,
  «Solo agy»…) y **Solo en…** elige en qué proveedores y cuentas se carga.
- **Conectores** por cuenta con su último estado y la fecha en que se comprobó, **Conectar** en los que
  piden autorización y un interruptor para no usar los de claude.ai en una cuenta. «Claude in Chrome»
  aparece como solo disponible en Claude Desktop. Las Apps de ChatGPT se consultan por cuenta de Codex;
  si el CLI rechaza la consulta, se muestra el error y se puede reintentar.
- **Extensiones** `.mcpb` propias de Mage: instalar desde archivo, importar las de Claude Desktop
  copiándolas (ya no dependen de que Desktop siga instalado), activarlas, configurarlas y
  desinstalarlas. Los valores sensibles de su configuración se guardan cifrados. Mage avisa si a una le
  falta configurar algo o necesita `node`/`python` en el PATH.
- **Pull requests y CI en la conversación**, como en Claude Desktop y con el GitHub CLI (`gh`): la fila
  del chat enseña el PR de la rama con sus checks (✓ ✗ ●) y, al desplegarlo, los que fallan, los runs
  de la rama con **Relanzar** y **Cancelar**, el **auto-merge** nativo de GitHub (squash) y el
  **auto-fix**, que abre un turno para que el agente arregle un CI roto o un conflicto. Lo que escribe en
  GitHub pide confirmación. El PR se sigue aunque la ventana no tenga el foco y avisa cuando termina el CI.
- **Crear PR** deja en el input el prompt para que el agente suba la rama y abra el PR (lo envías tú), y
  el PR que crea se vincula solo a la conversación. Durante ese turno Mage no deja forzar el push, saltar
  los hooks ni abrir el PR en otro repositorio.
- **Worktrees**: en un repositorio git, cada conversación nueva trabaja en su propia copia en
  `.claude/worktrees/`, en una rama `claude/…` con el tema del primer mensaje (la casilla **Worktree**
  lo desactiva). Al cerrar la pestaña el worktree se borra si no tiene cambios (la rama se queda), y al
  reabrir la conversación vuelve. **Traer la base** fusiona la rama base en la del worktree.
- Si falta `gh` o no tiene sesión, la fila del chat lo dice con un aviso que se puede descartar para
  siempre (se recupera en Configuración › General), donde también está **Archivar al fusionar o cerrar
  el PR**.

- **Añadir cuenta para cualquier proveedor**: Anthropic, OpenAI y Google, por suscripción o con
  **clave de API**, y servidores locales (IP y puerto). Las claves se guardan cifradas y solo las recibe
  su cuenta; las pestañas de una cuenta que factura la API llevan la marca **Factura API**.
- **Codex** (OpenAI) como proveedor, con su propio diálogo de permisos, su catálogo de modelos y sus
  límites de uso. Login, turnos, aprobaciones, interrupción, reanudación e instrucciones comprobados
  con una cuenta real y Codex 0.160.0.
- **Uso de agy** en el panel de Uso: las ventanas de 5 h y semanal de cada grupo de modelos.
- **Comandos de agy**: al empezar una conversación de agy eliges qué comandos de terminal puede
  ejecutar, escritos exactamente como los lanzará (o los deniegas). Cuando agy deniega uno, el aviso
  ofrece **permitirlo para la próxima conversación**. Lo mismo con sus **herramientas MCP**: eliges el
  servidor entre los que carga agy y la herramienta exacta, o todas las del servidor; si agy deniega una,
  el aviso dice cuál y ofrece permitirla.
- agy ve tus carpetas `~/.gemini/config` (sus MCP, skills y plugins) y `~/.ssh`, y en Configuración ›
  Proveedores y modelos puedes añadirle las de tus herramientas (`.aws`, `.kube`…).
- Los modos de permiso salen del propio CLI: si Claude o Codex estrenan uno, Mage lo ofrece.
- **Runtime propio de Mage para los modelos sin CLI** (Ollama, LM Studio y cualquier servidor compatible
  con OpenAI): Mage habla con el servidor directamente, sin pasar por el CLI de Claude, y la
  conversación se ve igual que las demás.
  - El modelo puede leer y buscar en tu proyecto, escribir y editar ficheros (con su diff) y ejecutar
    comandos. Lo que cambia algo pide permiso con el mismo diálogo de siempre, y tiene los cinco modos
    de permiso. En Configuración › Proveedores y modelos eliges con qué terminal ejecuta los comandos.
  - Usa los **servidores MCP comunes**; si uno pide iniciar sesión, Mage abre el navegador. Puedes
    decidir qué herramientas puede usar cada modelo.
  - Sus conversaciones salen en el historial y se pueden reanudar; funcionan `/clear`, `/rename` y
    `/compact`.
  - Mage conoce la ventana de contexto del modelo, avisa cuando se acerca al límite y, al llenarse,
    resume la conversación con el propio modelo para seguir.
  - Con un modelo que no admite herramientas, la conversación lo dice y sigue como chat; si el modelo
    escribe la llamada como texto, Mage la ejecuta igualmente.
  - **Probar conexión**, al dar de alta el servidor, rellena sus modelos, la ventana de contexto y si
    admite herramientas.
- **Avisos propios de Mage**, abajo a la derecha: los errores se quedan hasta que los cierras, el resto se
  va solo (y no mientras tienes el ratón encima o Mage en segundo plano). Con Mage delante también te
  avisa de lo que pasa en las conversaciones que no estás viendo —un permiso pendiente, un turno
  terminado, un subagente que acaba, un límite de uso— y el aviso te lleva a ella. La **campana** de la
  barra de estado guarda los últimos de la ventana: marcarlos como leídos o limpiarlos.
- **Instrucciones del proyecto para Codex y agy**: si tu proyecto solo tiene `CLAUDE.md`, Mage se lo da
  a Codex como su `AGENTS.md` y a agy como su `GEMINI.md` en cada conversación, junto con tu
  `~/.claude/CLAUDE.md`, sin escribir nada en el repositorio. Si el proyecto ya tiene el fichero propio de
  ese agente, se usa el suyo. El Inspector › Instrucciones dice qué recibe la conversación, y el README
  explica la convención recomendada: `AGENTS.md` con el contenido y `CLAUDE.md` con `@AGENTS.md`.

### Cambiado
- El aviso al activar **Omitir permisos** dice claramente lo que implica: el modelo podrá ejecutar
  cualquier comando y modificar cualquier fichero sin preguntar, así que úsalo solo con proyectos y
  contenido de confianza.
- Las pestañas de **agy** mantienen la conversación en un solo proceso: el contexto se conserva,
  interrumpir ya no la pierde, admite imágenes (las abre con su propia herramienta), el esfuerzo llega a
  **Máximo** y los turnos largos ya no se cortan a los 30 minutos.
- Cuando agy deniega un comando, la conversación dice **qué comando** y por qué.
- agy corre con un perfil propio de Mage también con tu suscripción: lo que Mage le configura nunca toca
  tu configuración de agy. Sus conversaciones de antes no se ven desde Mage (tampoco se podían reanudar
  tras reiniciar).
- «Confirmar cambios» se llama ahora **Pedir commit al agente**, que es lo que hace.
- Sin pestañas abiertas se ve la misma pantalla que en un chat nuevo, con sus proyectos recientes:
  elegir un proyecto abre la conversación en esa carpeta, y **＋ Nuevo chat** la abre siempre en una
  carpeta temporal.
- El deslizador de modo ya no cambia de ancho entre pasos: **Manual** tiene icono propio, el pulgar se
  desliza de un paso a otro y el menú se queda en su sitio.
- Mage funciona ahora sobre Electron 44 (Node 24), con los parches de seguridad al día.
- Al cerrar la ventana, la pregunta es un diálogo de Mage y dice cuántas conversaciones siguen
  trabajando.
- Cuando una actualización termina de descargarse, Mage lo avisa con su propio diálogo y las novedades
  de la versión que llega, en la ventana que estés usando; si eliges **Más tarde**, queda a la vista en
  la barra de estado hasta que reinicies. Con Mage en la bandeja no aparece nada hasta que vuelves.
- El instalador tiene el aspecto de Mage y va en castellano; al actualizar solo enseña el progreso y el
  final.
- El aviso de coste al cambiar de modelo o de esfuerzo, y el de «Omitir permisos», salen ahora como aviso
  de Mage y dicen de qué conversación son.
- Al cerrar la pestaña de un worktree con cambios, el aviso trae **Abrir carpeta** y **Copiar ruta**.
- Desaparecen los proveedores **OpenAI · API** y **Gemini · API**: una clave de OpenAI o de Gemini se
  añade ahora como cuenta de Codex o de agy («Añadir cuenta»). Una pestaña que usaba uno de ellos se
  abre con Claude.

### Corregido
- En Codex se pueden cambiar el modelo, el esfuerzo y el nivel de permisos desde el prompt. Los
  permisos incluyen solicitar aprobación, aprobar automáticamente dentro del proyecto y acceso
  completo; al cambiar de proveedor en un chat nuevo se elige su cuenta y su catálogo. El Inspector
  deja de pedir a Codex y agy los ajustes efectivos del CLI de Claude.
- Las cuentas y pestañas se muestran al arrancar sin esperar al sondeo de login de Codex; se confirma en segundo plano con caché.
- Los errores MCP de Codex no muestran detalles de autenticación; las claves conocidas se ocultan
  también en resultados de herramientas y permisos antes de llegar a la interfaz.
- Codex recibe el esfuerzo configurado al iniciar cada turno; antes usaba el predeterminado del CLI.
- Codex abre los hilos con permisos en 0.160.0, muestra el texto devuelto por MCP y conserva el
  contenido de los cambios para el diálogo de aprobación de edición.
- Los enlaces del chat se abren en el navegador del sistema, no en otra ventana de Mage.
- Los proveedores compatibles con OpenAI (Ollama, LM Studio…) ya responden: antes el turno terminaba
  vacío.
- El historial de conversaciones ya no deja la app trabada unas décimas de segundo cada vez que se
  actualiza.
- El aviso «Abre una pestaña…» ya no se queda en el prompt después de abrir un chat.
- Volver a elegir en un desplegable la opción que ya estaba puesta no cuenta como un cambio: el selector
  de modelo avisaba «Modelo cambiado» sin haber cambiado nada.
- La fila de controles del prompt ya no baja unos píxeles al elegir un esfuerzo alto.
- Si falla algo que acabas de pedir (cambiar de rama, borrar una conversación, abrir un enlace, mover una
  pestaña a otra ventana, guardar la configuración, instalar la actualización…), Mage lo dice en vez de
  no hacer nada.
- **Modelos locales (runtime propio de Mage):**
  - En **Auto**, el agente solo ejecuta sin preguntar comandos de una lista corta (leer ficheros, `git`
    sin red, test y build del proyecto); todo lo demás pregunta. Antes se escapaban comandos que borraban
    o leían fuera del proyecto (`rm -rf $HOME`, `$env:USERPROFILE`, `cd; …`). Al entrar en Auto, Mage
    avisa de que no es un sandbox.
  - Glob y Grep ya no leen fuera del proyecto sin preguntar (`../**`, rutas absolutas), y un enlace
    simbólico o un junction dentro del proyecto ya no sirve para salir de él.
  - «Permitir siempre» vale dentro del proyecto: lo que va fuera de él o a la red pregunta siempre, y su
    tarjeta ya no ofrece recordarlo. En «Omitir permisos», un comando que nombra una ruta de fuera del
    proyecto también pregunta; no es una barrera: lo que sale del proyecto sin nombrarlo se ejecuta.
  - `git -C <carpeta> push`, `git -c … pull`, `git --git-dir=… fetch` y similares cuentan como acceso a
    la red: su tarjeta lo marca como red y nunca se puede «Permitir siempre».
  - Un bloque de JSON en la respuesta del modelo (un `package.json` citado, un README con trampa) ya no
    se ejecuta como si fuera una llamada a una herramienta.
  - «Probar conexión» solo usa la clave guardada con la URL del proveedor guardado.
  - Con solo un servidor local dado de alta (sin cuentas de Claude, Codex ni agy) ya se puede abrir una
    conversación.
  - Un servidor MCP que pide iniciar sesión ya no abre el navegador solo en cada pestaña: sale un aviso
    con **Iniciar sesión**, uno por servidor para toda la app.
  - `Write` ya no pisa un fichero que no ha leído antes o que ha cambiado desde que lo leyó.
  - Una búsqueda con una expresión muy costosa ya no congela la app, un comando que deja procesos en
    segundo plano ya no cuelga el turno y reabrir una conversación de un modelo sin herramientas nativas
    la reconstruye bien.
  - Si no se puede guardar la conversación en disco, Mage lo dice en el chat.
- Los avisos de terceros listan solo los paquetes que viajan de verdad en la aplicación.

### Seguridad
- Las claves de API de los proveedores se guardan cifradas con el almacén del sistema y la interfaz ya
  no las ve; las de la 0.1.1 se cifran solas al arrancar.
- Las variables `OPENAI_API_KEY` y `CODEX_API_KEY` ya no llegan a los agentes que lanza Mage.

## 0.1.1 — 2026-09-30

### Añadido
- Botón **Copiar** en los bloques de código y en cada mensaje del chat.
- Al pasar por encima de una imagen pegada se ve su nombre, y borrar `[Imagen N]` quita la imagen.
- Clic en cualquier hueco del chat para escribir en el prompt.
- **Modo y esfuerzo como deslizadores**, y modo de permiso por defecto en Configuración.
- Tarjetas de **proyectos recientes** al abrir un chat, y un ajuste para que un chat nuevo empiece en
  una carpeta temporal o en el último proyecto.
- Al cerrar la ventana, Mage pregunta si salir del todo o seguir en **segundo plano** (con «recordar
  mi decisión»).
- Arrastra una pestaña o una conversación **fuera de Mage** para abrirla en una ventana nueva, o
  suéltala sobre otra ventana para moverla allí.
- **Borrar cuentas** desde el menú de la cuenta (la cuenta por defecto no se puede borrar).
- Al añadir una cuenta se elige primero el **proveedor**.
- Monograma de la cuenta en cada pestaña, y color de cuenta a elección.
- Ventana **Uso general** con la hora de reinicio de 5 h y de 7 días de todas las cuentas.
- El límite de uso se explica en castellano, con la opción de **continuar automáticamente** cuando se
  reinicie.
- **MCP y conectores** rehechos: servidores comunes, de cada cuenta y de proyecto; importación desde
  Claude Desktop y desde el CLI de Claude Code; comprobación de su estado.
- `/context`, `/mcp`, `/rename` y `/clear` muestran su resultado en el chat.
- Los mensajes que envías con un turno en marcha esperan **en cola** y salen al terminar.
- Los subagentes en segundo plano se agrupan encima del prompt («N en ejecución»), con su tarea y un
  botón «Ver más».
- Clic en una notificación para ir a la conversación que la lanzó.
- Abrir y editar ficheros de fuera de la carpeta de la conversación, pidiendo permiso antes.
- Las palabras del indicador de trabajo son las mismas que las del CLI de Claude Code.
- Iconos propios en los paneles y en las herramientas.
- Reordenar los iconos del dock arrastrando o con Subir/Bajar.

### Corregido
- La caja del prompt vuelve a una línea al borrar texto, y ya no salta hacia arriba al crecer.
- Al volver a una pestaña, el chat y el prompt quedan al final, no arriba del todo.
- `/rename` cambia el nombre de la pestaña al momento.
- El panel Contexto muestra el contexto real, también con Opus 1M.
- El cursor de mano en todo lo que se puede pulsar.
- Los paneles movidos o escondidos y el tamaño de la ventana se conservan al reiniciar.
- Cerrar la ventana ya no deja procesos `claude` huérfanos.
- «Mover a ventana nueva» ya no pierde la pestaña.
- Un mensaje enviado al cambiar de cuenta en un chat nuevo sale por la cuenta correcta.
- El uso de las cuentas no activas ya no marca un 0 % falso.
- Los subagentes en segundo plano ya no salen como «Terminado · 0 s».
- La hora de reinicio del uso sale siempre en formato español.

## 0.1.0 — 2026-09-28

Primera versión pública (alpha).

### Añadido
- Varias conversaciones con el CLI real de Claude Code en pestañas, con **varias cuentas**, cada una
  con su propia suscripción.
- Paneles divisibles, varias ventanas, dock de herramientas acoplables y temas (también los de VS Code).
- Panel de **Actividad**: el chat queda limpio y cada paso del agente (pensamiento, herramientas) se
  consulta aparte.
- Las preguntas del agente aparecen ancladas encima del prompt.
- Los cinco modos de permiso del CLI: Plan, Manual, Aceptar ediciones, Auto y Omitir permisos.
- Los modelos reales que ofrece tu cuenta.
- **Git**: rama, cambios, cambio de rama y un botón que deja preparado el prompt para que el agente
  haga el commit.
- Referencias `[Imagen N]` a las imágenes pegadas.
- Los selectores bajan debajo del texto cuando el prompt crece.
- Servidores MCP compartidos entre cuentas.
- Análisis de uso por cuenta, historial de conversaciones y widget flotante.

### Corregido
- Alta de cuenta: el código de inicio de sesión ya no se da por «ya usado».
- Nombres de conversación: `/rename` y los mensajes de sistema ya no salen como título.
- La lista numerada del prompt enseña todos los números.
- El aviso de «más de 10 imágenes» desaparece.
- Ya no salta «Permiso requerido» con el permiso ya concedido.
