/**
 * Local MongoDB single-node replica set for development (transactions need a replica set).
 * Data persists in ./.mongo-data. Use this when Docker/Atlas is not available:
 *   npm run db:dev      # keep it running in a separate terminal
 * MONGODB_URI=mongodb://127.0.0.1:27017/brandak?replicaSet=rs0
 */
import { mkdirSync } from 'fs';
import { join } from 'path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

async function main() {
  const dbPath = join(process.cwd(), '.mongo-data');
  mkdirSync(dbPath, { recursive: true });
  const replSet = await MongoMemoryReplSet.create({
    replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ port: 27017, dbPath }],
  });
  console.log(`MongoDB replica set ready: ${replSet.getUri('brandak')}`);
  const stop = async () => {
    await replSet.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
