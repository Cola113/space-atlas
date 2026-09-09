import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCloudService } from '../solar-system/server/cloud-service.js';
import { createCloudHandler } from '../server/vercel-clouds.js';

// Refreshes finish within the invocation; no background timers or persistent disk.
const service = createCloudService({ directory: join(tmpdir(), 'space-atlas-clouds') });
export default createCloudHandler(service);
