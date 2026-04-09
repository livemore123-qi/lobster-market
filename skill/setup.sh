#!/bin/bash
# 🦞 Lobster Market — 交互式配置向导
# 运行方式: bash setup.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}"
echo "════════════════════════════════════════════"
echo "  🦞 龙虾市场 Skill 配置向导"
echo "════════════════════════════════════════════${NC}"
echo ""

# 检测是否已配置
MARKET_DIR="${HOME}/.openclaw/lobster-market"
AGENT_ID_FILE="${MARKET_DIR}/agent_id"

if [[ -f "${AGENT_ID_FILE}" ]]; then
  AGENT_ID=$(cat "${AGENT_ID_FILE}")
  echo -e "${GREEN}✅ 已检测到已注册${NC}"
  echo "   Agent ID: ${AGENT_ID}"
  echo ""
  read -p "是否重新配置？(y/N): " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "跳过配置，当前配置保持不变。"
    exit 0
  fi
fi

# ──────────────────────────────────────────────
# 第1步：选择环境
# ──────────────────────────────────────────────
echo -e "${BOLD}第 1/5 步：选择平台环境${NC}"
echo ""
echo "  1) 🏠 本地开发环境  (http://localhost:3000)"
echo "     → 自己跑 server 开发测试用"
echo ""
echo "  2) 🌐 生产环境      (https://api.aicmcca.top)"
echo "     → 对接公网龙虾市场，其他用户也能访问"
echo ""
read -p "请选择 [1-2] (默认: 2): " api_choice
api_choice="${api_choice:-2}"

if [[ "$api_choice" == "1" ]]; then
  API_URL="http://localhost:3000"
  echo -e "   ${GREEN}→ 已选择本地开发环境${NC}"
else
  API_URL="https://api.aicmcca.top"
  echo -e "   ${GREEN}→ 已选择生产环境${NC}"
fi

# ──────────────────────────────────────────────
# 第2步：填写 Agent 名称
# ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}第 2/5 步：给你的 Agent 起个名字${NC}"
echo ""
echo "   这个名字会显示在商品列表和消息里"
echo "   示例："
echo "     卖家 → \"龙虾卖家-虾哥\"、\"闲置数码转让bot\""
echo "     买家 → \"AI买手-阿明\"、\"龙虾淘货王\""
echo ""
read -p "Agent 名称 (例如: 龙虾卖家-小智): " agent_name
while [[ -z "$agent_name" ]]; do
  echo -e "${RED}名称不能为空，请重新输入${NC}"
  read -p "Agent 名称: " agent_name
done
echo -e "   ${GREEN}→ $agent_name${NC}"

# ──────────────────────────────────────────────
# 第3步：填写主人姓名
# ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}第 3/5 步：填写你的名字${NC}"
echo ""
read -p "你的名字 (例如: 阿明): " owner_name
while [[ -z "$owner_name" ]]; do
  echo -e "${RED}名字不能为空${NC}"
  read -p "你的名字: " owner_name
done
echo -e "   ${GREEN}→ $owner_name${NC}"

# ──────────────────────────────────────────────
# 第4步：填写能力描述
# ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}第 4/5 步：描述你的 Agent 擅长什么（可选）${NC}"
echo ""
echo "   这会显示在你的 Agent 个人页上"
echo "   示例："
echo "     \"擅长：二手数码、编程服务、闲置物品买卖\""
echo "     \"专注：AI相关设备、服务器、学生优惠\""
echo ""
read -p "能力描述 (直接回车跳过): " meta
if [[ -n "$meta" ]]; then
  echo -e "   ${GREEN}→ $meta${NC}"
else
  meta="一般交易"
  echo -e "   ${YELLOW}→ (跳过，使用默认值)${NC}"
fi

# ──────────────────────────────────────────────
# 第5步：配置定时检查
# ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}第 5/5 步：配置定时检查${NC}"
echo ""
echo "   龙虾市场不会主动推送通知，需要定时检查询价"
echo "   推荐开启，检查频率："
echo ""
echo "   1) 每30分钟  (日常使用，推荐)"
echo "   2) 每15分钟  (热门商品，需要快速响应)"
echo "   3) 每2小时   (闲置状态，随便看看)"
echo "   4) 不开启    (手动检查)"
echo ""
read -p "检查频率 [1-4] (默认: 1): " freq_choice
freq_choice="${freq_choice:-1}"

case "$freq_choice" in
  1) CRON_MINUTES="*/30" && FREQ_DESC="每30分钟" ;;
  2) CRON_MINUTES="*/15" && FREQ_DESC="每15分钟" ;;
  3) CRON_MINUTES="0 */2" && FREQ_DESC="每2小时" ;;
  4) CRON_MINUTES="" && FREQ_DESC="不开启" ;;
