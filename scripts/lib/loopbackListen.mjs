// Escucha en un puerto efímero de loopback que `fetch`/Chromium acepten. El sistema puede asignar un puerto de la
// lista bloqueada (en Windows el rango dinámico empieza en 1024) y el cliente fallaría con «bad port»: se suelta y
// se pide otro, con intentos acotados. Lo mismo que hace `LoopbackCallback.listen` en
// `src/main/runtime/mcp/mcpSdk.ts` para el login OAuth de MCP.

// Puertos que Fetch/Chromium rechazan («bad port»). Fetch Standard, «port blocking», consultado el
// 24-10-2026: https://fetch.spec.whatwg.org/#port-blocking
export const FETCH_BLOCKED_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109,
  110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060,
  5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

const EPHEMERAL_PORT = 0;
const LOOPBACK_HOST = '127.0.0.1';

// `server`: un `http.Server` (o algo con su `listen`/`address`/`close`) sin escuchar. Devuelve el puerto.
export async function listenLoopback(server, { attempts = 8 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await listenOnce(server);
    const { port } = server.address();
    if (!FETCH_BLOCKED_PORTS.has(port)) return port;
    await new Promise((resolve) => server.close(resolve));
  }
  throw new Error(`listenLoopback: ningún puerto libre de la lista bloqueada tras ${attempts} intentos`);
}

function listenOnce(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(EPHEMERAL_PORT, LOOPBACK_HOST, () => {
      server.off('error', onError);
      resolve();
    });
  });
}
