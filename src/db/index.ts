/**
 * `src/db/` 统一出口。
 *
 * 用法约定：仓储层函数用命名空间导入，避免与业务方法重名。
 *
 * @example
 * ```ts
 * import { recordsRepo, samplesRepo } from '@/db';
 * await recordsRepo.add(record);
 * ```
 */

import * as recordsRepo from './recordsRepo';
import * as samplesRepo from './samplesRepo';
import * as calibrationRepo from './calibrationRepo';
import * as kvRepo from './kvRepo';
import * as expTableRepo from './expTableRepo';

export { recordsRepo, samplesRepo, calibrationRepo, kvRepo, expTableRepo };

export {
  MapLogDatabase,
  getDb,
  closeDb,
  deleteDb,
  DB_NAME,
  DB_VERSION,
} from './database';