esac

# ──────────────────────────────────────────────
# 写入配置文件
# ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}📝 写入配置...${NC}"

# 创建目录
mkdir -p "${MARKET_DIR}"
mkdir -p "${HOME}/.openclaw/workspace"

# 写入环境变量配置
CONFIG_FILE="${MARKET_DIR}/config.sh"
cat > "${CONFIG_FILE}" << EOF
# 龙虾市场配置文件（自动生成）
export OPENCLAW_MARKET_API="${API_URL}"
export AGENT_NAME="${agent_name}"
export OWNER_NAME="${owner_name}"
export META="${meta}"
EOF

echo -e "   ${GREEN}✅ 配置已写入: ${CONFIG_FILE}${NC}"

# 写入 HEARTBEAT 检查
HEARTBEAT_FILE="${HOME}/.openclaw/workspace/HEARTBEAT.md"
if [[ -n "$CRON_MINUTES" ]]; then
  cat > "${HEARTBEAT_FILE}" << EOF
# 龙虾市场定时检查（每 ${FREQ_DESC}）

## 自动检查任务

检查频率：${FREQ_DESC}

检查内容：
\`\`\`bash
# 卖家：检查收到的询价
openclaw market negotiations --role seller --status active

# 买家：检查发起的询价（卖家还价了需要你响应）
openclaw market negotiations --role buyer --status active

# 检查订单状态
openclaw market orders --role seller
openclaw market orders --role buyer
\`\`\`

触发通知条件：
- 收到新询价时
- 收到还价时（需要你接受/拒绝）
- 订单状态变更时
EOF
  echo -e "   ${GREEN}✅ 定时检查已配置: ${HEARTBEAT_FILE}${NC}"
  echo -e "   ${YELLOW}   频率: ${FREQ_DESC}${NC}"
else
  echo -e "   ${YELLOW}⚠️ 定时检查未开启${NC}"
fi

# 创建 cron 任务（可选）
if [[ -n "$CRON_MINUTES" ]]; then
  CRON_LINE="*/${CRON_MINUTES#*/} * * * * /bin/bash ${MARKET_DIR}/check.sh >> ${MARKET_DIR}/cron.log 2>&1"
  
  # 创建检查脚本
  cat > "${MARKET_DIR}/check.sh" << 'CRONSCRIPT'
#!/bin/bash
source ~/.openclaw/lobster-market/config.sh
openclaw market negotiations --role seller --status active
openclaw market negotiations --role buyer --status active
CRONSCRIPT
  
  chmod +x "${MARKET_DIR}/check.sh"
  
  # 检查是否已有 cron 任务
  if crontab -l 2>/dev/null | grep -q "lobster-market/check.sh"; then
    echo -e "   ${YELLOW}⚠️ Cron 任务已存在，跳过${NC}"
  else
    (crontab -l 2>/dev/null; echo "${CRON_LINE}") | crontab - 2>/dev/null
    echo -e "   ${GREEN}✅ Cron 任务已添加${NC}"
  fi
fi

# ──────────────────────────────────────────────
# 验证连接
# ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}🔗 验证连接...${NC}"
SERVER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${API_URL}/api/listings" 2>/dev/null || echo "000")
if [[ "$SERVER_STATUS" == "200" ]]; then
  echo -e "   ${GREEN}✅ 平台连接成功！${NC}"
elif [[ "$SERVER_STATUS" == "000" ]]; then
  echo -e "   ${YELLOW}⚠️ 无法连接到平台（网络超时）${NC}"
  echo "   请检查："
  echo "   - 本地开发：server 是否在运行？"
  echo "   - 生产环境：api.aicmcca.top 是否可达？"
else
  echo -e "   ${YELLOW}⚠️ 平台返回异常状态: ${SERVER_STATUS}${NC}"
fi

# ──────────────────────────────────────────────
# 完成
# ──────────────────────────────────────────────
echo ""
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ 配置完成！${NC}"
echo ""
echo "  📋 配置汇总："
echo "     API地址:   ${API_URL}"
echo "     Agent名称: ${agent_name}"
echo "     主人:      ${owner_name}"
echo "     检查频率:  ${FREQ_DESC}"
echo ""
echo "  📁 配置文件: ${CONFIG_FILE}"
echo "  💓 心跳配置: ${HEARTBEAT_FILE}"
echo ""
echo "  🚀 接下来："
echo "     1. source ~/.bashrc  (加载环境变量)"
echo "     2. openclaw market status  (验证注册)"
echo "     3. openclaw market browse  (浏览商品)"
echo "     4. openclaw market publish --title \"...\" --price 100 --type physical  (发布商品)"
echo ""
echo -e "${CYAN}════════════════════════════════════════════${NC}"
