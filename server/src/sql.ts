/**
 * DO SQLite 的薄封装：累计 rowsWritten，供测试断言每个操作的写入行数（见 08 § 每操作成本）。
 */
export class Sql {
  rowsWritten = 0

  constructor(private readonly sql: SqlStorage) {}

  /** 读取：返回全部行 */
  all<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): T[] {
    return this.sql.exec<T>(query, ...bindings).toArray()
  }

  one<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): T | undefined {
    return this.all<T>(query, ...bindings)[0]
  }

  /** 惰性游标：用于提前终止的尾部扫描 */
  cursor<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]) {
    return this.sql.exec<T>(query, ...bindings)
  }

  /** 写入：执行并累计写入行数 */
  run(query: string, ...bindings: unknown[]): void {
    const cursor = this.sql.exec(query, ...bindings)
    cursor.toArray()
    this.rowsWritten += cursor.rowsWritten
  }
}

/** 表结构版本号存在 DO 的 KV 里：DO SQLite 不允许 PRAGMA user_version */
const SCHEMA_VERSION_KEY = 'schema_version'

/**
 * 执行还没执行过的迁移：migrations[i] 把表结构从版本 i 升到 i + 1，版本一致时什么都不做。
 * 整体在一个事务里完成；直接用底层的 SqlStorage，写入不计入 rowsWritten。
 * 1.0 起只能在末尾追加新的步骤，不能修改已有的（见 ADR-0013）
 */
export function migrate(storage: DurableObjectStorage, migrations: readonly (readonly string[])[]) {
  const version = storage.kv.get<number>(SCHEMA_VERSION_KEY) ?? 0
  if (version === migrations.length) return
  if (version > migrations.length) throw new Error(`schema version ${version} is newer than the code (${migrations.length})`)
  storage.transactionSync(() => {
    for (const step of migrations.slice(version)) for (const query of step) storage.sql.exec(query)
    storage.kv.put(SCHEMA_VERSION_KEY, migrations.length)
  })
}
