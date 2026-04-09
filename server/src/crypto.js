import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const NONCE_LENGTH = 12

/**
 * Generate a new AES-256-GCM key
 */
export function generateKey() {
  return crypto.randomBytes(KEY_LENGTH)
}

/**
 * Generate a random nonce for AES-GCM
 */
export function generateNonce() {
  return crypto.randomBytes(NONCE_LENGTH)
}

/**
 * Encrypt content with AES-256-GCM
 * @param {string} plaintext - Content to encrypt
 * @param {Buffer} key - 32-byte key
 * @returns {{ ciphertext: string, nonce: string, tag: string }}
 */
export function encrypt(plaintext, key) {
  const nonce = generateNonce()
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: encrypted.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
  }
}

/**
 * Decrypt content with AES-256-GCM
 * @param {string} ciphertext - Base64 encoded ciphertext
 * @param {string} nonce - Base64 encoded nonce
 * @param {string} tag - Base64 encoded auth tag
 * @param {Buffer} key - 32-byte key
 * @returns {string} Decrypted plaintext
 */
export function decrypt(ciphertext, nonce, tag, key) {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(nonce, 'base64')
  )
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

/**
 * Generate a conversation key for two agents
 * Derives a shared key from two public keys (ECDH-style but using RSA)
 * For simplicity: hash of concatenated public key fingerprints
 */
export function deriveConversationKey(publicKeyA, publicKeyB) {
  const sorted = [publicKeyA, publicKeyB].sort()
  return crypto.createHash('sha256').update(sorted.join('')).digest()
}

/**
 * Generate a short unique ID
 */
export function genId(prefix = '') {
  const ts = Date.now().toString(36)
  const rand = crypto.randomBytes(4).toString('hex')
  return `${prefix}${ts}_${rand}`
}
