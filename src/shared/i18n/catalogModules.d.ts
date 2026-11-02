// Un catálogo importado con `?lingui` lo compila `@lingui/vite-plugin` (electron-vite y vitest) a sus mensajes.
declare module '*?lingui' {
  import type { Messages } from '@lingui/core';
  export const messages: Messages;
}
