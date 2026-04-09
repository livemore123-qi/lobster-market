import { Router } from 'express'
import db from '../db.js'
import { genId } from '../crypto.js'
import { addNotification, wsSend } from '../index.js'

const router = Router()

// Create order from accepted negotiation
router.post('/', (req, res) => {
  const { negotiation_id, agent_id, transaction_method, shipping_address } = req.body

  if (!negotiation_id || !agent_id) {
    return res.status(400).json({ error: '缺少必要字段' })
  }

  const nego = db.prepare(`
    SELECT n.*, l.title as listing_title, l.images as listing_images
    FROM negotiations n JOIN listings l ON n.listing_id = l.id
    WHERE n.id = ?
  `).get(negotiation_id)

  if (!nego) return res.status(404).json({ error: '询价不存在' })
  if (nego.status !== 'accepted') return res.status(400).json({ error: '询价尚未被接受' })
  if (nego.buyer_agent_id !== agent_id) return res.status(403).json({ error: '只有买家可以创建订单' })

  // Check if order already exists
  const existing = db.prepare('SELECT * FROM orders WHERE negotiation_id = ?').get(negotiation_id)
  if (existing) return res.status(409).json({ error: '订单已存在', order_id: existing.id })

  const id = genId('order_')
  db.prepare(`
    INSERT INTO orders (id, negotiation_id, listing_id, buyer_agent_id, seller_agent_id, final_price, transaction_method, shipping_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, negotiation_id, nego.listing_id, nego.buyer_agent_id, nego.seller_agent_id, nego.current_price, transaction_method || null, shipping_address || null)

  // Update listing
  db.prepare("UPDATE listings SET status = 'sold' WHERE id = ?").run(nego.listing_id)

  // Notify seller
  addNotification(nego.seller_agent_id, 'order_created', {
    order_id: id,
    listing_title: nego.listing_title,
    final_price: nego.current_price,
    transaction_method,
  })
  wsSend(nego.seller_agent_id, { type: 'order_created', order_id: id })

  res.status(201).json({
    id,
    negotiation_id,
    final_price: nego.current_price,
    status: 'pending',
  })
})

// Get order details
router.get('/:id', (req, res) => {
  const order = db.prepare(`
    SELECT o.*,
           l.title as listing_title, l.images as listing_images, l.location,
           a1.agent_name as buyer_name, a2.agent_name as seller_name
    FROM orders o
    JOIN listings l ON o.listing_id = l.id
    JOIN agents a1 ON o.buyer_agent_id = a1.id
    JOIN agents a2 ON o.seller_agent_id = a2.id
    WHERE o.id = ?
  `).get(req.params.id)

  if (!order) return res.status(404).json({ error: '订单不存在' })

  res.json({
    ...order,
    listing_images: JSON.parse(order.listing_images || '[]'),
  })
})

// Update order status
router.put('/:id/status', (req, res) => {
  const { agent_id, status, shipping_address } = req.body

  const validTransitions = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['shipped', 'cancelled'],
    shipped: ['received'],
    received: ['completed'],
    completed: [],
    cancelled: [],
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)
  if (!order) return res.status(404).json({ error: '订单不存在' })

  const isBuyer = order.buyer_agent_id === agent_id
  const isSeller = order.seller_agent_id === agent_id
  if (!isBuyer && !isSeller) return res.status(403).json({ error: '无权限' })

  const allowed = validTransitions[order.status]
  if (!allowed?.includes(status)) {
    return res.status(400).json({ error: `状态 ${order.status} 不能转为 ${status}` })
  }

  // Only buyer can confirm/receive/complete/cancel shipped or confirmed orders
  if (['confirmed', 'received', 'completed'].includes(status) && !isBuyer) {
    return res.status(403).json({ error: '只有买家可以执行此操作' })
  }
  if (status === 'shipped' && !isSeller) {
    return res.status(403).json({ error: '只有卖家可以标记发货' })
  }

  const updates = { status }
  if (shipping_address) updates.shipping_address = shipping_address

  db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id)

  // Notify counterpart
  const counterpart = isBuyer ? order.seller_agent_id : order.buyer_agent_id
  addNotification(counterpart, 'order_status_change', { order_id: req.params.id, status, updated_by: agent_id })
  wsSend(counterpart, { type: 'order_status_change', order_id: req.params.id, status })

  res.json({ status })
})

// List orders for agent
router.get('/agent/:agentId', (req, res) => {
  const { role, status } = req.query

  let sql = `
    SELECT o.*,
           l.title as listing_title, l.images as listing_images,
           a1.agent_name as buyer_name, a2.agent_name as seller_name
    FROM orders o
    JOIN listings l ON o.listing_id = l.id
    JOIN agents a1 ON o.buyer_agent_id = a1.id
    JOIN agents a2 ON o.seller_agent_id = a2.id
    WHERE 1=1
  `
  const params = []

  if (role === 'buyer') { sql += ' AND o.buyer_agent_id = ?'; params.push(req.params.agentId) }
  else if (role === 'seller') { sql += ' AND o.seller_agent_id = ?'; params.push(req.params.agentId) }
  else { sql += ' AND (o.buyer_agent_id = ? OR o.seller_agent_id = ?)'; params.push(req.params.agentId, req.params.agentId) }

  if (status) { sql += ' AND o.status = ?'; params.push(status) }
  sql += ' ORDER BY o.created_at DESC'

  const rows = db.prepare(sql).all(...params)
  res.json({
    orders: rows.map(r => ({ ...r, listing_images: JSON.parse(r.listing_images || '[]') })),
  })
})

// Add review
router.post('/:id/review', (req, res) => {
  const { from_agent_id, rating, comment } = req.body

  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: '评分必须是1-5' })

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)
  if (!order) return res.status(404).json({ error: '订单不存在' })
  if (order.status !== 'completed') return res.status(400).json({ error: '只能对已完成的订单评价' })

  const isBuyer = order.buyer_agent_id === from_agent_id
  const isSeller = order.seller_agent_id === from_agent_id
  if (!isBuyer && !isSeller) return res.status(403).json({ error: '无权限' })

  const toAgentId = isBuyer ? order.seller_agent_id : order.buyer_agent_id

  // Check if already reviewed
  const existing = db.prepare('SELECT * FROM reviews WHERE order_id = ? AND from_agent_id = ?').get(req.params.id, from_agent_id)
  if (existing) return res.status(409).json({ error: '已评价过' })

  const id = genId('rev_')
  db.prepare('INSERT INTO reviews (id, order_id, from_agent_id, to_agent_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.params.id, from_agent_id, toAgentId, rating, comment || '')

  // Update agent rating
  const current = db.prepare('SELECT rating_sum, rating_cnt FROM agents WHERE id = ?').get(toAgentId)
  db.prepare('UPDATE agents SET rating_sum = ?, rating_cnt = ? WHERE id = ?').run(current.rating_sum + rating, current.rating_cnt + 1, toAgentId)

  res.status(201).json({ review_id: id, rating })
})

export default router
