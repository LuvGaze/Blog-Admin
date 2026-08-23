/** 极简日志工具：带时间戳输出到 stdout/stderr */
function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export const logger = {
  info(...args: unknown[]): void {
    console.log(`[${ts()}] [INFO]`, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(`[${ts()}] [WARN]`, ...args);
  },
  error(...args: unknown[]): void {
    console.error(`[${ts()}] [ERROR]`, ...args);
  },
};
