import { Router } from 'express'
import db from '../db.js'
import { genId } from '../crypto.js'
import { notifyNewListing } from '../index.js'

const router = Router()

// List listings (with filters)
router.get('/', (req, res) => {
  const { type, category, status, min_price, max_price, condition, sort, limit = 50, page = 1 } = req.query

  let sql = 'SELECT l.*, a.agent_name FROM listings l JOIN agents a ON l.agent_id = a.id WHERE 1=1'
  const params = []

  if (type) { sql += ' AND l.type = ?'; params.push(type) }
  if (category) { sql += ' AND l.category_id = ?'; params.push(category) }
  if (status) { sql += ' AND l.status = ?'; params.push(status) }
  else { sql += " AND l.status = 'online'" }
  if (min_price) { sql += ' AND l.price >= ?'; params.push(Number(min_price)) }
  if (max_price) { sql += ' AND l.price <= ?'; params.push(Number(max_price)) }
  if (condition) { sql += ' AND l.condition = ?'; params.push(condition) }

  const sortMap = {
    created_at_desc: 'l.created_at DESC',
    created_at_asc: 'l.created_at ASC',
    price_asc: 'l.price ASC',
    price_desc: 'l.price DESC',
    view_count_desc: 'l.view_count DESC',
  }
  sql += ` ORDER BY ${sortMap[sort] || 'l.created_at DESC'}`

  const offset = (Number(page) - 1) * Number(limit)
  sql += ' LIMIT ? OFFSET ?'
  params.push(Number(limit), offset)

  const rows = db.prepare(sql).all(...params)
  const total = db.prepare('SELECT COUNT(*) as n FROM listings WHERE status = ?').get(status || 'online').n

  res.json({
    listings: rows.map(r => ({ ...r, images: JSON.parse(r.images || '[]'), tags: JSON.parse(r.tags || '[]'), accepted_methods: JSON.parse(r.accepted_methods || '[]') })),
    total,
    page: Number(page),
    hasMore: offset + rows.length < total,
  })
})

// Search listings (simple keyword match)
router.get('/search', (req, res) => {
  const { q, type, limit = 20 } = req.query
  if (!q) return res.status(400).json({ error: '缺少搜索关键词' })

  let sql = `
    SELECT l.*, a.agent_name
    FROM listings l
    JOIN agents a ON l.agent_id = a.id
    WHERE l.status = 'online'
      AND (l.title LIKE ? OR l.description LIKE ? OR l.tags LIKE ?)
  `
  const params = [`%${q}%`, `%${q}%`, `%${q}%`]
  if (type) { sql += ' AND l.type = ?'; params.push(type) }
  sql += ' ORDER BY l.view_count DESC, l.created_at DESC LIMIT ?'
  params.push(Number(limit))

  const rows = db.prepare(sql).all(...params)
  res.json({
    results: rows.map(r => ({ ...r, images: JSON.parse(r.images || '[]'), tags: JSON.parse(r.tags || '[]') })),
    query: q,
  })
})

// Get single listing
router.get('/:id', (req, res) => {
  const listing = db.prepare(`
    SELECT l.*, a.agent_name, a.owner_name, a.rating_sum, a.rating_cnt
    FROM listings l JOIN agents a ON l.agent_id = a.id
    WHERE l.id = ?
  `).get(req.params.id)

  if (!listing) return res.status(404).json({ error: '商品不存在' })

  // Increment view count
  db.prepare('UPDATE listings SET view_count = view_count + 1 WHERE id = ?').run(req.params.id)

  res.json({
    ...listing,
    images: JSON.parse(listing.images || '[]'),
    tags: JSON.parse(listing.tags || '[]'),
    accepted_methods: JSON.parse(listing.accepted_methods || '[]'),
    rating: listing.rating_cnt > 0 ? (listing.rating_sum / listing.rating_cnt).toFixed(1) : null,
  })
})

// Create listing
router.post('/', (req, res) => {
  const { agent_id, type, title, description, images, category_id, condition, price, price_unit, reserved_price, accepted_methods, location, tags } = req.body

  if (!agent_id || !type || !title || !price) {
    return res.status(400).json({ error: '缺少必要字段' })
  }

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent_id)
  if (!agent) return res.status(404).json({ error: 'Agent 未注册' })

  const id = genId('item_')
  db.prepare(`
    INSERT INTO listings (id, agent_id, type, title, description, images, category_id, condition, price, price_unit, reserved_price, accepted_methods, location, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, agent_id, type, title, description || '',
    JSON.stringify(images || []),
    category_id || null,
    condition || null,
    Number(price),
    price_unit || 'CNY',
    reserved_price ? Number(reserved_price) : null,
    JSON.stringify(accepted_methods || []),
    location || '',
    JSON.stringify(tags || []),
  )

  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id)

  // Notify subscribers
  notifyNewListing(listing, agent_id)

  res.status(201).json({
    ...listing,
    images: JSON.parse(listing.images),
    tags: JSON.parse(listing.tags),
    accepted_methods: JSON.parse(listing.accepted_methods),
  })
})

// Update listing
router.put('/:id', (req, res) => {
  const { agent_id, title, description, images, price, status, accepted_methods, tags } = req.body

  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id)
  if (!listing) return res.status(404).json({ error: '商品不存在' })
  if (listing.agent_id !== agent_id) return res.status(403).json({ error: '无权限修改' })

  db.prepare(`
    UPDATE listings SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      images = COALESCE(?, images),
      price = COALESCE(?, price),
      status = COALESCE(?, status),
      accepted_methods = COALESCE(?, accepted_methods),
      tags = COALESCE(?, tags),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    title || null,
    description || null,
    images ? JSON.stringify(images) : null,
    price ? Number(price) : null,
    status || null,
    accepted_methods ? JSON.stringify(accepted_methods) : null,
    tags ? JSON.stringify(tags) : null,
    req.params.id,
  )

  const updated = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id)
  res.json({
    ...updated,
    images: JSON.parse(updated.images),
    tags: JSON.parse(updated.tags),
    accepted_methods: JSON.parse(updated.accepted_methods),
  })
})

// Get categories
router.get('/categories/list', (_, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all()
  res.json({ categories: cats })
})

export default router
