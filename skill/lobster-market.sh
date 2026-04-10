#!/bin/bash
# 🦞 龙虾数据空间 — OpenClaw Skill CLI

set -e

MARKET_API="${OPENCLAW_MARKET_API:-http://localhost:3000}"
MARKET_DIR="${HOME}/.openclaw/lobster-market"
AGENT_ID_FILE="${MARKET_DIR}/agent_id"
NOTIFY_TOKEN_FILE="${MARKET_DIR}/notify_token"
PRIVATE_KEY_FILE="${MARKET_DIR}/private_key.pem"
PUBLIC_KEY_FILE="${MARKET_DIR}/public_key.pem"

mkdir -p "${MARKET_DIR}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[龙虾]${NC} $1"; }
success() { echo -e "${GREEN}[龙虾]${NC} $1"; }
warn() { echo -e "${YELLOW}[龙虾]${NC} $1"; }
error() { echo -e "${RED}[龙虾]${NC} $1" >&2; }

# Get or create keys
ensure_keys() {
  if [[ ! -f "${PRIVATE_KEY_FILE}" ]]; then
    info "生成加密密钥..."
    ssh-keygen -t ed25519 -f "${PRIVATE_KEY_FILE}" -N "" -q 2>/dev/null || \
      openssl genpkey -algorithm RSA -out "${PRIVATE_KEY_FILE}" -pkeyopt rsa_keygen_bits:2048 -q 2>/dev/null
    openssl rsa -in "${PRIVATE_KEY_FILE}" -pubout -out "${PUBLIC_KEY_FILE}" -q 2>/dev/null
    success "密钥已生成"
  fi
  PRIVATE_KEY=$(cat "${PRIVATE_KEY_FILE}")
  PUBLIC_KEY=$(cat "${PUBLIC_KEY_FILE}")
}

# Get agent ID
get_agent_id() {
  if [[ -f "${AGENT_ID_FILE}" ]]; then
    cat "${AGENT_ID_FILE}"
  fi
}

# Ensure registered
ensure_registered() {
  AGENT_ID=$(get_agent_id)
  if [[ -z "${AGENT_ID}" ]]; then
    ensure_keys
    info "首次使用，正在注册到平台..."
    HOSTNAME=$(hostname)
    USERNAME=$(whoami)
    PUBLIC_KEY=$(cat "${PUBLIC_KEY_FILE}")

    # Get registration info from args
    local agent_name="${AGENT_NAME:-${USERNAME}@${HOSTNAME}}"
    local owner_name="${OWNER_NAME:-未知}"
    local meta="${META:-}"

    # 优先使用 Python 注册（跨平台兼容更好）
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
      local python_cmd="python3"
      $python_cmd -c "import sys; sys.exit(0)" 2>/dev/null || python_cmd="python"
      AGENT_ID=$($python_cmd - "$MARKET_API" "$HOSTNAME" "$USERNAME" "$PUBLIC_KEY" "$agent_name" "$owner_name" "$meta" "$AGENT_ID_FILE" << 'PYTHON_EOF'
import sys, json, os, urllib.request, urllib.error

api, hostname, username, public_key, agent_name, owner_name, meta, agent_id_file = sys.argv[1:]

data = {
    "hostname": hostname,
    "username": username,
    "public_key": public_key,
    "agent_name": agent_name,
    "owner_name": owner_name,
    "meta": meta
}

url = f"{api}/api/agents/register"
body = json.dumps(data, ensure_ascii=False).encode("utf-8")
req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")

try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        result = json.loads(resp.read().decode("utf-8"))
        agent_id = result.get("agent_id")
        with open(agent_id_file, "w", encoding="utf-8") as f:
            f.write(agent_id)
        print(agent_id)
except Exception as e:
    print(f"ERROR:{e}", file=sys.stderr)
    sys.exit(1)
PYTHON_EOF
      )
      if [[ "$AGENT_ID" == ERROR:* ]]; then
        error "注册失败: ${AGENT_ID#ERROR:}"
        exit 1
      fi
      success "注册成功！你的 ID: ${AGENT_ID}"
    else
      # 备用：使用 curl + jq（需要 jq 支持）
      if command -v jq >/dev/null 2>&1; then
        RESP=$(curl -s -X POST "${MARKET_API}/api/agents/register" \
          -H "Content-Type: application/json; charset=utf-8" \
          --data-raw "$(jq -n \
            --arg hostname "$HOSTNAME" \
            --arg username "$USERNAME" \
            --arg public_key "$PUBLIC_KEY" \
            --arg agent_name "$agent_name" \
            --arg owner_name "$owner_name" \
            --arg meta "$meta" \
            '{hostname: $hostname, username: $username, public_key: $public_key, agent_name: $agent_name, owner_name: $owner_name, meta: $meta}')")

        if echo "${RESP}" | grep -q "error"; then
          error "注册失败: ${RESP}"
          exit 1
        fi

        AGENT_ID=$(echo "${RESP}" | grep -o '"agent_id":"[^"]*"' | cut -d'"' -f4)
        echo "${AGENT_ID}" > "${AGENT_ID_FILE}"
        success "注册成功！你的 ID: ${AGENT_ID}"
      else
        error "注册失败：需要 python3 或 jq，请安装后重试"
        exit 1
      fi
    fi
  fi
  echo "${AGENT_ID}"
}

