import { Router } from 'express'
import db from '../db.js'
import { genId } from '../crypto.js'

const router = Router()

// Register agent
router.post('/register', (req, res) => {
  const { hostname, username, public_key, agent_name, owner_name, meta } = req.body

  if (!hostname || !username || !public_key || !agent_name || !owner_name) {
    return res.status(400).json({ error: '缺少必要字段' })
  }

  const agentId = `${username}@${hostname}`

  const existing = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId)
  if (existing) {
    return res.status(409).json({ error: '该 agent 已注册', agent_id: agentId })
  }

  const id = genId('agent_')
  const role = 'agent'
  db.prepare(`
    INSERT INTO agents (id, agent_name, owner_name, role, meta, public_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(agentId, agent_name, owner_name, role, meta || '', public_key)

  res.json({
    agent_id: agentId,
    registered_at: new Date().toISOString(),
  })
})

// Get agent info
router.get('/:id', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent 不存在' })

  res.json({
    ...agent,
    rating: agent.rating_cnt > 0 ? (agent.rating_sum / agent.rating_cnt).toFixed(1) : null,
  })
})

// Get agent's public key only (for E2EE)
router.get('/:id/public-key', (req, res) => {
  const agent = db.prepare('SELECT public_key FROM agents WHERE id = ?').get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent 不存在' })
  res.json({ public_key: agent.public_key })
})

// Get agent by username@hostname
router.get('/resolve/:username/:hostname', (req, res) => {
  const agentId = `${req.params.username}@${req.params.hostname}`
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId)
  if (!agent) return res.status(404).json({ error: 'Agent 不存在' })
  res.json({ agent_id: agent.id, status: agent.status })
})

// List agents
router.get('/', (req, res) => {
  const agents = db.prepare('SELECT id, agent_name, owner_name, meta, status, rating_sum, rating_cnt, created_at FROM agents ORDER BY created_at DESC').all()
  res.json({
    agents: agents.map(a => ({
      ...a,
      rating: a.rating_cnt > 0 ? (a.rating_sum / a.rating_cnt).toFixed(1) : null,
    })),
  })
})

// Subscribe to categories
router.post('/:id/subscribe', (req, res) => {
  const { filters } = req.body
  const id = genId('sub_')
  db.prepare('INSERT INTO subscriptions (id, agent_id, filters) VALUES (?, ?, ?)').run(id, req.params.id, JSON.stringify(filters || {}))
  res.json({ subscription_id: id })
})

// Get subscriptions
router.get('/:id/subscriptions', (req, res) => {
  const subs = db.prepare('SELECT * FROM subscriptions WHERE agent_id = ?').all(req.params.id)
  res.json({ subscriptions: subs.map(s => ({ ...s, filters: JSON.parse(s.filters) })) })
})

export default router
