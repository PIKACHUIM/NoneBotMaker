import type { KVNamespaceLike, RecordKind } from '../../shared/types';
import type { RecordRepository, StoredRecord } from './repository';

const PREFIX = 'nonebotmaker:records:';

export class KVRepository implements RecordRepository {
  readonly consistency = 'eventual' as const;

  constructor(protected readonly kv: KVNamespaceLike) {}

  async list(kind: RecordKind): Promise<StoredRecord[]> {
    if (!this.kv.list) throw new Error('The configured KV adapter does not support listing keys.');

    const prefix = `${PREFIX}${kind}:`;
    const values: StoredRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix, limit: 1000, cursor });
      const records = await Promise.all(page.keys.map(async ({ name }) => {
        const value = await this.kv.get(name);
        return value ? (JSON.parse(value) as StoredRecord) : null;
      }));
      values.push(...records.filter((record): record is StoredRecord => record !== null));
      cursor = page.list_complete ? undefined : page.cursor;
      if (!page.list_complete && !cursor) throw new Error('The configured KV adapter returned an incomplete page without a cursor.');
    } while (cursor);

    return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async get(kind: RecordKind, id: string): Promise<StoredRecord | null> {
    const value = await this.kv.get(this.key(kind, id));
    return value ? (JSON.parse(value) as StoredRecord) : null;
  }

  async put(kind: RecordKind, record: StoredRecord): Promise<void> {
    await this.kv.put(this.key(kind, record.id), JSON.stringify(record));
  }

  async delete(kind: RecordKind, id: string): Promise<void> {
    await this.kv.delete(this.key(kind, id));
  }

  protected key(kind: RecordKind, id: string): string {
    return `${PREFIX}${kind}:${encodeURIComponent(id)}`;
  }
}
