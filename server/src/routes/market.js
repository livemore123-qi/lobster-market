import { Router } from 'express'
import db from '../db.js'

const router = Router()

// Snapshot: full data dump for AI local filtering
router.get('/snapshot', (req, res) => {
  const { type, category, status } = req.query

  let sql = 'SELECT l.*, a.agent_name FROM listings l JOIN agents a ON l.agent_id = a.id WHERE 1=1'
  const params = []

  if (type) { sql += ' AND l.type = ?'; params.push(type) }
  if (category) { sql += ' AND l.category_id = ?'; params.push(category) }
  if (status) { sql += ' AND l.status = ?'; params.push(status) }
  else { sql += " AND l.status = 'online'" }

  sql += ' ORDER BY l.created_at DESC LIMIT 500'

  const rows = db.prepare(sql).all(...params)
  res.json({
    listings: rows.map(r => ({
      ...r,
      images: JSON.parse(r.images || '[]'),
      tags: JSON.parse(r.tags || '[]'),
      accepted_methods: JSON.parse(r.accepted_methods || '[]'),
    })),
    total: rows.length,
    version: `v${Date.now()}`,
    generated_at: new Date().toISOString(),
  })
})

// Semantic search (placeholder - simple keyword for MVP, ready for vector upgrade)
router.post('/semantic-search', (req, res) => {
  const { query, top_k = 10, filters } = req.body

  if (!query) return res.status(400).json({ error: '缺少查询' })

  // Simple keyword match for MVP
  let sql = `
    SELECT l.*, a.agent_name,
           (CASE
             WHEN l.title LIKE ? THEN 2
             WHEN l.description LIKE ? THEN 1
             ELSE 0
           END) as relevance
    FROM listings l
    JOIN agents a ON l.agent_id = a.id
    WHERE l.status = 'online'
      AND (l.title LIKE ? OR l.description LIKE ? OR l.tags LIKE ?)
  `
  const params = [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`]

  if (filters?.type) { sql += ' AND l.type = ?'; params.push(filters.type) }
  if (filters?.category) { sql += ' AND l.category_id = ?'; params.push(filters.category) }
  if (filters?.max_price) { sql += ' AND l.price <= ?'; params.push(Number(filters.max_price)) }
  if (filters?.min_price) { sql += ' AND l.price >= ?'; params.push(Number(filters.min_price)) }
  if (filters?.condition) { sql += ' AND l.condition = ?'; params.push(filters.condition) }

  sql += ' ORDER BY relevance DESC, l.view_count DESC LIMIT ?'
  params.push(Number(top_k))

  const rows = db.prepare(sql).all(...params)

  res.json({
    results: rows.map(r => ({
      listing: {
        ...r,
        images: JSON.parse(r.images || '[]'),
        tags: JSON.parse(r.tags || '[]'),
        accepted_methods: JSON.parse(r.accepted_methods || '[]'),
      },
      similarity: 0.5 + (rows.indexOf(r) * 0.05), // Placeholder similarity score
    })),
    query,
  })
})

// My listings
router.get('/my/listings', (req, res) => {
  const { agent_id } = req.query
  if (!agent_id) return res.status(400).json({ error: '缺少 agent_id' })

  const rows = db.prepare('SELECT * FROM listings WHERE agent_id = ? ORDER BY created_at DESC').all(agent_id)
  res.json({
    listings: rows.map(r => ({
      ...r,
      images: JSON.parse(r.images || '[]'),
      tags: JSON.parse(r.tags || '[]'),
      accepted_methods: JSON.parse(r.accepted_methods || '[]'),
    })),
  })
})

// Stats for dashboard
router.get('/stats/:agentId', (req, res) => {
  const { agentId } = req.params

  const myListings = db.prepare("SELECT COUNT(*) as n FROM listings WHERE agent_id = ? AND status = 'online'").get(agentId).n
  const mySales = db.prepare('SELECT COUNT(*) as n FROM orders WHERE seller_agent_id = ? AND status = ?').get(agentId, 'completed').n
  const myPurchases = db.prepare('SELECT COUNT(*) as n FROM orders WHERE buyer_agent_id = ? AND status = ?').get(agentId, 'completed').n
  const activeNegos = db.prepare('SELECT COUNT(*) as n FROM negotiations WHERE (buyer_agent_id = ? OR seller_agent_id = ?) AND status = ?').get(agentId, agentId, 'active').n
  const unreadNotifs = db.prepare('SELECT COUNT(*) as n FROM notifications WHERE to_agent_id = ? AND read = 0').get(agentId).n

  res.json({
    my_listings: myListings,
    my_sales: mySales,
    my_purchases: myPurchases,
    active_negotiations: activeNegos,
    unread_notifications: unreadNotifs,
  })
})

// Clear notifications
router.post('/notifications/clear', (req, res) => {
  const { agent_id } = req.body
  db.prepare('UPDATE notifications SET read = 1 WHERE to_agent_id = ?').run(agent_id)
  res.json({ ok: true })
})

export default router
