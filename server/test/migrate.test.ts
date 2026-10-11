import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { migrate } from '../src/sql'
import { uid } from './helpers'

describe('migrate', () => {
  it('只执行比版本号新的步骤，写入不计入 rowsWritten；版本一致时什么都不做', async () => {
    const stub = env.CHAT.get(env.CHAT.idFromName(uid()))
    await runInDurableObject(stub, (o, state) => {
      const before = o.sql.rowsWritten
      // 第 1 步已由 ChatDO 执行过：再执行一次会因为表已存在而失败
      const steps = [['CREATE TABLE info (key TEXT)'], ['CREATE TABLE t (a INTEGER)', 'INSERT INTO t VALUES (1)']]
      migrate(state.storage, steps)
      expect(state.storage.sql.exec('SELECT a FROM t').toArray()).toEqual([{ a: 1 }])
      migrate(state.storage, steps)
      expect(state.storage.sql.exec('SELECT a FROM t').toArray()).toEqual([{ a: 1 }])
      expect(o.sql.rowsWritten).toBe(before)
    })
  })

  it('某一步失败时整体回滚，版本号不变', async () => {
    const stub = env.CHAT.get(env.CHAT.idFromName(uid()))
    await runInDurableObject(stub, (_o, state) => {
      const steps = [[], ['CREATE TABLE t (a INTEGER)', 'not sql']]
      expect(() => migrate(state.storage, steps)).toThrow()
      expect(state.storage.sql.exec("SELECT name FROM sqlite_schema WHERE name = 't'").toArray()).toEqual([])
      expect(() => migrate(state.storage, [[], ['CREATE TABLE t (a INTEGER)']])).not.toThrow()
    })
  })

  it('版本号比代码新时拒绝启动', async () => {
    const stub = env.CHAT.get(env.CHAT.idFromName(uid()))
    await runInDurableObject(stub, (_o, state) => {
      expect(() => migrate(state.storage, [])).toThrow(/newer than the code/)
    })
  })
})
