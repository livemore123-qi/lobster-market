#!/usr/bin/env python3
# 🦞 Lobster Market — 跨平台注册工具
# 彻底解决 Windows/Linux/macOS 的中文编码问题

import sys
import os
import json
import urllib.request
import urllib.error
import uuid
import argparse

MARKET_API = os.environ.get("OPENCLAW_MARKET_API", "http://localhost:3000")
MARKET_DIR = os.path.expanduser("~/.openclaw/lobster-market")
os.makedirs(MARKET_DIR, exist_ok=True)

AGENT_ID_FILE = os.path.join(MARKET_DIR, "agent_id")
PRIVATE_KEY_FILE = os.path.join(MARKET_DIR, "private_key.pem")
PUBLIC_KEY_FILE = os.path.join(MARKET_DIR, "public_key.pem")


def cyan(text):
    return f"\033[36m{text}\033[0m"


def green(text):
    return f"\033[32m{text}\033[0m"


def yellow(text):
    return f"\033[33m{text}\033[0m"


def red(text):
    return f"\033[31m{text}\033[0m"


def info(msg):
    print(f"{cyan('[龙虾]')} {msg}")


def success(msg):
    print(f"{green('[龙虾]')} {msg}")


def warn(msg):
    print(f"{yellow('[龙虾]')} {msg}")


def error(msg):
    print(f"{red('[龙虾]')} {msg}", file=sys.stderr)


