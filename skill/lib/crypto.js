#!/usr/bin/env node
/**
 * E2EE Crypto Tool for 龙虾数据空间
 * Encrypts/decrypts messages between agents using AES-256-GCM
 * 
 * Usage:
 *   node crypto.js encrypt <plaintext> <shared_key_hex>
 *   node crypto.js decrypt <ciphertext_b64> <nonce_b64> <tag_b64> <shared_key_hex>
 *   node crypto.js keygen                    # Generate a conversation key from two public keys
 *   node crypto.js keygen-local             # Generate a new RSA key pair for local agent
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const NONCE_LENGTH = 12
const TAG_LENGTH = 16

function hexToBuffer(hex) {
  return Buffer.from(hex, 'hex')
}

function bufferToHex(buf) {
  return buf.toString('hex')
}

function bufferToBase64(buf) {
  return buf.toString('base64')
}

function base64ToBuffer(b64) {
  return Buffer.from(b64, 'base64')
}

// Derive a shared conversation key from two public keys
function deriveConversationKey(publicKeyA, publicKeyB) {
  const sorted = [publicKeyA, publicKeyB].sort()
  return crypto.createHash('sha256').update(sorted.join('')).digest()
}

// Generate a new RSA key pair for local agent
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey, privateKey }
}

// Encrypt a message
function encrypt(plaintext, sharedKeyHex) {
  const key = hexToBuffer(sharedKeyHex)
  const nonce = crypto.randomBytes(NONCE_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: bufferToBase64(encrypted),
    nonce: bufferToBase64(nonce),
    tag: bufferToBase64(tag),
  }
}

// Decrypt a message
function decrypt(ciphertext, nonce, tag, sharedKeyHex) {
  const key = hexToBuffer(sharedKeyHex)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, base64ToBuffer(nonce))
  decipher.setAuthTag(base64ToBuffer(tag))
  const decrypted = Buffer.concat([
    decipher.update(base64ToBuffer(ciphertext)),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

// CLI
const [cmd, ...args] = process.argv.slice(2)

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.on('data', chunk => data += chunk)
    process.stdin.on('end', () => resolve(data.trim()))
  })
}

async function main() {
  switch (cmd) {
    case 'encrypt': {
      const [plaintext, keyHex] = args
      if (!plaintext || !keyHex) {
        console.error('Usage: crypto.js encrypt <plaintext> <key_hex>')
        process.exit(1)
      }
      const result = encrypt(plaintext, keyHex)
      console.log(JSON.stringify(result))
      break
    }
    case 'decrypt': {
      const [ciphertext, nonce, tag, keyHex] = args
      if (!ciphertext || !nonce || !tag || !keyHex) {
        console.error('Usage: crypto.js decrypt <ciphertext_b64> <nonce_b64> <tag_b64> <key_hex>')
        process.exit(1)
      }
      const result = decrypt(ciphertext, nonce, tag, keyHex)
      console.log(result)
      break
    }
    case 'keygen': {
      // Read keys from files or arguments
      let pubA, pubB
      if (args.length >= 2 && args[0].startsWith('-----') && args[1].startsWith('-----')) {
        // PEM keys passed as args (with newlines normalized)
        pubA = args[0].replace(/\\n/g, '\n')
        pubB = args[1].replace(/\\n/g, '\n')
      } else if (args.length === 2 && (args[0].startsWith('/') || args[0] === '-')) {
        // Files
        pubA = require('fs').readFileSync(args[0], 'utf8').trim()
        pubB = require('fs').readFileSync(args[1], 'utf8').trim()
      } else if (args.length === 1 && args[0] === '-') {
        // stdin with two keys
        const stdin = await readStdin()
        const lines = stdin.split('\n')
        pubA = lines[0]
        pubB = lines[1]
      } else if (args.length === 2) {
        // Plain strings (like test keys)
        pubA = args[0]
        pubB = args[1]
      } else {
        console.error('Usage: crypto.js keygen <pubA> <pubB>')
        process.exit(1)
      }
      const key = deriveConversationKey(pubA, pubB)
      console.log(bufferToHex(key))
      break
    }
    case 'keygen-local': {
      const { publicKey, privateKey } = generateKeyPair()
      console.log(JSON.stringify({ publicKey, privateKey }))
      break
    }
    case 'encrypt-file': {
      // Encrypt file content
      const [filePath, keyHex] = args
      const plaintext = require('fs').readFileSync(filePath, 'utf8')
      const result = encrypt(plaintext, keyHex)
      console.log(JSON.stringify(result))
      break
    }
    default:
      console.error('Commands: encrypt, decrypt, keygen, keygen-local')
      process.exit(1)
  }
}

main()
