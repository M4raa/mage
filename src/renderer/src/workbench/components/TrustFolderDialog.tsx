import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { useT } from '../../i18n/uiLanguage';

// "¿Confías en los archivos de esta carpeta?" — la pregunta que el CLI hace en su TUI y que en modo
// headless (el unico que usa Mage) no llega a hacer nunca.
//
// Por que importa: el agente arranca CON esta carpeta como cwd, y desde ahi el CLI lee y EJECUTA lo
// que la carpeta traiga — hooks de `.claude/settings.json`, servidores MCP declarados en el repo.
// Abrir el repositorio de un tercero es ejecutar codigo de un tercero. Esto es lo unico que se
// interpone.
//
// Deliberadamente NO se cierra al hacer clic fuera ni con Escape, al reves que los demas dialogos de
// Mage: la pregunta tiene dos respuestas y las dos tienen consecuencias, asi que se contesta. Un
// descarte accidental que cayera en "confiar" seria un agujero, y uno que cayera en "cancelar" dejaria
// al usuario sin saber por que no arranca su conversacion.
export function TrustFolderDialog(): React.JSX.Element {
  // Solo la PRIMERA de la cola: si dos pestañas de proyectos distintos arrancan a la vez, se contestan
  // de una en una en vez de apilar dialogos encima del anterior.
  const folder = useWorkbenchStore((s) => s.trustRequests[0] ?? null);
  const answerTrustRequest = useWorkbenchStore((s) => s.answerTrustRequest);
  const t = useT();
  const [trustParent, setTrustParent] = useState(false);
  const refuse = useRef<HTMLButtonElement>(null);
  useEffect(() => { setTrustParent(false); refuse.current?.focus(); }, [folder]);
  const pendientes = useWorkbenchStore((s) => s.trustRequests.length);

  return (
    <AnimatePresence>
      {folder !== null && (
        <motion.div
          variants={MODAL_SCRIM_VARIANTS}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim"
        >
          <motion.div
            variants={MODAL_PANEL_VARIANTS}
            role="dialog"
            aria-modal="true"
            aria-labelledby="trust-title"
            className="flex w-[460px] flex-col gap-[14px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
          >
            <div id="trust-title" className="text-[13px] font-bold text-mg-text">
              {t('dialogs.trustFolder.title')}
            </div>

            <div className="rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[8px_10px] font-mono text-[11.5px] break-all text-mg-body">
              {folder}
            </div>

            <div className="leading-[1.6] text-mg-body2">
              {t('dialogs.trustFolder.bodyIntro')} <b>{t('dialogs.trustFolder.bodyInside')}</b> {t('dialogs.trustFolder.bodyApplies')}{' '}
              <b>{t('dialogs.trustFolder.bodyHooks')}</b> {t('dialogs.trustFolder.bodyConfig')} <code>.claude/</code>{t('dialogs.trustFolder.bodyServers')} <b>MCP</b> {t('dialogs.trustFolder.bodyRisk')}
              <div className="mt-[8px] text-mg-muted">
                {t('dialogs.trustFolder.scopeNote')}
              </div>
            </div>

            {pendientes > 1 && (
              <div className="text-[11px] text-mg-muted">
                {t('dialogs.trustFolder.pending', { count: pendientes - 1 })}
              </div>
            )}

            <label className="flex items-center gap-2 text-mg-body">
              <input type="checkbox" checked={trustParent} onChange={event => setTrustParent(event.target.checked)} />
              {t('dialogs.trustFolder.trustParent')}
            </label>
            <div className="flex justify-end gap-[8px] pt-[2px]">
              {/* "No confiar" primero y con el foco inicial: ante la duda, la respuesta segura es la que
                  está a mano y la que se lleva un Enter distraído. */}
              <button
                ref={refuse}
                autoFocus
                onClick={() => void answerTrustRequest(folder, false)}
                className="rounded-[7px] border border-mg-border-emph px-[12px] py-[6px] text-mg-body transition-colors duration-150 ease-out hover:bg-mg-hover"
              >
                {t('dialogs.trustFolder.refuse')}
              </button>
              <button
                onClick={() => void answerTrustRequest(folder, true, trustParent)}
                className="rounded-[7px] border border-mg-border-emph bg-mg-sel px-[12px] py-[6px] font-bold text-mg-text transition-colors duration-150 ease-out hover:bg-mg-hover"
              >
                {t('dialogs.trustFolder.trust')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
