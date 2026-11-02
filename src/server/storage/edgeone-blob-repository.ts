import type { RecordKind } from '../../shared/types';
import type { RecordRepository, StoredRecord } from './repository';

export interface EdgeOneBlobStoreLike {
  get(key: string): Promise<string | { text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{
    objects: Array<{ key: string }>;
    truncated?: boolean;
    cursor?: string;
  }>;
}

const PREFIX = 'nonebotmaker/records/';

export class EdgeOneBlobRepository implements RecordRepository {
  readonly consistency = 'provider-defined' as const;

  constructor(private readonly blob: EdgeOneBlobStoreLike) {}

  async list(kind: RecordKind): Promise<StoredRecord[]> {
    const prefix = `${PREFIX}${kind}/`;
    const records: StoredRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.blob.list({ prefix, limit: 1000, cursor });
      const values = await Promise.all(page.objects.map(async ({ key }) => {
        const value = await this.blob.get(key);
        if (value === null) return null;
        const text = typeof value === 'string' ? value : await value.text();
        return JSON.parse(text) as StoredRecord;
      }));
      records.push(...values.filter((record): record is StoredRecord => record !== null));
      cursor = page.truncated ? page.cursor : undefined;
      if (page.truncated && !cursor) throw new Error('The configured blob adapter returned a truncated page without a cursor.');
    } while (cursor);
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async get(kind: RecordKind, id: string): Promise<StoredRecord | null> {
    const value = await this.blob.get(this.key(kind, id));
    if (value === null) return null;
    const text = typeof value === 'string' ? value : await value.text();
    return JSON.parse(text) as StoredRecord;
  }

  async put(kind: RecordKind, record: StoredRecord): Promise<void> {
    await this.blob.put(this.key(kind, record.id), JSON.stringify(record));
  }

  async delete(kind: RecordKind, id: string): Promise<void> {
    await this.blob.delete(this.key(kind, id));
  }

  private key(kind: RecordKind, id: string): string {
    return `${PREFIX}${kind}/${encodeURIComponent(id)}`;
  }
}
