// Starts the helper together with the Vite dev server (and `vite preview`), so the user runs one command and
// never thinks about it. If another helper already owns the port, that one is used. The page's own address is
// added to the allowed origins once the server knows which port it really got.

import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { DEFAULT_ORIGINS, HELPER_PORT } from './config.ts';
import { startHelper } from './server.ts';
import type { RunningHelper } from './server.ts';
import { createWebService } from './service.ts';

export function helperPlugin(): Plugin {
  let helper: RunningHelper | null = null;
  let starting: Promise<void> | null = null;

  function attach(server: ViteDevServer | PreviewServer, label: string): void {
    const http = server.httpServer;
    if (!http) return;
    const info = (msg: string): void => server.config.logger.info(`  [helper] ${msg}`);

    const start = async (): Promise<void> => {
      const origins = new Set(DEFAULT_ORIGINS);
      const address = http.address();
      if (address && typeof address === 'object') {
        origins.add(`http://localhost:${address.port}`);
        origins.add(`http://127.0.0.1:${address.port}`);
      }
      helper = await startHelper({ service: createWebService(), port: HELPER_PORT, origins, log: () => undefined });
      info(helper ? `web search and page reading ready at http://127.0.0.1:${helper.port} (this machine only)` : `port ${HELPER_PORT} already in use, using the helper that is running`);
    };
    const run = (): void => {
      starting ??= start().catch((err: unknown) => info(`could not start (${String(err)}); the app works without web tools`));
    };
    if (http.listening) run();
    else http.once('listening', run);
    http.once('close', () => {
      void helper?.close();
      helper = null;
      starting = null;
    });
    void label;
  }

  return {
    name: 'agent-office-helper',
    configureServer(server) {
      attach(server, 'dev');
    },
    configurePreviewServer(server) {
      attach(server, 'preview');
    },
  };
}
