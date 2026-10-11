// 秘密聊天的 MLS 运算：KeyPackage、建组、Welcome、提交、纪元密钥与签名。只在同步 Worker 里按需加载（ts-mls 约 690 KB）。
// MLS 只管成员与换密钥，消息用每个纪元导出的密钥加密，见 docs/adr/0010-secret-chats-multi-device-mls.md
import {
  acceptAll,
  createCommit,
  createGroup,
  decodeGroupState,
  decodeMlsMessage,
  defaultCapabilities,
  defaultKeyPackageEqualityConfig,
  defaultKeyRetentionConfig,
  defaultLifetime,
  defaultLifetimeConfig,
  defaultPaddingConfig,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroup,
  mlsExporter,
  processMessage,
  type CiphersuiteImpl,
  type ClientConfig,
  type ClientState,
  type KeyPackage,
  type PrivateKeyPackage,
  type Proposal,
} from 'ts-mls'
import { fromBase64, toBase64, type Leaf } from './format'

const SUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519'
/** 消息密钥的 exporter 标签 */
const EXPORTER_LABEL = 'web-chat secret message key'

let suite: Promise<CiphersuiteImpl> | null = null
const cs = () => (suite ??= getCiphersuiteImpl(getCiphersuiteFromName(SUITE)))

const enc = new TextEncoder()
const dec = new TextDecoder()

/** 凭证里的身份：[user_id, device_id] 的 JSON */
const identityOf = (userId: string, deviceId: string) => enc.encode(JSON.stringify([userId, deviceId]))

function parseIdentity(bytes: Uint8Array): [string, string] | null {
  try {
    const v = JSON.parse(dec.decode(bytes)) as unknown
    return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' ? [v[0], v[1]] : null
  } catch {
    return null
  }
}

/** 这个组的客户端配置：凭证必须是 [user_id, device_id]，并且 user_id 是会话双方之一 */
function configFor(pair: readonly string[]): ClientConfig {
  return {
    keyRetentionConfig: defaultKeyRetentionConfig,
    lifetimeConfig: defaultLifetimeConfig,
    keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
    paddingConfig: defaultPaddingConfig,
    authService: {
      async validateCredential(credential) {
        if (credential.credentialType !== 'basic') return false
        const id = parseIdentity(credential.identity)
        return id !== null && pair.includes(id[0])
      },
    },
  }
}

/** 一个 KeyPackage：data 为上传给服务端的 base64，secret 为本地保存的私钥与公开部分（还要再包一层才落库） */
export async function newKeyPackage(userId: string, deviceId: string): Promise<{ data: string; secret: Uint8Array }> {
  const kp = await generateKeyPackage(
    { credentialType: 'basic', identity: identityOf(userId, deviceId) },
    defaultCapabilities(),
    defaultLifetime,
    [],
    await cs(),
  )
  const wire = encodeMlsMessage({ keyPackage: kp.publicPackage, wireformat: 'mls_key_package', version: 'mls10' })
  const { initPrivateKey, hpkePrivateKey, signaturePrivateKey } = kp.privatePackage
  const secret = enc.encode(
    JSON.stringify({
      wire: toBase64(wire),
      init: toBase64(initPrivateKey),
      hpke: toBase64(hpkePrivateKey),
      sig: toBase64(signaturePrivateKey),
    }),
  )
  return { data: toBase64(wire), secret }
}

function decodeKeyPackage(data: string): KeyPackage {
  const msg = decodeMlsMessage(fromBase64(data), 0)?.[0]
  if (msg?.wireformat !== 'mls_key_package') throw new Error('not a key package')
  return msg.keyPackage
}

function openSecret(secret: Uint8Array): { publicPackage: KeyPackage; privatePackage: PrivateKeyPackage } {
  const v = JSON.parse(dec.decode(secret)) as { wire: string; init: string; hpke: string; sig: string }
  return {
    publicPackage: decodeKeyPackage(v.wire),
    privatePackage: { initPrivateKey: fromBase64(v.init), hpkePrivateKey: fromBase64(v.hpke), signaturePrivateKey: fromBase64(v.sig) },
  }
}

/** KeyPackage 里的身份，领到时核对它确实是要加入的那台设备 */
export function keyPackageIdentity(data: string): [string, string] | null {
  const kp = decodeKeyPackage(data)
  return kp.leafNode.credential.credentialType === 'basic' ? parseIdentity(kp.leafNode.credential.identity) : null
}

export function encodeState(state: ClientState): Uint8Array {
  return encodeGroupState(state)
}

export function decodeState(bytes: Uint8Array, pair: readonly string[]): ClientState {
  const decoded = decodeGroupState(bytes, 0)
  if (!decoded) throw new Error('bad group state')
  return { ...decoded[0], clientConfig: configFor(pair) }
}

