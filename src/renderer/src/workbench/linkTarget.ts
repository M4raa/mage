// Adónde va un enlace del chat. Como Claude Desktop: el clic normal, al navegador de Mage; Ctrl/Cmd o el clic central, al del
// sistema. El ajuste `linksOpenExternally` lo invierte. Sin sesión o sin http/https, siempre fuera.
export type LinkDestination = 'internal' | 'external';

export interface LinkClick {
  readonly href: string;
  readonly modifier: boolean; // Ctrl o Cmd pulsado, o clic central
  readonly invert: boolean; // ajuste linksOpenExternally
  readonly hasSession: boolean;
}

const WEB_LINK = /^https?:\/\//i;

export function linkDestination(click: LinkClick): LinkDestination {
  if (!click.hasSession || !WEB_LINK.test(click.href)) return 'external';
  return click.modifier === click.invert ? 'internal' : 'external';
}
