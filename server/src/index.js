const express = require("express");
const cors = require("cors");
const path = require("path");
const surveyRouter = require("./routes/survey");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use("/api/survey", surveyRouter);

app.get("/", (req, res) => {
  res.sendFile("/root/.openclaw/workspace/survey-system/frontend/index.html");
});

app.get("/admin", (req, res) => {
  res.sendFile("/root/.openclaw/workspace/survey-system/frontend/admin.html");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`调研系统已启动: http://localhost:${PORT}`);
});
