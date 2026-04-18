import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import db from './db.js'
import { genId } from './crypto.js'
import listingsRouter from './routes/listings.js'
import agentsRouter from './routes/agents.js'
import negotiationsRouter from './routes/negotiations.js'
import conversationsRouter from './routes/conversations.js'
import ordersRouter from './routes/orders.js'
import marketRouter from './routes/market.js'
import catalogRouter from './routes/catalog.js'
import consumersRouter from './routes/consumers.js'

const PORT = 3000
const app = express()
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
app.use(express.static(join(__dirname, '..', '..', 'frontend')))


app.use(express.json())

// CORS for local dev
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'X-Agent-ID,X-Notify-Token,X-Signature,X-Timestamp,Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

// Routes
app.use('/api/listings', listingsRouter)
app.use('/api/agents', agentsRouter)
app.use('/api/negotiations', negotiationsRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/market', marketRouter)
app.use('/api/consumers', consumersRouter)
app.use('/api/catalog', catalogRouter)

// Health
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }))

// Pending notifications for agent (called on every request)
export function getPendingNotifications(agentId) {
  const rows = db.prepare(
    'SELECT * FROM notifications WHERE to_agent_id = ? AND read = 0 ORDER BY created_at ASC'
  ).all(agentId)
  db.prepare('UPDATE notifications SET read = 1 WHERE to_agent_id = ? AND read = 0').run(agentId)
  return rows.map(row => ({ ...row, payload: JSON.parse(row.payload) }))
}

// Add notification
export function addNotification(toAgentId, type, payload) {
  const id = genId('notif_')
  db.prepare(
    'INSERT INTO notifications (id, to_agent_id, type, payload) VALUES (?, ?, ?, ?)'
  ).run(id, toAgentId, type, JSON.stringify(payload))
}

// Attach pending notifications to response
app.use((req, res, next) => {
  const agentId = req.headers['x-agent-id']
  if (agentId) {
    const pending = getPendingNotifications(agentId)
    if (pending.length > 0) {
      res.pendingNotifications = pending
    }
  }
  next()
})

// Wrap res.json to attach pending notifications
const originalJson = express.response.json
express.response.json = function (body) {
  if (this.pendingNotifications && this.pendingNotifications.length > 0) {
    body = Object.assign({}, body, { pending_notifications: this.pendingNotifications })
  }
  return originalJson.call(this, body)
}

// WebSocket Server (for future real-time features)
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

// Agent WS connections
const agentWsMap = new Map() // agentId -> WebSocket

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const agentId = url.searchParams.get('agent_id')

  if (agentId) {
    agentWsMap.set(agentId, ws)
    // Update agent status
    db.prepare('UPDATE agents SET status = ? WHERE id = ?').run('online', agentId)

    ws.on('close', () => {
      agentWsMap.delete(agentId)
      db.prepare('UPDATE agents SET status = ? WHERE id = ?').run('offline', agentId)
    })

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw)
        handleWsMessage(agentId, msg, ws)
      } catch {}
    })

    // Send pending notifications via WS
    const pending = getPendingNotifications(agentId)
    if (pending.length > 0) {
      ws.send(JSON.stringify({ type: 'notifications', notifications: pending }))
    }
  }
})

function handleWsMessage(agentId, msg, ws) {
  switch (msg.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', time: Date.now() }))
      break
    default:
      break
  }
}

// Broadcast to specific agent
export function wsSend(agentId, data) {
  const ws = agentWsMap.get(agentId)
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data))
  }
}

// Notify subscriber agents of new listing
export function notifyNewListing(listing, sellerAgentId) {
  const subs = db.prepare('SELECT * FROM subscriptions').all()
  const listingData = {
    id: listing.id,
    title: listing.title,
    price: listing.price,
    type: listing.type,
    agent_id: sellerAgentId,
  }

  subs.forEach(sub => {
    const filters = JSON.parse(sub.filters)
    let match = false

    if (filters.type && filters.type !== listing.type) return
    if (filters.category_id && filters.category_id !== listing.category_id) return
    if (filters.max_price && listing.price > filters.max_price) return
    if (filters.min_price && listing.price < filters.min_price) return

    match = true
    if (match) {
      addNotification(sub.agent_id, 'new_listing', listingData)
      wsSend(sub.agent_id, { type: 'new_listing', listing: listingData })
    }
  })
}

server.listen(PORT, () => {
  console.log(`🦞 龙虾数据空间 running on http://localhost:${PORT}`)
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`)
})
