const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "../survey.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now')),
    ip_address TEXT,
    province TEXT,
    interview_role TEXT,
    client_company TEXT,
    client_industry TEXT,
    interviewee_name TEXT,
    project_stage TEXT,
    core_scenario TEXT,
    budget TEXT,
    our_advantages TEXT,
    our_disadvantages TEXT,
    competitor_name TEXT,
    competitor_scenario TEXT,
    competitor_price_range TEXT,
    our_gap TEXT,
    improvement TEXT,
    submitter TEXT,
    submit_date TEXT,
    remarks TEXT
  )
`);

module.exports = db;
