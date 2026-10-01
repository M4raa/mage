import { useState } from 'react';
import { AGY_DEFAULT_LINKED_PATHS, validateAgyLinkPath } from '@shared/agyRules';
import { useWorkbenchStore } from '../../workbenchStore';
import { Icon } from '../Icon';

// Carpetas de tu casa que agy ve desde su perfil de Mage (grupo E, fase 2). agy corre con un perfil
// propio para que las reglas de Mage no toquen tu configuracion; lo que vive en tu casa y agy necesita
// (su config con MCP y skills, las claves SSH, las de tus herramientas) se le enlaza. Solo carpetas.
export function AgyProfileLinks(): React.JSX.Element {
  const extra = useWorkbenchStore((s) => s.settings.agyLinkedPaths);
  const setPaths = useWorkbenchStore((s) => s.setAgyLinkedPaths);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (): void => {
    const checked = validateAgyLinkPath(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    if (![...AGY_DEFAULT_LINKED_PATHS, ...extra].includes(checked.path)) setPaths([...extra, checked.path]);
    setDraft('');
    setError(null);
  };

  return (
    <div className="flex flex-col gap-[6px] text-[11px] text-mg-sec" data-agy-profile-links="true">
      <div>
        Carpetas de tu usuario que agy ve desde su perfil de Mage (se enlazan, no se copian). Siempre{' '}
        {AGY_DEFAULT_LINKED_PATHS.map((path, index) => (
          <span key={path}>
            {index > 0 && ' y '}
            <code>~/{path}</code>
          </span>
        ))}
        ; añade las de tus herramientas (p. ej. <code>.aws</code>). Se aplican al lanzar agy.
      </div>
      {extra.length > 0 && (
        <ul className="flex flex-wrap gap-[4px]">
          {extra.map((path) => (
            <li key={path} className="flex items-center gap-[4px] rounded-[5px] border border-mg-border-subtle bg-mg-window px-[6px] py-[1px]">
              <code className="text-mg-body">~/{path}</code>
              <button onClick={() => setPaths(extra.filter((entry) => entry !== path))} aria-label={`Dejar de enlazar ${path}`} className="text-mg-muted hover:text-mg-danger">
                <Icon name="trash" size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-[6px]">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          aria-label="Carpeta extra para el perfil de agy"
          placeholder=".aws"
          className="w-[180px] rounded-[7px] border border-mg-border-ctrl bg-mg-window px-[8px] py-[3px] font-mono text-[11px] text-mg-text"
        />
        <button onClick={add} className="rounded-[7px] border border-mg-border-emph px-[10px] py-[3px] text-[11px] text-mg-body2 hover:bg-mg-hover">
          Enlazar
        </button>
        {error !== null && (
          <span role="alert" className="text-mg-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
