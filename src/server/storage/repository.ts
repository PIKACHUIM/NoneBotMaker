import type { RecordKind, RuntimeBindings } from '../../shared/types';
import { D1Repository } from './d1-repository';
import { EdgeOneBlobRepository } from './edgeone-blob-repository';
import { EdgeOneKVRepository } from './edgeone-kv-repository';
import { EsaKVRepository } from './esa-kv-repository';
import { KVRepository } from './kv-repository';

export type StoredRecord = Record<string, unknown> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export interface RecordRepository {
  readonly consistency: 'eventual' | 'provider-defined';
  list(kind: RecordKind): Promise<StoredRecord[]>;
  get(kind: RecordKind, id: string): Promise<StoredRecord | null>;
  put(kind: RecordKind, record: StoredRecord): Promise<void>;
  delete(kind: RecordKind, id: string): Promise<void>;
}

export class StorageUnavailableError extends Error {
  constructor() {
    super('Persistent storage is not configured.');
    this.name = 'StorageUnavailableError';
  }
}

export function createRepository(bindings: RuntimeBindings): RecordRepository {
  if (bindings.DB) return new D1Repository(bindings.DB);

  if (bindings.PLATFORM === 'edgeone') {
    const blob = bindings.EDGEONE_BLOB as ConstructorParameters<typeof EdgeOneBlobRepository>[0] | undefined;
    if (blob) return new EdgeOneBlobRepository(blob);
    const kv = bindings.EDGEONE_KV as RuntimeBindings['KV'] | undefined;
    if (kv) return new EdgeOneKVRepository(kv);
  }

  if (bindings.PLATFORM === 'esa') {
    const kv = (bindings.ESA_KV ?? bindings.KV) as RuntimeBindings['KV'] | undefined;
    if (kv) return new EsaKVRepository(kv);
  }

  if (bindings.KV) return new KVRepository(bindings.KV);
  throw new StorageUnavailableError();
}