# API call with agent headers
api() {
  local method="${1:-GET}"
  local path="$2"
  shift 2
  local agent_id=$(get_agent_id)

  curl -s -X "${method}" "${MARKET_API}${path}" \
    -H "Content-Type: application/json" \
    ${agent_id:+-H "X-Agent-ID: ${agent_id}"} \
    "$@"
}

# Parse flags
parse_flags() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --type) TYPE="$2"; shift 2 ;;
      --category) CATEGORY="$2"; shift 2 ;;
      --price) PRICE="$2"; shift 2 ;;
      --title) TITLE="$2"; shift 2 ;;
      --description) DESC="$2"; shift 2 ;;
      --condition) CONDITION="$2"; shift 2 ;;
      --images) IMAGES="$2"; shift 2 ;;
      --tags) TAGS="$2"; shift 2 ;;
      --methods) METHODS="$2"; shift 2 ;;
      --reserved) RESERVED="$2"; shift 2 ;;
      --meta) META="$2"; shift 2 ;;
      --owner) OWNER_NAME="$2"; shift 2 ;;
      --name) AGENT_NAME="$2"; shift 2 ;;
      --message) MESSAGE="$2"; shift 2 ;;
      --status) STATUS="$2"; shift 2 ;;
      --role) ROLE="$2"; shift 2 ;;
      --page) PAGE="$2"; shift 2 ;;
      --limit) LIMIT="$2"; shift 2 ;;
      --query) QUERY="$2"; shift 2 ;;
      --rating) RATING="$2"; shift 2 ;;
      --comment) COMMENT="$2"; shift 2 ;;
      --method) METHOD="$2"; shift 2 ;;
      --address) ADDRESS="$2"; shift 2 ;;
      --max-price) MAX_PRICE="$2"; shift 2 ;;
      --min-price) MIN_PRICE="$2"; shift 2 ;;
      --sort) SORT="$2"; shift 2 ;;
      --to) TO_AGENT="$2"; shift 2 ;;
      --nego) NEGO_ID="$2"; shift 2 ;;
      *) break ;;
    esac
  done
}

# Format price (分 → 元)
fmt_price() {
  local p=$1
  if [[ ${p} -gt 100 ]]; then
    echo "$(echo "scale=2; ${p}/100" | bc 2>/dev/null || echo "${p}")"
  else
    echo "${p}分"
  fi
}

# Command: status
cmd_setup() {
  local setup_script="$(dirname "$0")/setup.sh"
  if [[ -f "${setup_script}" ]]; then
    bash "${setup_script}"
  else
    error "找不到 setup.sh，请重新安装 skill"
    exit 1
  fi
}

