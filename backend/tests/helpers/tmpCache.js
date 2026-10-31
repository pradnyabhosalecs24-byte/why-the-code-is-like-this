// Give each test file its own snapshot cache directory so parallel test files never collide.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TRACEWHY_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tracewhy-test-'));
