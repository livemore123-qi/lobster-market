import { Router } from 'express'
import db from '../db.js'
import { genId, encrypt, decrypt, deriveConversationKey } from '../crypto.js'
import { addNotification, wsSend } from '../index.js'

const router = Router()

// Get agent's public key
function getAgentPublicKey(agentId) {
  const agent = db.prepare('SELECT public_key FROM agents WHERE id = ?').get(agentId)
  return agent?.public_key || null
}

// Create or get conversation with another agent
router.post('/', (req, res) => {
  const { initiator_id, receiver_id, listing_id } = req.body

  if (!initiator_id || !receiver_id) {
    return res.status(400).json({ error: '缺少必要字段' })
  }

  const [a1, a2] = [initiator_id, receiver_id].sort()
  // Check existing conversation between these two (optionally for this listing)
  let conv
  if (listing_id) {
    conv = db.prepare('SELECT * FROM agent_conversations WHERE initiator_id = ? AND receiver_id = ? AND listing_id = ?').get(a1, a2, listing_id)
  }
  if (!conv) {
    const id = genId('conv_')
    db.prepare(`INSERT INTO agent_conversations (id, listing_id, initiator_id, receiver_id) VALUES (?, ?, ?, ?)`).run(id, listing_id || null, initiator_id, receiver_id)
    conv = db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(id)
  }

  res.status(201).json({ conversation_id: conv.id, listing_id: conv.listing_id })
})

// Send message (E2EE - relay only stores ciphertext)
router.post('/:id/messages', (req, res) => {
  const { from_agent_id, content_encrypted, content_nonce, content_tag } = req.body

  const conv = db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(req.params.id)
  if (!conv) return res.status(404).json({ error: '对话不存在' })

  const isParticipant = from_agent_id === conv.initiator_id || from_agent_id === conv.receiver_id
  if (!isParticipant) return res.status(403).json({ error: '无权限参与此对话' })

  if (!content_encrypted || !content_nonce) {
    return res.status(400).json({ error: '缺少加密内容' })
  }

  const msgId = genId('cmsg_')
  const tag = content_tag || ''
  db.prepare(`INSERT INTO conversation_messages (id, conversation_id, from_agent_id, content_encrypted, content_nonce, content_tag) VALUES (?, ?, ?, ?, ?, ?)`).run(msgId, req.params.id, from_agent_id, content_encrypted, content_nonce, tag)

  // Notify receiver
  const receiver = from_agent_id === conv.initiator_id ? conv.receiver_id : conv.initiator_id
  const notif = {
    type: 'new_message',
    conversation_id: req.params.id,
    from_agent: from_agent_id,
    preview: '[加密消息]', // Relay can't decrypt, just show it's a message
  }
  addNotification(receiver, 'new_message', notif)
  wsSend(receiver, { type: 'new_message', conversation_id: req.params.id, from_agent: from_agent_id })

  res.status(201).json({ message_id: msgId })
})

// Get messages (only participant can read, relay can't decrypt)
router.get('/:id/messages', (req, res) => {
  const agentId = req.headers['x-agent-id']
  const { since } = req.query

  const conv = db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(req.params.id)
  if (!conv) return res.status(404).json({ error: '对话不存在' })

  const isParticipant = agentId === conv.initiator_id || agentId === conv.receiver_id
  if (!isParticipant) return res.status(403).json({ error: '无权限' })

  let sql = 'SELECT * FROM conversation_messages WHERE conversation_id = ?'
  const params = [req.params.id]
  if (since) { sql += ' AND created_at > ?'; params.push(since) }
  sql += ' ORDER BY created_at ASC'

  const rows = db.prepare(sql).all(...params)

  // Return raw encrypted data - only the participants can decrypt locally
  res.json({
    messages: rows.map(r => ({
      id: r.id,
      from_agent_id: r.from_agent_id,
      content_encrypted: r.content_encrypted,
      content_nonce: r.content_nonce,
      content_tag: r.content_tag || '',
      created_at: r.created_at,
    })),
  })
})

// List my conversations
router.get('/agent/:agentId', (req, res) => {
  const { status } = req.query

  let sql = `
    SELECT c.*,
           a1.agent_name as initiator_name, a2.agent_name as receiver_name,
           l.title as listing_title
    FROM agent_conversations c
    JOIN agents a1 ON c.initiator_id = a1.id
    JOIN agents a2 ON c.receiver_id = a2.id
    LEFT JOIN listings l ON c.listing_id = l.id
    WHERE (c.initiator_id = ? OR c.receiver_id = ?)
  `
  const params = [req.params.agentId, req.params.agentId]
  if (status) { sql += ' AND c.status = ?'; params.push(status) }
  sql += ' ORDER BY c.created_at DESC'

  const rows = db.prepare(sql).all(...params)
  res.json({ conversations: rows })
})

// Close conversation
router.post('/:id/close', (req, res) => {
  const { agent_id } = req.body
  const conv = db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(req.params.id)
  if (!conv) return res.status(404).json({ error: '对话不存在' })

  const isParticipant = agent_id === conv.initiator_id || agent_id === conv.receiver_id
  if (!isParticipant) return res.status(403).json({ error: '无权限' })

  db.prepare("UPDATE agent_conversations SET status = 'closed' WHERE id = ?").run(req.params.id)
  res.json({ status: 'closed' })
})

export default router