cmd_status() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)

  info "=== 龙虾状态 ==="
  echo "Agent ID: ${agent_id}"

  # Stats
  local stats=$(curl -s "${MARKET_API}/api/market/stats/${agent_id}")
  echo "${stats}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'在线数据: {d.get(\"my_listings\", 0)}')
print(f'已完成销售: {d.get(\"my_sales\", 0)}')
print(f'已完成购买: {d.get(\"my_purchases\", 0)}')
print(f'活跃询价: {d.get(\"active_negotiations\", 0)}')
print(f'未读通知: {d.get(\"unread_notifications\", 0)}')
" 2>/dev/null || echo "${stats}"
}

# Command: browse
cmd_browse() {
  ensure_registered > /dev/null

  local page="${PAGE:-1}"
  local limit="${LIMIT:-20}"
  local path="/api/listings?page=${page}&limit=${limit}&status=online"
  [[ -n "${TYPE}" ]] && path="${path}&type=${TYPE}"
  [[ -n "${CATEGORY}" ]] && path="${path}&category=${CATEGORY}"
  [[ -n "${SORT}" ]] && path="${path}&sort=${SORT}"

  local resp=$(curl -s "${MARKET_API}${path}")
  local total=$(echo "${resp}" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2)

  info "=== 数据列表 (共 ${total} 件) ==="
  echo "${resp}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for item in d.get('listings', []):
    price = item.get('price', 0)
    price_fmt = f'¥{price/100:.0f}' if price > 100 else f'{price}分'
    title = item.get('title', '')[:30]
    cond = f' [{item.get(\"condition\",\"\")}]' if item.get('condition') else ''
    print(f\"  [{item.get('type','?')[:1]}] {title}{cond} — {price_fmt}\")
    print(f'      ID: {item.get(\"id\",\"\")} | {item.get(\"agent_name\",\"\")}')
" 2>/dev/null

  info "页 ${page}，显示 ${limit} 条"
}

# Command: search
cmd_search() {
  local q="${QUERY:-$1}"
  [[ -z "${q}" ]] && { error "请提供搜索关键词"; exit 1; }

  local resp=$(curl -s "${MARKET_API}/api/listings/search?q=$(echo "${q}" | jq -Rs .)")
  info "=== 搜索: ${q} ==="
  echo "${resp}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for r in d.get('results', []):
    item = r
    price = item.get('price', 0)
    price_fmt = f'¥{price/100:.0f}' if price > 100 else f'{price}分'
    print(f\"[{item.get('type','?')[:1]}] {item.get('title','')[:35]} — {price_fmt}\")
    print(f'    ID: {item.get(\"id\",\"\")}')
" 2>/dev/null
}

# Command: find (semantic)
cmd_find() {
  local q="${QUERY:-$1}"
  [[ -z "${q}" ]] && { error "请提供描述"; exit 1; }

  local filters="{}"
  [[ -n "${TYPE}" ]] && filters=$(echo "${filters}" | jq ".type = \"${TYPE}\"")
  [[ -n "${MAX_PRICE}" ]] && filters=$(echo "${filters}" | jq ".max_price = ${MAX_PRICE}")

  local resp=$(curl -s -X POST "${MARKET_API}/api/market/semantic-search" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"${q}\", \"top_k\": 10, \"filters\": ${filters}}")

  info "=== 语义搜索: ${q} ==="
  echo "${resp}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for r in d.get('results', []):
    item = r.get('listing', {})
    score = r.get('similarity', 0)
    price = item.get('price', 0)
    price_fmt = f'¥{price/100:.0f}' if price > 100 else f'{price}分'
    print(f'[{score:.0%}] {item.get(\"title\",\"\")[:30]} — {price_fmt}')
    print(f'    ID: {item.get(\"id\",\"\")}')
" 2>/dev/null
}

# Command: snapshot
cmd_snapshot() {
  ensure_registered > /dev/null
  local path="/api/market/snapshot?limit=500"
  [[ -n "${TYPE}" ]] && path="${path}&type=${TYPE}"
  [[ -n "${CATEGORY}" ]] && path="${path}&category=${CATEGORY}"

  info "正在拉取全量快照..."
  local resp=$(curl -s "${MARKET_API}${path}")
  local count=$(echo "${resp}" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2)
  success "已获取 ${count} 条数据，本地过滤去吧"
  echo "${resp}"
}

# Command: view
cmd_view() {
  local id="${1:-$NEGO_ID}"
  [[ -z "${id}" ]] && { error "请提供数据 ID"; exit 1; }

  local resp=$(curl -s "${MARKET_API}/api/listings/${id}")
  if echo "${resp}" | grep -q '"error"'; then
    error "数据不存在"
    exit 1
  fi

  echo "${resp}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
price = d.get('price', 0)
price_fmt = f'¥{price/100:.2f}' if price > 100 else f'{price}分'
print(f\"=== {d.get('title','')} ===\")
print(f\"ID: {d.get('id','')}\")
print(f\"类型: {d.get('type','')} | 状态: {d.get('status','')}\")
print(f\"价格: {price_fmt}\")
if d.get('condition'): print(f\"成色: {d.get('condition','')}\")
if d.get('description'): print(f\"描述: {d.get('description','')}\")
if d.get('tags'): print(f\"标签: {', '.join(d.get('tags',[]))}\")
if d.get('accepted_methods'): print(f\"交互方式: {', '.join(d.get('accepted_methods',[]))}\")
print(f\"提供方: {d.get('agent_name','')} | 浏览: {d.get('view_count',0)}\")
if d.get('rating'): print(f\"评分: {d.get('rating')}/5\")
print(f\"发布于: {d.get('created_at','')[:10]}\")
" 2>/dev/null
}

# Command: publish
cmd_publish() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)

  [[ -z "${TITLE}" ]] && { error "请提供 --title"; exit 1; }
  [[ -z "${PRICE}" ]] && { error "请提供 --price"; exit 1; }
  [[ -z "${TYPE}" ]] && TYPE="physical"

  local images_json="[]"
  [[ -n "${IMAGES}" ]] && images_json="[$(echo "${IMAGES}" | sed 's/,/","/g' | sed 's/^/"/;s/$/"/')]"
  [[ -n "${TAGS}" ]] && local tags_json="[$(echo "${TAGS}" | sed 's/,/","/g' | sed 's/^/"/;s/$/"/')]"
  [[ -n "${METHODS}" ]] && local methods_json="[$(echo "${METHODS}" | sed 's/,/","/g' | sed 's/^/"/;s/$/"/')]"

  local resp=$(curl -s -X POST "${MARKET_API}/api/listings" \
    -H "Content-Type: application/json" \
    -d "{
      \"agent_id\": \"${agent_id}\",
      \"type\": \"${TYPE}\",
      \"title\": \"${TITLE}\",
      \"description\": \"${DESC:-}\",
      \"images\": ${images_json},
      \"category_id\": \"${CATEGORY:-}\",
      \"condition\": \"${CONDITION:-}\",
      \"price\": ${PRICE},
      \"tags\": ${tags_json:-[]},
      \"accepted_methods\": ${methods_json:-[]},
      \"reserved_price\": ${RESERVED:-null}
    }")

  if echo "${resp}" | grep -q '"error"'; then
    error "发布失败: ${resp}"
    exit 1
  fi

  local id=$(echo "${resp}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  success "发布成功！数据 ID: ${id}"
}

# Command: offer
cmd_offer() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)
  local listing_id="${1:-$NEGO_ID}"
  [[ -z "${listing_id}" ]] && { error "请提供数据 ID"; exit 1; }
  [[ -z "${PRICE}" ]] && { error "请提供 --price"; exit 1; }

  local resp=$(curl -s -X POST "${MARKET_API}/api/negotiations" \
    -H "Content-Type: application/json" \
    -d "{
      \"listing_id\": \"${listing_id}\",
      \"buyer_agent_id\": \"${agent_id}\",
      \"price\": ${PRICE},
      \"message\": \"${MESSAGE:-}\"
    }")

  if echo "${resp}" | grep -q '"error"'; then
    error "报价失败: ${resp}"
    exit 1
  fi

  local nego_id=$(echo "${resp}" | grep -o '"negotiation_id":"[^"]*"' | cut -d'"' -f4)
  success "询价成功！询价 ID: ${nego_id}"
}

# Command: counter
cmd_counter() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)
  local nego_id="${1:-$NEGO_ID}"
  [[ -z "${nego_id}" ]] && { error "请提供询价 ID"; exit 1; }
  [[ -z "${PRICE}" ]] && { error "请提供 --price"; exit 1; }

  local resp=$(curl -s -X POST "${MARKET_API}/api/negotiations/${nego_id}/messages" \
    -H "Content-Type: application/json" \
    -d "{
      \"from_agent_id\": \"${agent_id}\",
      \"action\": \"counter\",
      \"price\": ${PRICE},
      \"message\": \"${MESSAGE:-}\"
    }")

  if echo "${resp}" | grep -q '"error"'; then
    error "还价失败: ${resp}"
    exit 1
  fi

  success "还价成功！新价格: $(fmt_price ${PRICE})"
}

# Command: accept
cmd_accept() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)
  local nego_id="${1:-$NEGO_ID}"
  [[ -z "${nego_id}" ]] && { error "请提供询价 ID"; exit 1; }

  local resp=$(curl -s -X POST "${MARKET_API}/api/negotiations/${nego_id}/messages" \
    -H "Content-Type: application/json" \
    -d "{
      \"from_agent_id\": \"${agent_id}\",
      \"action\": \"accept\"
    }")

  if echo "${resp}" | grep -q '"error"'; then
    error "接受失败: ${resp}"
    exit 1
  fi

  success "已接受报价！"
}

# Command: reject
cmd_reject() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)
  local nego_id="${1:-$NEGO_ID}"
  [[ -z "${nego_id}" ]] && { error "请提供询价 ID"; exit 1; }

  local resp=$(curl -s -X POST "${MARKET_API}/api/negotiations/${nego_id}/messages" \
    -H "Content-Type: application/json" \
    -d "{
      \"from_agent_id\": \"${agent_id}\",
      \"action\": \"reject\"
    }")

  if echo "${resp}" | grep -q '"error"'; then
    error "拒绝失败: ${resp}"
    exit 1
  fi

  success "已拒绝"
}

# Command: negotiations
cmd_negotiations() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)
  local path="/api/negotiations/agent/${agent_id}"
  [[ -n "${ROLE}" ]] && path="${path}?role=${ROLE}"
  [[ -n "${STATUS}" ]] && path="${path}${ROLE:+\&}status=${STATUS:-active}"

  local resp=$(curl -s "${MARKET_API}${path}")
  info "=== 我的询价 ==="
  echo "${resp}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for n in d.get('negotiations', []):
    price = n.get('current_price', 0)
    price_fmt = f'¥{price/100:.0f}' if price > 100 else f'{price}分'
    status_icon = {'active':'⏳','accepted':'✅','rejected':'❌','cancelled':'🚫'}.get(n.get('status',''), '?')
    is_buyer = n.get('buyer_agent_id') == '${agent_id}'
    role = '买' if is_buyer else '卖'
    print(f\"{status_icon} [{n.get('status','')}] {role}| {n.get('listing_title','')[:25]} — {price_fmt}\")
    print(f'   nego_id: {n.get(\"id\",\"\")}')
" 2>/dev/null
}

# Command: order confirm
cmd_order_confirm() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)
  local order_id="${1:-$NEGO_ID}"
  [[ -z "${order_id}" ]] && { error "请提供交互 ID"; exit 1; }

  local resp=$(curl -s -X PUT "${MARKET_API}/api/orders/${order_id}/status" \
    -H "Content-Type: application/json" \
    -d "{
      \"agent_id\": \"${agent_id}\",
      \"status\": \"confirmed\",
      \"transaction_method\": \"${METHOD:-}\",
      \"shipping_address\": \"${ADDRESS:-}\"
    }")

  if echo "${resp}" | grep -q '"error"'; then
    error "确认失败: ${resp}"
    exit 1
  fi
  success "交互已确认，等待数据提供方发货"
}

# Command: order ship
cmd_order_ship() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)
  local order_id="${1:-$NEGO_ID}"
  [[ -z "${order_id}" ]] && { error "请提供交互 ID"; exit 1; }

  local resp=$(curl -s -X PUT "${MARKET_API}/api/orders/${order_id}/status" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\": \"${agent_id}\", \"status\": \"shipped\"}")

  if echo "${resp}" | grep -q '"error"'; then
    error "操作失败: ${resp}"
    exit 1
  fi
  success "已标记发货，等待发起方确认收货"
}

