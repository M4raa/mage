import { useState } from 'react';
import { prKeyToString, type PrKey } from '@shared/pr';
import { useWorkbenchStore } from '../../workbenchStore';
import { useT } from '../../../i18n/uiLanguage';
import { BUTTON } from './PrPieces';

// Parche de la PR: texto monoespaciado con las lineas `+`/`-` coloreadas con los tokens de diff. Se pide
// al pulsar «Ver diff» (puede ser grande) y main lo recorta si pasa del tope (`truncated`).

const MAX_HEIGHT_PX = 320;

// Las cabeceras `+++`/`---` no son lineas añadidas ni quitadas.
function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-mg-ter';
  if (line.startsWith('+')) return 'bg-mg-diff-add-bg text-mg-diff-add';
  if (line.startsWith('-')) return 'bg-mg-diff-del-bg text-mg-diff-del';
  return 'text-mg-sec';
}

export function PrDiff({ tabId, prKey }: { readonly tabId: string; readonly prKey: PrKey }): React.JSX.Element {
  const t = useT();
  const key = prKeyToString(prKey);
  const diff = useWorkbenchStore((s) => s.prDiffByKey[key]);
  const loadPrDiff = useWorkbenchStore((s) => s.loadPrDiff);
  const [shown, setShown] = useState(false);
  const toggle = (): void => {
    if (!shown && diff === undefined) void loadPrDiff(tabId, prKey);
    setShown(!shown);
  };
  return (
    <div className="flex flex-col gap-[4px]">
      <button data-pr-action="diff" aria-expanded={shown} aria-label={shown ? t('pr.hideDiff') : t('pr.diff')} onClick={toggle} className={`${BUTTON} self-start`}>
        {shown ? t('pr.hideDiff') : t('pr.diff')}
      </button>
      {shown && diff !== undefined && (
        <>
          {diff.truncated && <span className="text-[10.5px] text-mg-danger">{t('pr.diffTruncated')}</span>}
          <pre data-pr-diff style={{ maxHeight: MAX_HEIGHT_PX }} className="overflow-auto rounded-[6px] border border-mg-border-subtle bg-mg-code py-[6px] font-mono text-[10.5px] leading-[1.55]">
            {diff.patch.split('\n').map((line, index) => (
              <div key={index} className={`px-[8px] whitespace-pre ${lineClass(line)}`}>
                {line.length === 0 ? ' ' : line}
              </div>
            ))}
          </pre>
        </>
      )}
    </div>
  );
}
