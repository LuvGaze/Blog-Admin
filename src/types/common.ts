/** 通用 API 响应类型 */
export interface ApiResponse<T = unknown> {
  code: 0;
  data: T;
}

export interface ApiErrorResponse {
  code: number;
  message: string;
}
