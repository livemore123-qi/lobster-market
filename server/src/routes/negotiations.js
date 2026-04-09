import { Router } from 'express'
import db from '../db.js'
import { genId } from '../crypto.js'
import { addNotification, wsSend } from '../index.js'

const router = Router()

// Make an offer (create negotiation)
router.post('/', (req, res) => {
  const { listing_id, buyer_agent_id, price, message } = req.body

  if (!listing_id || !buyer_agent_id || !price) {
    return res.status(400).json({ error: '缺少必要字段' })
  }

  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listing_id)
  if (!listing) return res.status(404).json({ error: '商品不存在' })
  if (listing.agent_id === buyer_agent_id) return res.status(400).json({ error: '不能对自己的商品出价' })

  const buyer = db.prepare('SELECT * FROM agents WHERE id = ?').get(buyer_agent_id)
  if (!buyer) return res.status(404).json({ error: 'Buyer agent 未注册' })

  // Check if already negotiating
  const existing = db.prepare('SELECT * FROM negotiations WHERE listing_id = ? AND buyer_agent_id = ? AND status = ?').get(listing_id, buyer_agent_id, 'active')
  if (existing) {
    return res.status(409).json({ error: '已存在有效的询价', negotiation_id: existing.id })
  }

  const negoId = genId('nego_')
  db.prepare(`
    INSERT INTO negotiations (id, listing_id, buyer_agent_id, seller_agent_id, current_price)
    VALUES (?, ?, ?, ?, ?)
  `).run(negoId, listing_id, buyer_agent_id, listing.agent_id, Number(price))

  // Record message
  const msgId = genId('nmsg_')
  db.prepare(`INSERT INTO negotiation_messages (id, negotiation_id, from_agent_id, action, price, message) VALUES (?, ?, ?, ?, ?, ?)`).run(msgId, negoId, buyer_agent_id, 'offer', Number(price), message || '')

  // Update listing status
  db.prepare("UPDATE listings SET status = 'negotiating' WHERE id = ?").run(listing_id)

  // Notify seller
  const notif = {
    type: 'new_offer',
    negotiation_id: negoId,
    listing_title: listing.title,
    from_agent: buyer_agent_id,
    price: Number(price),
    message: message || '',
  }
  addNotification(listing.agent_id, 'new_offer', notif)
  wsSend(listing.agent_id, { type: 'new_offer', ...notif })

  res.status(201).json({ negotiation_id: negoId, listing_id, price: Number(price) })
})

// Get negotiation details
router.get('/:id', (req, res) => {
  const nego = db.prepare(`
    SELECT n.*,
           l.title as listing_title, l.price as asking_price,
           a1.agent_name as buyer_name, a2.agent_name as seller_name
    FROM negotiations n
    JOIN listings l ON n.listing_id = l.id
    JOIN agents a1 ON n.buyer_agent_id = a1.id
    JOIN agents a2 ON n.seller_agent_id = a2.id
    WHERE n.id = ?
  `).get(req.params.id)

  if (!nego) return res.status(404).json({ error: '询价不存在' })

  const messages = db.prepare('SELECT * FROM negotiation_messages WHERE negotiation_id = ? ORDER BY created_at ASC').all(req.params.id)

  res.json({ ...nego, messages })
})

