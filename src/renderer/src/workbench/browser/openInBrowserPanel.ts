// Abre una URL o un fichero en el navegador de Mage de una sesión y enseña el panel. Lo usan el panel Ficheros y los enlaces del chat.
export async function openInBrowserPanel(sessionId: string, url: string): Promise<void> {
  await window.mage.browserNavigate({ sessionId, url });
  // Import dinámico, como en browserStore: panelLayoutStore importa el registro de paneles.
  const { usePanelLayoutStore } = await import('../panelLayoutStore');
  usePanelLayoutStore.getState().revealPanelById('browser');
}
