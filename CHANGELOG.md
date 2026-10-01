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
  aparece como solo disponible en Claude Desktop, y las Apps de ChatGPT de Codex, como pendientes de
  verificar con una cuenta.
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
  límites de uso. Marcado **sin verificar** hasta probarlo con una cuenta real.
- **Uso de agy** en el panel de Uso: las ventanas de 5 h y semanal de cada grupo de modelos.
- **Comandos de agy**: al empezar una conversación de agy eliges qué comandos de terminal puede
  ejecutar, escritos exactamente como los lanzará (o los deniegas). Cuando agy deniega uno, el aviso
  ofrece **permitirlo para la próxima conversación**.
- agy ve tus carpetas `~/.gemini/config` (sus MCP, skills y plugins) y `~/.ssh`, y en Configuración ›
  Proveedores y modelos puedes añadirle las de tus herramientas (`.aws`, `.kube`…).
- Los modos de permiso salen del propio CLI: si Claude o Codex estrenan uno, Mage lo ofrece.

### Cambiado
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

### Corregido
- Los enlaces del chat se abren en el navegador del sistema, no en otra ventana de Mage.
- Los proveedores compatibles con OpenAI (Ollama, LM Studio…) ya pintan su respuesta: antes el turno
  terminaba vacío.
- El aviso «Abre una pestaña…» ya no se queda en el prompt después de abrir un chat.
- La fila de controles del prompt ya no baja unos píxeles al elegir un esfuerzo alto.

### Seguridad
- Las claves de API de los proveedores se guardan cifradas con el almacén del sistema y la interfaz ya
  no las ve; las de la 0.1.1 se cifran solas al arrancar.
- Las variables `OPENAI_API_KEY` y `CODEX_API_KEY` ya no llegan a los agentes que lanza Mage.

### Por completar antes de publicar
- Por completar: probar Codex con una cuenta real (hoy funciona según su documentación, sin verificar).
- Por completar: runtime propio para los modelos locales, en lugar del gateway.

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
