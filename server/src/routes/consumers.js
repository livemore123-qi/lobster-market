import { Router } from 'express'
import crypto from 'crypto'
import db from '../db.js'
import { genId } from '../crypto.js'

const router = Router()

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd + 'lobster_salt_v1').digest('hex')
}

// Register consumer
router.post('/register', (req, res) => {
  const { username, password, phone, nickname } = req.body
  
  if (!username || !password) {
    return res.status(400).json({ error: '缺少必填字段：username, password' })
  }
  
  if (username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: '用户名长度需在3-30字符之间' })
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: '密码长度至少6位' })
  }
  
  const existing = db.prepare('SELECT id FROM consumers WHERE username = ?').get(username)
  if (existing) {
    return res.status(409).json({ error: '用户名已存在' })
  }
  
  const id = genId('user_')
  const password_hash = hashPassword(password)
  
  db.prepare(`
    INSERT INTO consumers (id, username, password_hash, phone, nickname, role)
    VALUES (?, ?, ?, ?, ?, 'consumer')
  `).run(id, username, password_hash, phone || '', nickname || username)
  
  res.json({
    consumer_id: id,
    username: username,
    role: 'consumer',
    registered_at: new Date().toISOString(),
  })
})

// Login consumer
router.post('/login', (req, res) => {
  const { username, password } = req.body
  
  if (!username || !password) {
    return res.status(400).json({ error: '缺少用户名或密码' })
  }
  
  const user = db.prepare('SELECT * FROM consumers WHERE username = ?').get(username)
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  
  const password_hash = hashPassword(password)
  if (user.password_hash !== password_hash) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  
  res.json({
    consumer_id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    logged_in_at: new Date().toISOString(),
  })
})

// Get consumer info
router.get('/:id', (req, res) => {
  const user = db.prepare('SELECT id, username, phone, nickname, role, created_at FROM consumers WHERE id = ?').get(req.params.id)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  res.json(user)
})

export default router

// Update consumer profile
router.put('/:id', (req, res) => {
  const { phone, nickname, old_password, new_password } = req.body
  const user = db.prepare('SELECT * FROM consumers WHERE id = ?').get(req.params.id)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  
  // If changing password
  if (new_password) {
    if (!old_password) return res.status(400).json({ error: '需要旧密码' })
    const oldHash = hashPassword(old_password)
    if (user.password_hash !== oldHash) return res.status(401).json({ error: '旧密码错误' })
    if (new_password.length < 6) return res.status(400).json({ error: '新密码至少6位' })
    const newHash = hashPassword(new_password)
    db.prepare('UPDATE consumers SET password_hash = ?, phone = ?, nickname = ? WHERE id = ?')
      .run(newHash, phone || user.phone, nickname || user.nickname, req.params.id)
    return res.json({ success: true, message: '密码已更新' })
  }
  
  db.prepare('UPDATE consumers SET phone = ?, nickname = ? WHERE id = ?')
    .run(phone || user.phone, nickname || user.nickname, req.params.id)
  res.json({ success: true })
})

// Get consumer's capabilities
router.get('/:id/capabilities', (req, res) => {
  const caps = db.prepare('SELECT * FROM consumer_capabilities WHERE consumer_id = ? ORDER BY created_at DESC').all(req.params.id)
  res.json({ capabilities: caps })
})

// Add capability
router.post('/:id/capabilities', (req, res) => {
  const { title, description, category, tags, price } = req.body
  if (!title) return res.status(400).json({ error: '缺少标题' })
  const id = genId('cap_')
  db.prepare(`
    INSERT INTO consumer_capabilities (id, consumer_id, title, description, category, tags, price)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.id, title, description || '', category || '', JSON.stringify(tags || []), price || 0)
  res.json({ id, success: true })
})

// Get consumer's demands
router.get('/:id/demands', (req, res) => {
  const dems = db.prepare('SELECT * FROM consumer_demands WHERE consumer_id = ? ORDER BY created_at DESC').all(req.params.id)
  res.json({ demands: dems })
})

// Add demand
router.post('/:id/demands', (req, res) => {
  const { title, description, category, priority, deadline, budget } = req.body
  if (!title) return res.status(400).json({ error: '缺少标题' })
  const id = genId('dem_')
  db.prepare(`
    INSERT INTO consumer_demands (id, consumer_id, title, description, category, priority, deadline, budget)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.id, title, description || '', category || '', priority || 'normal', deadline || '', budget || 0)
  res.json({ id, success: true })
})

// Delete capability
router.delete('/capabilities/:id', (req, res) => {
  db.prepare('DELETE FROM consumer_capabilities WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

// Delete demand
router.delete('/demands/:id', (req, res) => {
  db.prepare('DELETE FROM consumer_demands WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

// Get user's catalog entries (their data assets)
router.get('/:id/catalog', (req, res) => {
  // Find user's dataspace
  const ds = db.prepare('SELECT id FROM dataspaces WHERE name = ? OR owner_name = ? LIMIT 1').get(req.params.id, req.params.id)
  if (!ds) return res.json({ entries: [] })
  const entries = db.prepare('SELECT * FROM catalog_entries WHERE dataspace_id = ? ORDER BY created_at DESC').all(ds.id)
  res.json({ entries: entries, dataspace_id: ds.id })
})

// Add catalog entry for user
router.post('/:id/catalog', (req, res) => {
  const { dataspace_id, title, summary, content_md, category, tags, access_policy, api_endpoint, price } = req.body
  if (!title || !content_md) return res.status(400).json({ error: '缺少必填字段：title, content_md' })
  // Find or create dataspace for this consumer
  let ds = db.prepare('SELECT id FROM dataspaces WHERE name = ? LIMIT 1').get(req.params.id)
  if (!ds) {
    const dsId = genId('ds_')
    db.prepare(`INSERT INTO dataspaces (id, name, description, owner_name, access_policy, owner_role) VALUES (?, ?, ?, ?, 'public', 'merchant')`).run(dsId, req.params.id, '用户数据空间', req.params.id)
    ds = { id: dsId }
  }
  const id = genId('entry_')
  db.prepare(`INSERT INTO catalog_entries (id, dataspace_id, title, summary, content_md, category, tags, access_policy, api_endpoint, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online')`).run(id, ds.id, title, summary || '', content_md, category || '', JSON.stringify(tags || []), access_policy || 'public', api_endpoint || '', price || 0)
  res.json({ id, success: true })
})

// Update demand status
router.put('/demands/:id', (req, res) => {
  const { status } = req.body
  if (!['active','completed','cancelled'].includes(status)) return res.status(400).json({ error: '无效状态' })
  db.prepare('UPDATE consumer_demands SET status = ? WHERE id = ?').run(status, req.params.id)
  res.json({ success: true })
})

// Get user's lobster access info
router.get('/:id/lobster-access', (req, res) => {
  // Accept both string consumer_id and numeric id
  const user = db.prepare('SELECT * FROM consumers WHERE id = ? OR id = ?').get(req.params.id, req.params.id)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  // Count how many agents accessed user data
  const ds = db.prepare('SELECT id FROM dataspaces WHERE name = ? LIMIT 1').get(req.params.id)
  const accessCount = ds ? db.prepare('SELECT COUNT(*) as n FROM catalog_entries WHERE dataspace_id = ?').get(ds.id).n : 0
  const totalViews = ds ? db.prepare('SELECT SUM(view_count) as v FROM catalog_entries WHERE dataspace_id = ?').get(ds.id).v || 0 : 0
  res.json({ 
    consumer_id: req.params.id,
    username: user.username,
    data_count: accessCount,
    total_views: totalViews,
    registered_at: user.created_at
  })
})
