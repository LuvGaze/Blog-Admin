/** 业务异常：controller 层统一转换为 HTTP 响应 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** 参数校验失败（400） */
export function badRequest(message: string): ApiError {
  return new ApiError(400, message);
}

/** 资源不存在（404） */
export function notFound(message = "资源不存在"): ApiError {
  return new ApiError(404, message);
}

/** 鉴权失败（401） */
export function unauthorized(message = "未登录或登录已过期"): ApiError {
  return new ApiError(401, message);
}

/** 服务器内部错误（500） */
export function internal(message = "服务器内部错误"): ApiError {
  return new ApiError(500, message);
}
