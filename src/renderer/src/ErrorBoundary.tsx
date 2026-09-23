import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
  readonly info: ErrorInfo | null;
}

// Red de seguridad del renderer: si cualquier componente lanza al montar/renderizar, en vez de
// dejar la ventana en negro (React desmonta todo el arbol) pintamos el error en pantalla. Ademas
// lo reenvia al proceso main para que aparezca en la ventana de debug (Tarea 1b), si esta cableada.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info });
    // Reenvio al bus de logs de main (si el preload lo expone). No romper si aun no existe.
    window.mageDebug?.reportRendererLog?.({
      level: 'error',
      message: error.message,
      data: { stack: error.stack, componentStack: info.componentStack },
    });
  }

  override render(): ReactNode {
    const { error, info } = this.state;
    if (error === null) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          height: '100%',
          overflow: 'auto',
          padding: '24px',
          // Referencia a las variables del tema: aunque ErrorBoundary vive fuera del store, las
          // variables CSS estan en :root y conmutan con data-theme, asi que el error se ve bien en ambos.
          background: 'var(--color-mg-window)',
          color: 'var(--color-mg-body)',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: '12px',
          lineHeight: 1.6,
        }}
      >
        <h1 style={{ color: 'var(--color-mg-text)', fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>
          Mage — el renderer ha fallado al montar
        </h1>
        <p style={{ color: 'var(--color-mg-danger)', marginBottom: '12px' }}>{error.message}</p>
        <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--color-mg-ter)' }}>{error.stack}</pre>
        {info?.componentStack !== undefined && info.componentStack !== null && (
          <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--color-mg-muted)', marginTop: '12px' }}>
            {info.componentStack}
          </pre>
        )}
      </div>
    );
  }
}