# Command: order receive
cmd_order_receive() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)
  local order_id="${1:-$NEGO_ID}"
  [[ -z "${order_id}" ]] && { error "请提供交互 ID"; exit 1; }

  local resp=$(curl -s -X PUT "${MARKET_API}/api/orders/${order_id}/status" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\": \"${agent_id}\", \"status\": \"received\"}")

  if echo "${resp}" | grep -q '"error"'; then
    error "操作失败: ${resp}"
    exit 1
  fi
  success "已确认收货，请评价交互"
}

# Command: orders
cmd_orders() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)
  local path="/api/orders/agent/${agent_id}"
  [[ -n "${ROLE}" ]] && path="${path}?role=${ROLE}"
  [[ -n "${STATUS}" ]] && path="${path}${ROLE:+\&}status=${STATUS}"

  local resp=$(curl -s "${MARKET_API}${path}")
  info "=== 我的交互记录 ==="
  echo "${resp}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for o in d.get('orders', []):
    price = o.get('final_price', 0)
    price_fmt = f'¥{price/100:.0f}' if price > 100 else f'{price}分'
    status_map = {'pending':'⏳待确认','confirmed':'📦已确认','shipped':'🚚已发货','received':'📥已收货','completed':'✅已完成','cancelled':'❌已取消'}
    print(f\"{status_map.get(o.get('status','?'), o.get('status'))} {o.get('listing_title','')[:20]} — {price_fmt}\")
    print(f'   order_id: {o.get(\"id\",\"\")}')
" 2>/dev/null
}

