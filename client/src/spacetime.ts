import { DbConnection } from './module_bindings';

export const SPACETIMEDB_URI = import.meta.env.VITE_SPACETIMEDB_URI ?? 'ws://127.0.0.1:3000';
export const SPACETIMEDB_DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'pranavtallapaka';

export const spacetimeConnectionBuilder = DbConnection.builder()
  .withUri(SPACETIMEDB_URI)
  .withDatabaseName(SPACETIMEDB_DB_NAME)
  .onConnectError((_ctx, err) => {
    console.warn(`SpacetimeDB: ${err.message}`);
  });