export const epochOf = (state: ClientState) => Number(state.groupContext.epoch)

/** 组里的设备：叶子序号、身份与签名公钥 */
export function leavesOf(state: ClientState): Leaf[] {
  const leaves: Leaf[] = []
  state.ratchetTree.forEach((node, i) => {
    if (node?.nodeType !== 'leaf' || node.leaf.credential.credentialType !== 'basic') return
    const id = parseIdentity(node.leaf.credential.identity)
    if (id) leaves.push({ index: i / 2, user_id: id[0], device_id: id[1], sig: toBase64(node.leaf.signaturePublicKey) })
  })
  return leaves
}

/** 这个纪元的消息密钥（32 字节，AES-256-GCM） */
export async function epochKey(state: ClientState, chatId: string): Promise<Uint8Array> {
  return mlsExporter(state.keySchedule.exporterSecret, EXPORTER_LABEL, enc.encode(chatId), 32, await cs())
}

/** 发起者建组并把 keyPackages 里的设备一起加入：返回纪元 1 的状态与 Welcome */
export async function create(
  chatId: string,
  pair: readonly string[],
  userId: string,
  deviceId: string,
  keyPackages: string[],
): Promise<{ state: ClientState; welcome: string }> {
  const suite = await cs()
  const own = await generateKeyPackage({ credentialType: 'basic', identity: identityOf(userId, deviceId) }, defaultCapabilities(), defaultLifetime, [], suite)
  const group = await createGroup(enc.encode(chatId), own.publicPackage, own.privatePackage, [], suite, configFor(pair))
  const adds: Proposal[] = keyPackages.map((data) => ({ proposalType: 'add', add: { keyPackage: decodeKeyPackage(data) } }))
  const res = await createCommit({ state: group, cipherSuite: suite }, { extraProposals: adds, ratchetTreeExtension: true })
  return { state: res.newState, welcome: toBase64(encodeMlsMessage({ welcome: res.welcome!, wireformat: 'mls_welcome', version: 'mls10' })) }
}

/** 凭 Welcome 加入；本地的 KeyPackage 里哪一个对得上不知道，挨个试，返回用上的那个的序号 */
export async function join(welcome: string, secrets: Uint8Array[], pair: readonly string[]): Promise<{ state: ClientState; used: number } | null> {
  const msg = decodeMlsMessage(fromBase64(welcome), 0)?.[0]
  if (msg?.wireformat !== 'mls_welcome') throw new Error('not a welcome')
  const suite = await cs()
  for (const [i, secret] of secrets.entries()) {
    const { publicPackage, privatePackage } = openSecret(secret)
    try {
      const state = await joinGroup(msg.welcome, publicPackage, privatePackage, emptyPskIndex, suite, undefined, undefined, configFor(pair))
      return { state, used: i }
    } catch {
      // 不是这个 KeyPackage
    }
  }
  return null
}

/** 提交：加入 keyPackages 里的设备、移除 removes 里的叶子 */
export async function commit(
  state: ClientState,
  keyPackages: string[],
  removes: number[],
): Promise<{ state: ClientState; commit: string; welcome?: string }> {
  const proposals: Proposal[] = [
    ...removes.map((leaf): Proposal => ({ proposalType: 'remove', remove: { removed: leaf } })),
    ...keyPackages.map((data): Proposal => ({ proposalType: 'add', add: { keyPackage: decodeKeyPackage(data) } })),
  ]
  const res = await createCommit({ state, cipherSuite: await cs() }, { extraProposals: proposals, ratchetTreeExtension: true })
  return {
    state: res.newState,
    commit: toBase64(encodeMlsMessage(res.commit)),
    ...(res.welcome ? { welcome: toBase64(encodeMlsMessage({ welcome: res.welcome, wireformat: 'mls_welcome', version: 'mls10' })) } : {}),
  }
}

/** 处理别人的提交，返回新纪元的状态 */
export async function apply(state: ClientState, data: string): Promise<ClientState> {
  const msg = decodeMlsMessage(fromBase64(data), 0)?.[0]
  if (msg?.wireformat !== 'mls_private_message' && msg?.wireformat !== 'mls_public_message') throw new Error('not a commit')
  const res = await processMessage(msg, state, emptyPskIndex, acceptAll, await cs())
  if (res.kind !== 'newState') throw new Error('not a commit')
  return res.newState
}

/** 本设备的叶子序号 */
export const ownLeaf = (state: ClientState) => state.privatePath.leafIndex

export async function sign(state: ClientState, message: Uint8Array): Promise<Uint8Array> {
  return (await cs()).signature.sign(state.signaturePrivateKey, message)
}

export async function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  return (await cs()).signature.verify(publicKey, message, signature)
}