// Send message in negotiation (counter/reject/accept)
router.post('/:id/messages', (req, res) => {
  const { from_agent_id, action, price, message } = req.body

  const validActions = ['offer', 'counter', 'accept', 'reject', 'bargain']
  if (!validActions.includes(action)) return res.status(400).json({ error: '无效的 action' })

  const nego = db.prepare('SELECT * FROM negotiations WHERE id = ?').get(req.params.id)
  if (!nego) return res.status(404).json({ error: '询价不存在' })
  if (nego.status !== 'active') return res.status(400).json({ error: '询价已结束' })

  // Who is sending?
  const isBuyer = nego.buyer_agent_id === from_agent_id
  const isSeller = nego.seller_agent_id === from_agent_id
  if (!isBuyer && !isSeller) return res.status(403).json({ error: '无权限' })

  // Buyer can offer/counter/reject, Seller can accept/reject/counter
  if (action === 'offer' && !isBuyer) return res.status(403).json({ error: '只有买方可以出价' })
  if (action === 'counter' && !isBuyer && !isSeller) return res.status(403).json({ error: '只有买方或卖方可以还价' })
  if (action === 'accept' && !isSeller) return res.status(403).json({ error: '只有卖方可以接受' })
  if (action === 'reject' && !isBuyer && !isSeller) return res.status(403).json({ error: '只有买方或卖方可以拒绝' })

  const msgId = genId('nmsg_')
  db.prepare(`INSERT INTO negotiation_messages (id, negotiation_id, from_agent_id, action, price, message) VALUES (?, ?, ?, ?, ?, ?)`).run(msgId, req.params.id, from_agent_id, action, price ? Number(price) : null, message || '')

  // Update negotiation price
  if (price) {
    db.prepare('UPDATE negotiations SET current_price = ? WHERE id = ?').run(Number(price), req.params.id)
  }

  // Update status
  if (action === 'accept') {
    db.prepare("UPDATE negotiations SET status = 'accepted' WHERE id = ?").run(req.params.id)
  } else if (action === 'reject') {
    db.prepare("UPDATE negotiations SET status = 'rejected' WHERE id = ?").run(req.params.id)
  }

  // Notify counterpart
  const counterpart = isBuyer ? nego.seller_agent_id : nego.buyer_agent_id
  const notif = {
    type: action === 'counter' ? 'price_counter' : action,
    negotiation_id: req.params.id,
    from_agent: from_agent_id,
    price: price ? Number(price) : nego.current_price,
    message: message || '',
  }
  addNotification(counterpart, action, notif)
  wsSend(counterpart, { type: action, ...notif })

  res.status(201).json({ message_id: msgId, action, price: price ? Number(price) : nego.current_price })
})

// Get negotiations for agent
router.get('/agent/:agentId', (req, res) => {
  const { role, status } = req.query

  let sql = `
    SELECT n.*,
           l.title as listing_title, l.images as listing_images,
           a1.agent_name as buyer_name, a2.agent_name as seller_name
    FROM negotiations n
    JOIN listings l ON n.listing_id = l.id
    JOIN agents a1 ON n.buyer_agent_id = a1.id
    JOIN agents a2 ON n.seller_agent_id = a2.id
    WHERE 1=1
  `
  const params = []

  if (role === 'buyer') { sql += ' AND n.buyer_agent_id = ?'; params.push(req.params.agentId) }
  else if (role === 'seller') { sql += ' AND n.seller_agent_id = ?'; params.push(req.params.agentId) }
  else { sql += ' AND (n.buyer_agent_id = ? OR n.seller_agent_id = ?)'; params.push(req.params.agentId, req.params.agentId) }

  if (status) { sql += ' AND n.status = ?'; params.push(status) }

  sql += ' ORDER BY n.updated_at DESC'

  const rows = db.prepare(sql).all(...params)
  res.json({
    negotiations: rows.map(r => ({ ...r, listing_images: JSON.parse(r.listing_images || '[]') })),
  })
})

// Accept negotiation (shorthand)
router.post('/:id/accept', (req, res) => {
  req.body = { ...req.body, from_agent_id: req.body.seller_agent_id || req.body.agent_id, action: 'accept' }
  return router.stack.find(r => r.path === '/:id/messages' && r.methods.post)?.handle(req, res, () => {
    const nego = db.prepare('SELECT * FROM negotiations WHERE id = ?').get(req.params.id)
    if (nego?.status === 'accepted') {
      db.prepare("UPDATE listings SET status = 'sold' WHERE id = ?").run(nego.listing_id)
    }
    res.json({ status: 'accepted' })
  })
})

export default router