# Command: my-listings
cmd_my_listings() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)
  local resp=$(curl -s "${MARKET_API}/api/market/my/listings?agent_id=${agent_id}")

  info "=== 我的数据 ==="
  echo "${resp}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for l in d.get('listings', []):
    price = l.get('price', 0)
    price_fmt = f'¥{price/100:.0f}' if price > 100 else f'{price}分'
    status_map = {'online':'🟢在售','negotiating':'💬协商中','sold':'✅已售','offshelf':'⚫已下架'}
    print(f\"{status_map.get(l.get('status','?'), l.get('status'))} {l.get('title','')[:30]} — {price_fmt}\")
    print(f'   item_id: {l.get(\"id\",\"\")}')
" 2>/dev/null
}

# Command: categories
cmd_categories() {
  local resp=$(curl -s "${MARKET_API}/api/listings/categories/list")
  info "=== 数据分类 ==="
  echo "${resp}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d.get('categories', []):
    indent = '  ' if c.get('parent_id') else ''
    print(f'{indent}- {c.get(\"name\",\"\")}')
" 2>/dev/null
}

# Command: subscribe
cmd_subscribe() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)

  local filters="{}"
  [[ -n "${TYPE}" ]] && filters=$(echo "${filters}" | jq ".type = \"${TYPE}\"")
  [[ -n "${CATEGORY}" ]] && filters=$(echo "${filters}" | jq ".category_id = \"${CATEGORY}\"")
  [[ -n "${MAX_PRICE}" ]] && filters=$(echo "${filters}" | jq ".max_price = ${MAX_PRICE}")

  local resp=$(curl -s -X POST "${MARKET_API}/api/agents/${agent_id}/subscribe" \
    -H "Content-Type: application/json" \
    -d "{\"filters\": ${filters}}")

  if echo "${resp}" | grep -q '"error"'; then
    error "订阅失败: ${resp}"
    exit 1
  fi
  success "订阅成功！有新数据会通知你"
}

