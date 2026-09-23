// Geometria de la marca de Mage. GENERADA por `pnpm brand` a partir del arte de origen
// (design/my-mage-icon.png). NO se edita a mano: si cambia el icono, se vuelve a generar.
//
// Es el mismo dibujo que el icono de la aplicacion, para que la esquina superior izquierda y el icono
// de la barra de tareas sean uno solo. Un unico camino con los huecos calados (evenodd), asi que vale
// sobre cualquier superficie y hereda el color del contenedor.
export const MARK_VIEWBOX = '0 0 32 32';

export const MARK_TRANSFORM = 'translate(-11.44 -1.29) scale(0.027561000000000002)';

export const MARK_PATH =
  'M702 238L876 310L998 321L1058 383L1139 557L1210 595L1228 683L1536 747L1547 776L1503 817L1395 883L1262 933L1097 974L871 1003L640 1017L572 1015L448 982L444 944L657 790L1014 717L892 718L710 758L705 674L735 650L960 541L812 591L736 628L705 593L722 506L804 403L710 490L673 490L664 475L668 378L644 459L574 490L527 466L574 530L539 636L519 650L501 650L486 637L452 483L453 433L493 375L702 239Z';

// Cintura de la chispa de cuatro puntas que dibuja la constelacion del chat vacio. MEDIDA sobre el
// arte ANTERIOR (el mago entero): el vertice interior caia a 22 px del centro en la diagonal, con un
// radio de 38,5 px -> 22·cos45°/38,5 = 0,404. PENDIENTE de re-medir sobre el arte nuevo, donde la
// estrella es una concavidad del sombrero y no una chispa suelta: hasta entonces el valor se conserva
// porque es el que hay medido, no porque se haya comprobado contra este dibujo.
export const SPARKLE_WAIST_RATIO = 0.404;
