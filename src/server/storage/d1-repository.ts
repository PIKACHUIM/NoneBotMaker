import type { D1DatabaseLike, RecordKind } from '../../shared/types';
import type { RecordRepository, StoredRecord } from './repository';

interface RecordRow {
  id: string;
  value: string;
}

export class D1Repository implements RecordRepository {
  readonly consistency = 'eventual' as const;

  constructor(private readonly db: D1DatabaseLike) {}

  async list(kind: RecordKind): Promise<StoredRecord[]> {
    const result = await this.db
      .prepare('SELECT id, value FROM records WHERE kind = ? ORDER BY updated_at DESC, id ASC')
      .bind(kind)
      .all<RecordRow>();
    return (result.results ?? []).map((row) => JSON.parse(row.value) as StoredRecord);
  }

  async get(kind: RecordKind, id: string): Promise<StoredRecord | null> {
    const row = await this.db
      .prepare('SELECT value FROM records WHERE kind = ? AND id = ? LIMIT 1')
      .bind(kind, id)
      .first<{ value: string }>();
    return row ? (JSON.parse(row.value) as StoredRecord) : null;
  }

  async put(kind: RecordKind, record: StoredRecord): Promise<void> {
    await this.db
      .prepare('INSERT INTO records (kind, id, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind(kind, record.id, JSON.stringify(record), record.updatedAt)
      .run();
  }

  async delete(kind: RecordKind, id: string): Promise<void> {
    await this.db.prepare('DELETE FROM records WHERE kind = ? AND id = ?').bind(kind, id).run();
  }
}
