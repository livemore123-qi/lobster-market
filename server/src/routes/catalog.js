import { Router } from 'express'
import db from '../db.js'
import { genId } from '../crypto.js'

const router = Router()

// ========== DATASPACES ==========

// Create dataspace
router.post('/dataspaces', (req, res) => {
  const { name, description, owner_name, contact_info, access_policy, tags, agent_id } = req.body
  if (!name || !owner_name) {
    return res.status(400).json({ error: '缺少必填字段：name, owner_name' })
  }
  const id = genId('ds')
  const stmt = db.prepare(`
    INSERT INTO dataspaces (id, name, description, owner_name, contact_info, access_policy, tags, agent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(id, name, description || '', owner_name, contact_info || '', access_policy || 'public',
    JSON.stringify(tags || []), agent_id || null)
  res.json({ id, name, description, owner_name, access_policy })
})

// List dataspaces
router.get('/dataspaces', (req, res) => {
  const { q, page = 1, pageSize = 20 } = req.query
  const offset = (page - 1) * pageSize

  let rows, total
  if (q) {
    const like = `%${q}%`
    rows = db.prepare(`
      SELECT * FROM dataspaces
      WHERE (name LIKE ? OR description LIKE ? OR owner_name LIKE ?)
        AND access_policy != 'private'
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(like, like, like, pageSize, offset)
    total = db.prepare(`SELECT COUNT(*) as c FROM dataspaces WHERE (name LIKE ? OR description LIKE ?) AND access_policy != 'private'`).get(like, like).c
  } else {
    rows = db.prepare(`SELECT * FROM dataspaces WHERE access_policy != 'private' ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(pageSize, offset)
    total = db.prepare(`SELECT COUNT(*) as c FROM dataspaces WHERE access_policy != 'private'`).get().c
  }

  rows.forEach(r => { r.tags = JSON.parse(r.tags || '[]') })
  res.json({ dataspaces: rows, total, page: Number(page), pageSize: Number(pageSize) })
})

// Get dataspace
router.get('/dataspaces/:id', (req, res) => {
  const ds = db.prepare(`SELECT * FROM dataspaces WHERE id = ?`).get(req.params.id)
  if (!ds) return res.status(404).json({ error: '数据空间不存在' })
  ds.tags = JSON.parse(ds.tags || '[]')
  res.json(ds)
})

// ========== CATALOG ENTRIES ==========

// Create entry
router.post('/entries', (req, res) => {
  const { dataspace_id, title, summary, content_md, category, tags, access_policy, access_token, api_endpoint, price } = req.body
  if (!dataspace_id || !title || !content_md) {
    return res.status(400).json({ error: '缺少必填字段：dataspace_id, title, content_md' })
  }
  const id = genId('ce')
  const stmt = db.prepare(`
    INSERT INTO catalog_entries (id, dataspace_id, title, summary, content_md, category, tags, access_policy, access_token, api_endpoint, price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(id, dataspace_id, title, summary || '', content_md, category || '', JSON.stringify(tags || []),
    access_policy || 'public', access_token || '', api_endpoint || '', price || 0)
  res.json({ id, title, status: 'online' })
})

// List/search entries
router.get('/entries', (req, res) => {
  const { q, dataspace_id, category, page = 1, pageSize = 20 } = req.query
  const offset = (page - 1) * pageSize

  let rows, total
  const conditions = ['status = ?']
  const params = ['online']

  if (q) {
    // Use full-text search
    rows = db.prepare(`
      SELECT ce.*, ds.name as dataspace_name, ds.owner_name
      FROM catalog_entries ce
      JOIN dataspaces ds ON ce.dataspace_id = ds.id
      WHERE ce.status = 'online'
        AND (ce.title LIKE ? OR ce.summary LIKE ? OR ce.content_md LIKE ?)
        AND ce.access_policy != 'private'
      ORDER BY ce.view_count DESC, ce.created_at DESC LIMIT ? OFFSET ?
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, pageSize, offset)
    total = db.prepare(`SELECT COUNT(*) as c FROM catalog_entries ce WHERE status='online' AND (title LIKE ? OR summary LIKE ? OR content_md LIKE ?) AND access_policy != 'private'`)
      .get(`%${q}%`, `%${q}%`, `%${q}%`).c
  } else if (dataspace_id) {
    rows = db.prepare(`
      SELECT ce.*, ds.name as dataspace_name, ds.owner_name
      FROM catalog_entries ce
      JOIN dataspaces ds ON ce.dataspace_id = ds.id
      WHERE ce.dataspace_id = ? AND ce.status = 'online' AND ce.access_policy != 'private'
      ORDER BY ce.created_at DESC LIMIT ? OFFSET ?
    `).all(dataspace_id, pageSize, offset)
    total = db.prepare(`SELECT COUNT(*) as c FROM catalog_entries WHERE dataspace_id = ? AND status='online' AND access_policy != 'private'`).get(dataspace_id).c
  } else if (category) {
    rows = db.prepare(`
      SELECT ce.*, ds.name as dataspace_name, ds.owner_name
      FROM catalog_entries ce
      JOIN dataspaces ds ON ce.dataspace_id = ds.id
      WHERE ce.category = ? AND ce.status = 'online' AND ce.access_policy != 'private'
      ORDER BY ce.view_count DESC LIMIT ? OFFSET ?
    `).all(category, pageSize, offset)
    total = db.prepare(`SELECT COUNT(*) as c FROM catalog_entries WHERE category = ? AND status='online' AND access_policy != 'private'`).get(category).c
  } else {
    rows = db.prepare(`
      SELECT ce.*, ds.name as dataspace_name, ds.owner_name
      FROM catalog_entries ce
      JOIN dataspaces ds ON ce.dataspace_id = ds.id
      WHERE ce.status = 'online' AND ce.access_policy != 'private'
      ORDER BY ce.view_count DESC LIMIT ? OFFSET ?
    `).all(pageSize, offset)
    total = db.prepare(`SELECT COUNT(*) as c FROM catalog_entries WHERE status='online' AND access_policy != 'private'`).get().c
  }

  rows.forEach(r => { r.tags = JSON.parse(r.tags || '[]') })
  res.json({ entries: rows, total, page: Number(page), pageSize: Number(pageSize) })
})

// Get entry
router.get('/entries/:id', (req, res) => {
  const entry = db.prepare(`
    SELECT ce.*, ds.name as dataspace_name, ds.owner_name, ds.contact_info, ds.access_policy as dataspace_policy
    FROM catalog_entries ce
    JOIN dataspaces ds ON ce.dataspace_id = ds.id
    WHERE ce.id = ?
  `).get(req.params.id)

  if (!entry) return res.status(404).json({ error: '条目不存在' })

  // Increment view count
  db.prepare(`UPDATE catalog_entries SET view_count = view_count + 1 WHERE id = ?`).run(req.params.id)

  entry.tags = JSON.parse(entry.tags || '[]')
  res.json(entry)
})

// Update entry
router.put('/entries/:id', (req, res) => {
  const { title, summary, content_md, category, tags, access_policy, access_token, api_endpoint, price, status } = req.body
  const existing = db.prepare(`SELECT * FROM catalog_entries WHERE id = ?`).get(req.params.id)
  if (!existing) return res.status(404).json({ error: '条目不存在' })

  const stmt = db.prepare(`
    UPDATE catalog_entries SET
      title = COALESCE(?, title),
      summary = COALESCE(?, summary),
      content_md = COALESCE(?, content_md),
      category = COALESCE(?, category),
      tags = COALESCE(?, tags),
      access_policy = COALESCE(?, access_policy),
      access_token = COALESCE(?, access_token),
      api_endpoint = COALESCE(?, api_endpoint),
      price = COALESCE(?, price),
      status = COALESCE(?, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
  stmt.run(
    title || null,
    summary || null,
    content_md || null,
    category || null,
    tags ? JSON.stringify(tags) : null,
    access_policy || null,
    access_token || null,
    api_endpoint || null,
    price || null,
    status || null,
    req.params.id
  )
  res.json({ success: true })
})

// Delete entry
router.delete('/entries/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM catalog_entries WHERE id = ?`).get(req.params.id)
  if (!existing) return res.status(404).json({ error: '条目不存在' })
  db.prepare(`DELETE FROM catalog_entries WHERE id = ?`).run(req.params.id)
  res.json({ success: true })
})

// Categories list
router.get('/categories/list', (req, res) => {
  const cats = db.prepare(`SELECT * FROM categories ORDER BY sort_order, name`).all()
  res.json({ categories: cats })
})

export default router
