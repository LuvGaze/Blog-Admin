/**
 * 服务统一入口（admin 独立工程）
 * 启动：npm run dev / npm start；默认端口 3344，可用 PORT 环境变量覆盖
 * 后台页面：http://localhost:3344/admin
 */
import { app } from "./app.js";
import { PORT } from "./config/env.js";
import { logger } from "./utils/logger.js";

app.listen(PORT, () => {
  logger.info(`Blog 管理后台已启动：http://localhost:${PORT}/admin`);
  // logger.info(`API 基础路径：http://localhost:${PORT}/api`);
});
