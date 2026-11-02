import type { KVNamespaceLike } from '../../shared/types';
import { KVRepository } from './kv-repository';

export class EsaKVRepository extends KVRepository {
  constructor(kv: KVNamespaceLike) {
    super(kv);
  }
}
