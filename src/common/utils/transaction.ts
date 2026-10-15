import { ClientSession, Connection } from 'mongoose';

/**
 * Runs `fn` inside a MongoDB transaction (requires a replica set). The driver retries on
 * transient errors, so `fn` must only touch the database through the given session.
 */
export async function withTransaction<T>(
  connection: Connection,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
