const express = require("express");
const router = express.Router();
const db = require("../db");
const https = require("https");

const API_SECRET = "9sK2\\$pR7\\\\!vQ5\\&bG8";

function verifySecret(req, res, next) {
  const token = req.headers["x-api-secret"];
  if (token === API_SECRET) {
    next();
  } else {
    res.status(401).json({ success: false, error: "未授权访问" });
  }
}

// 根据IP获取省份
function getProvince(ip) {
  return new Promise((resolve) => {
    // 跳过本地IP
    if (!ip || ip === '127.0.0.1' || ip.startsWith('192.168') || ip.startsWith('10.') || ip === '::1' || ip === '::ffff:127.0.0.1') {
      resolve('内网');
      return;
    }
    // 使用 ipinfo.io（免费、快速）
    const url = `https://ipinfo.io/${ip}/json`;
    const req2 = https.get(url, (res2) => {
      let data = '';
      res2.on('data', chunk => data += chunk);
      res2.on('end', () => {
        try {
          const info = JSON.parse(data);
          if (info.country === 'CN') {
            resolve(info.region || '未知');
          } else {
            resolve(info.country || '境外');
          }
        } catch (e) {
          resolve('未知');
        }
      });
    });
    req2.on('error', () => resolve('未知'));
    req2.end();
  });
}

// 获取真实IP
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection.remoteAddress || '未知';
}

// 提交调研表单
router.post("/submit", async (req, res) => {
  try {
    const {
      interview_role, client_company, client_industry, interviewee_name,
      project_stage, core_scenario, budget,
      our_advantages, our_disadvantages,
      competitor_name, competitor_scenario, competitor_price_range, our_gap,
      improvement, submitter, submit_date, remarks
    } = req.body;

    if (!client_company || !core_scenario || !submitter) {
      res.status(400).json({ success: false, error: "必填字段不能为空" });
      return;
    }

    const ip = getClientIp(req);
    const province = await getProvince(ip);

    const stmt = db.prepare(`
      INSERT INTO responses (
        ip_address, province,
        interview_role, client_company, client_industry, interviewee_name,
        project_stage, core_scenario, budget,
        our_advantages, our_disadvantages,
        competitor_name, competitor_scenario, competitor_price_range, our_gap,
        improvement, submitter, submit_date, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      ip, province,
      interview_role, client_company, client_industry, interviewee_name,
      project_stage, core_scenario, budget,
      our_advantages, our_disadvantages,
      competitor_name, competitor_scenario, competitor_price_range, our_gap,
      improvement, submitter, submit_date, remarks
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error("Submit error:", err);
    res.status(500).json({ success: false, error: "提交失败" });
  }
});

// 导出数据（需要验证）
router.get("/export", verifySecret, (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM responses ORDER BY created_at DESC").all();
    const industries = db.prepare("SELECT client_industry, COUNT(*) as count FROM responses GROUP BY client_industry").all();
    const stages = db.prepare("SELECT project_stage, COUNT(*) as count FROM responses GROUP BY project_stage").all();
    const provinces = db.prepare("SELECT province, COUNT(*) as count FROM responses WHERE province IS NOT NULL AND province != '' GROUP BY province").all();
    res.json({ success: true, data: rows, total: rows.length, industries, stages, provinces });
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ success: false, error: "导出失败" });
  }
});

module.exports = router;
