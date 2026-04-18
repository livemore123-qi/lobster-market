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
