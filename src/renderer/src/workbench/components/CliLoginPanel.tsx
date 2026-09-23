import { useCallback, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { CliLoginStart, EmbeddedLoginResult } from '@shared/accounts';

// Interaccion de login por CLI (Fase 9.2), compartida por el alta de cuenta y el re-login de una
// cuenta caducada. Vive aparte porque son DOS dialogos: duplicar el campo del *code*, los avisos y el
// manejo de errores en cada uno seria la forma segura de que acaben divergiendo.
//
// El flujo es de dos pasos porque el usuario pega el *code* en medio: Mage arranca el CLI y abre su
// URL en ventana privada; el usuario autoriza, copia el *code* y lo pega aqui; Mage lo relaya por
// stdin y el CLI escribe la sesion. Mage nunca ve el token.

export type CliLoginPhase = 'idle' | 'starting' | 'awaitingCode' | 'submitting' | 'failed';

export interface CliLogin {
  readonly phase: CliLoginPhase;
  readonly start: CliLoginStart | null;
  readonly error: string | null;
  begin: (configDir: string, email: string | null) => void;
  submit: (code: string) => void;
  cancel: () => void;
}

// `onDone` se llama SOLO cuando el CLI confirma la sesion (`auth status --json`).
export function useCliLogin(onDone: (result: EmbeddedLoginResult) => void): CliLogin {
  const [phase, setPhase] = useState<CliLoginPhase>('idle');
  const [start, setStart] = useState<CliLoginStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  // El callback se guarda en un ref para que `begin`/`submit` no cambien de identidad en cada render
  // (si no, cualquier efecto que dependa de ellos se volveria a disparar sin motivo).
  const done = useRef(onDone);
  done.current = onDone;

  const begin = useCallback((configDir: string, email: string | null) => {
    setError(null);
    setPhase('starting');
    void window.mage
      .startLogin({ configDir, email })
      .then((started) => {
        setStart(started);
        setPhase('awaitingCode');
      })
      .catch((err: unknown) => {
        setError(describe(err));
        setPhase('failed');
      });
  }, []);

  const submit = useCallback((code: string) => {
    setError(null);
    setPhase('submitting');
    void window.mage
      .submitLoginCode(code)
      .then((result) => {
        if (result.status === 'ok') {
          setPhase('idle');
          done.current(result);
          return;
        }
        setError(reasonText(result));
        setPhase('failed');
      })
      .catch((err: unknown) => {
        setError(describe(err));
        setPhase('failed');
      });
  }, []);

  // Al cerrar el dialogo hay que MATAR el CLI: si no, queda un proceso esperando un *code* que ya
  // nadie va a pegar, y el siguiente intento se encuentra con "ya hay un login en curso".
  const cancel = useCallback(() => {
    setPhase('idle');
    setStart(null);
    setError(null);
    void window.mage.cancelLogin().catch(() => undefined); // cancelar nunca debe romper el cierre
  }, []);

  return { phase, start, error, begin, submit, cancel };
}

// Panel de "autoriza y pega el code". Presentacional: toda la logica vive en el hook.
export function CliLoginPanel({ login }: { readonly login: CliLogin }): React.JSX.Element | null {
  const [code, setCode] = useState('');
  if (login.phase === 'idle') return null;

  if (login.phase === 'starting') {
    return (
      <Box>
        <div className="flex items-center gap-[8px]">
          <Spinner />
          <span>Abriendo el inicio de sesión…</span>
        </div>
      </Box>
    );
  }

  // El login NUNCA llego a arrancar (auditoria B.1.6): `begin` fallo antes de darnos una URL, asi que
  // no hay navegador abierto ni proceso esperando. Sin esta rama caia al bloque general y pintaba
  // "autoriza en el navegador y pega aqui el codigo" con su campo — un formulario imposible de
  // rellenar. Aqui solo el error: reintentar lo ofrece cada dialogo (AddAccountDialog tiene su
  // "Reintentar"; NewTabDialog mantiene visible su "Iniciar sesion").
  if (login.start === null) {
    return (
      <Box>
        <div role="alert" className="text-[11px] text-mg-danger">
          {login.error ?? 'No se pudo iniciar el inicio de sesión.'}
        </div>
      </Box>
    );
  }

  const busy = login.phase === 'submitting';
  return (
    <Box>
      {login.start?.browser === 'normal' && (
        // No es un fallo, es un AVISO: sin navegador con ventana privada se abre el normal, y si ahi
        // ya hay sesion de otra cuenta, autorizar daria de alta la cuenta equivocada.
        <div role="alert" className="text-[10.5px] text-mg-warn">
          <Icon name="warning" size={12} /> No se encontró ningún navegador con ventana privada, así que se abrió el predeterminado. Si ya
          tenías la sesión de otra cuenta iniciada, <b>cierra sesión ahí antes de autorizar</b>.
        </div>
      )}
      <div>
        Autoriza la cuenta en el navegador (elige <b>suscripción</b>) y pega aquí el código que te dé.
      </div>
      <label className="flex flex-col gap-[6px]">
        <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">CÓDIGO</span>
        <input
          value={code}
          autoFocus
          disabled={busy}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && code.trim().length > 0 && login.submit(code)}
          placeholder="pega aquí el código"
          className="w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] font-mono text-mg-body outline-none disabled:opacity-50"
        />
      </label>
      <div className="flex items-center gap-[8px]">
        <button
          onClick={() => login.submit(code)}
          disabled={busy || code.trim().length === 0}
          className="rounded-[7px] bg-mg-primary px-[12px] py-[6px] font-semibold text-mg-primary-ink transition-opacity duration-150 ease-out disabled:opacity-40"
        >
          {busy ? 'Verificando…' : 'Continuar'}
        </button>
        {login.start !== null && (
          <button
            onClick={() => void navigator.clipboard.writeText(login.start?.authorizeUrl ?? '')}
            className="text-[10.5px] text-mg-ter underline hover:text-mg-body"
          >
            Copiar el enlace de login
          </button>
        )}
      </div>
      {login.error !== null && (
        <div role="alert" className="text-[11px] text-mg-danger">
          {login.error}
        </div>
      )}
    </Box>
  );
}

function Box({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[8px] rounded-[8px] border border-mg-sel bg-mg-block p-[10px_12px] text-[11.5px] leading-[1.55] text-mg-body2">
      {children}
    </div>
  );
}

function Spinner(): React.JSX.Element {
  return <span className="inline-block h-[12px] w-[12px] animate-spin rounded-full border-2 border-mg-ter border-t-transparent" />;
}

// Motivo no-ok en lenguaje de usuario. El `reason` del servicio es SEGURO por diseno (nunca lleva
// tokens), pero es jerga: aqui se traduce lo que el usuario puede ACCIONAR y se deja el codigo tecnico
// entre parentesis para poder pegarlo en un informe.
function reasonText(result: EmbeddedLoginResult): string {
  switch (result.reason) {
    case 'bad_code_format':
      return 'El código pegado no vale (no puede llevar espacios ni saltos de línea).';
    case 'auth_status_not_logged_in':
      return 'El CLI no registró la sesión: puede que el código fuera de otra cuenta o ya estuviera usado.';
    case 'no_login_in_progress':
      return 'El login se canceló antes de tiempo. Vuelve a intentarlo.';
    default:
      return `No se completó el inicio de sesión (${result.reason ?? result.status}).`;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : `Error desconocido: ${String(err)}`;
}