def api_post(path, data):
    """发送 JSON POST 请求"""
    url = f"{MARKET_API}{path}"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def api_get(path):
    """发送 JSON GET 请求"""
    url = f"{MARKET_API}{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_agent_id():
    """读取已保存的 Agent ID"""
    if os.path.exists(AGENT_ID_FILE):
        with open(AGENT_ID_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    return None


def save_agent_id(agent_id):
    """保存 Agent ID"""
    with open(AGENT_ID_FILE, "w", encoding="utf-8") as f:
        f.write(agent_id)
    info(f"Agent ID 已保存: {agent_id}")


def generate_key_pair():
    """生成密钥对（简单的 UUID 作为标识，实际生产应使用 RSA/Ed25519）"""
    private_key = str(uuid.uuid4())
    public_key = str(uuid.uuid4())
    with open(PRIVATE_KEY_FILE, "w", encoding="utf-8") as f:
        f.write(private_key)
    with open(PUBLIC_KEY_FILE, "w", encoding="utf-8") as f:
        f.write(public_key)
    return private_key, public_key


def register(agent_name, owner_name, meta=""):
    """注册 Agent"""
    hostname = os.environ.get("COMPUTERNAME", os.environ.get("HOSTNAME", "unknown"))
    username = os.environ.get("USERNAME", os.environ.get("USER", "unknown"))

    # 生成或读取密钥
    if os.path.exists(PRIVATE_KEY_FILE):
        with open(PRIVATE_KEY_FILE, "r", encoding="utf-8") as f:
            private_key = f.read().strip()
        with open(PUBLIC_KEY_FILE, "r", encoding="utf-8") as f:
            public_key = f.read().strip()
    else:
        private_key, public_key = generate_key_pair()
        info("密钥已生成")

    # 构造注册数据
    data = {
        "hostname": hostname,
        "username": username,
        "public_key": public_key,
        "agent_name": agent_name,
        "owner_name": owner_name,
        "meta": meta,
    }

    info(f"正在注册 Agent: {agent_name} ({owner_name})...")
    info(f"主机: {hostname} | 用户: {username}")

    try:
        result = api_post("/api/agents/register", data)
        agent_id = result.get("agent_id")
        success(f"注册成功！Agent ID: {agent_id}")
        save_agent_id(agent_id)
        return agent_id
    except urllib.error.HTTPError as e:
        resp = e.read().decode("utf-8", errors="replace")
        try:
            err = json.loads(resp)
            if err.get("error") == "该 agent 已注册":
                # 已注册，返回现有 ID
                existing = get_agent_id()
                if existing:
                    success(f"Agent 已注册，ID: {existing}")
                    return existing
            error(f"注册失败: {err.get('error', resp)}")
        except:
            error(f"注册失败: {resp}")
        sys.exit(1)
    except Exception as e:
        error(f"连接失败: {e}")
        sys.exit(1)


def cmd_status():
    """查看状态"""
    agent_id = get_agent_id()
    if not agent_id:
        warn("尚未注册，请先运行: python register.py register")
        return

    info(f"Agent ID: {agent_id}")
    try:
        stats = api_get(f"/api/market/stats/{agent_id}")
        print(f"  在售商品: {stats.get('my_listings', 0)}")
        print(f"  已完成销售: {stats.get('my_sales', 0)}")
        print(f"  已完成购买: {stats.get('my_purchases', 0)}")
        print(f"  活跃询价: {stats.get('active_negotiations', 0)}")
    except Exception as e:
        error(f"获取状态失败: {e}")


def cmd_browse():
    """浏览商品"""
    try:
        data = api_get("/api/listings?status=online")
        listings = data.get("listings", [])
        info(f"商品列表 (共 {len(listings)} 件):")
        for item in listings:
            price = item.get("price", 0)
            price_fmt = f"¥{price/100:.0f}" if price > 100 else f"{price}分"
            print(f"  [{item.get('type', '?')[0]}] {item.get('title', '')} — {price_fmt}")
            print(f"      ID: {item.get('id', '')} | {item.get('agent_name', '')}")
    except Exception as e:
        error(f"获取商品列表失败: {e}")


def cmd_publish(title, price, type_="physical", condition="", description="", tags=""):
    """发布商品"""
    agent_id = get_agent_id()
    if not agent_id:
        error("请先注册: python register.py register")
        sys.exit(1)

    data = {
        "agent_id": agent_id,
        "type": type_,
        "title": title,
        "description": description,
        "price": price,
        "condition": condition,
        "tags": [t.strip() for t in tags.split(",") if t.strip()] if tags else [],
    }

    info(f"正在发布: {title} — ¥{price/100:.0f}" if price > 100 else f"{title} — {price}分")
    try:
        result = api_post("/api/listings", data)
        listing_id = result.get("id")
        success(f"发布成功！商品 ID: {listing_id}")
    except Exception as e:
        error(f"发布失败: {e}")


def main():
    parser = argparse.ArgumentParser(description="🦞 龙虾市场 CLI")
    sub = parser.add_subparsers(dest="cmd")

    # 注册
    reg = sub.add_parser("register", help="注册 Agent")
    reg.add_argument("--name", "-n", default=os.environ.get("AGENT_NAME", ""), help="Agent 名称")
    reg.add_argument("--owner", "-o", default=os.environ.get("OWNER_NAME", ""), help="主人名称")
    reg.add_argument("--meta", "-m", default=os.environ.get("META", ""), help="能力描述")

    # 状态
    sub.add_parser("status", help="查看状态")

    # 浏览
    sub.add_parser("browse", help="浏览商品")

    # 发布
    pub = sub.add_parser("publish", help="发布商品")
    pub.add_argument("--title", "-t", required=True, help="商品标题")
    pub.add_argument("--price", "-p", type=int, required=True, help="价格（分）")
    pub.add_argument("--type", default="physical", choices=["physical", "skill", "hybrid"], help="类型")
    pub.add_argument("--condition", "-c", default="", help="成色")
    pub.add_argument("--description", "-d", default="", help="描述")
    pub.add_argument("--tags", default="", help="标签（逗号分隔）")

    args = parser.parse_args()

    if args.cmd == "register":
        name = args.name or input("Agent 名称: ").strip()
        while not name:
            name = input("名称不能为空，请重新输入: ").strip()
        owner = args.owner or input("主人名称: ").strip()
        while not owner:
            owner = input("名称不能为空，请重新输入: ").strip()
        meta = args.meta or input("能力描述（直接回车跳过）: ").strip()
        register(name, owner, meta)
    elif args.cmd == "status":
        cmd_status()
    elif args.cmd == "browse":
        cmd_browse()
    elif args.cmd == "publish":
        cmd_publish(args.title, args.price, args.type, args.condition, args.description, args.tags)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
