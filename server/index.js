import fs from 'node:fs/promises';
import path from 'node:path';

import { ActionRunner } from './actions.js';
import { loadConsoleConfig } from './config.js';
import { createConsoleServer } from './http.js';
import { createCsrfToken } from './security.js';
import { createSnapshotService } from './snapshot.js';

const config = loadConsoleConfig();
const snapshotService = createSnapshotService(config);
const actionRunner = new ActionRunner({ config, snapshotService });
const csrfToken = createCsrfToken();
const server = createConsoleServer({
  config,
  snapshotService,
  actionRunner,
  csrfToken,
  staticDir: path.join(config.rootDir, 'web', 'dist')
});

await fs.mkdir(config.dataDir, { recursive: true });

server.listen(config.port, config.bindHost, () => {
  console.log(`Autofix Console: http://${config.bindHost}:${config.port}`);
  console.log(`状态目录: ${config.runsDir}`);
});

async function shutdown(signal) {
  console.log(`收到 ${signal}，正在关闭控制台`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