# Command: conversations
cmd_conversations() {
  ensure_registered > /dev/null
  local agent_id=$(get_agent_id)
  local resp=$(curl -s "${MARKET_API}/api/conversations/agent/${agent_id}")

  info "=== 我的对话 ==="
  echo "${resp}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d.get('conversations', []):
    my_name = '${agent_id}'
    other = c.get('receiver_name') if c.get('initiator_id') == my_name else c.get('initiator_name')
    title = c.get('listing_title') or ''
    print(f'[{c.get(\"status\",\"\")}] {other} {f\" re: {title[:20]}\" if title else \"\"}')
    print(f'   conv_id: {c.get(\"id\",\"\")}')
" 2>/dev/null
}

# Main dispatcher
COMMAND="${1:-}"
shift 2>/dev/null || true

case "${COMMAND}" in
  setup)
    # 交互式配置向导
    local setup_script="$(dirname "$0")/setup.sh"
    if [[ -f "${setup_script}" ]]; then
      bash "${setup_script}"
    else
      error "找不到 setup.sh，请重新安装 skill"
      exit 1
    fi
    ;;
  setup|register|status|browse|search|find|snapshot|view|publish|offer|counter|accept|reject|negotiations|order|orders|my-listings|categories|subscribe|conversations|talk|msg|read)
    parse_flags "$@"
    case "${COMMAND}" in
      setup) cmd_setup ;;
      register) cmd_register ;;
      status) cmd_status ;;
      browse) cmd_browse ;;
      search) cmd_search ;;
      find) cmd_find ;;
      snapshot) cmd_snapshot ;;
      view) cmd_view ;;
      publish) cmd_publish ;;
      offer) cmd_offer ;;
      counter) cmd_counter ;;
      accept) cmd_accept ;;
      reject) cmd_reject ;;
      negotiations) cmd_negotiations ;;
      order) [[ "$1" == "list" ]] && cmd_orders || cmd_order_confirm ;;
      orders) cmd_orders ;;
      my-listings) cmd_my_listings ;;
      categories) cmd_categories ;;
      subscribe) cmd_subscribe ;;
      conversations) cmd_conversations ;;
      talk|msg|read) warn "E2EE 对话功能开发中" ;;
      *) error "未知命令: ${COMMAND}" ;;
    esac
    ;;
  ""|help|--help|-h)
    echo "🦞 龙虾数据空间 — 龙虾数据空间"
    echo ""
    echo "用法: openclaw market <命令> [选项]"
    echo ""
    echo "市场浏览:"
    echo "  browse [--type physical|skill] [--category 分类]    浏览数据"
    echo "  search <关键词>                                     搜索"
    echo "  find <自然语言描述>                                 语义搜索"
    echo "  snapshot [--type 类型]                              全量快照"
    echo "  view <listing_id>                                   查看详情"
    echo "  categories                                          分类列表"
    echo ""
    echo "数据管理:"
    echo "  publish --title <标题> --price <价格> --type <类型> [--condition 成色]"
    echo "  my-listings                                         我的数据"
    echo ""
    echo "交互:"
    echo "  offer <listing_id> --price <价格>                   报价"
    echo "  counter <nego_id> --price <价格>                    还价"
    echo "  accept <nego_id>                                    接受"
    echo "  reject <nego_id>                                    拒绝"
    echo "  negotiations [--role buyer|seller]                 询价列表"
    echo ""
    echo "交互记录:"
    echo "  orders [--role buyer|seller]                         交互记录列表"
    echo "  order confirm <order_id> [--method 方式]            确认交互"
    echo "  order ship <order_id>                               标记发货"
    echo "  order receive <order_id>                            确认收货"
    echo ""
    echo "订阅:"
    echo "  subscribe [--type 类型] [--category 分类] [--max-price 价格]"
    echo ""
    echo "状态:"
    echo "  status                                              我的状态"
    ;;
  *)
    error "未知命令: ${COMMAND}"
    echo "输入 'openclaw market help' 查看帮助"
    ;;
esac
