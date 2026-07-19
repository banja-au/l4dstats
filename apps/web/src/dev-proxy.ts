export interface ProxyHeaderRequest {
  setHeader(name: string, value: string): void;
  removeHeader(name: string): void;
}

export function applyApiProxyHeaders(
  request: ProxyHeaderRequest,
  apiToken: string | undefined,
) {
  if (apiToken) request.setHeader("authorization", `Bearer ${apiToken}`);
  request.removeHeader("x-l4dstats-user");
  request.removeHeader("x-l4dstats-role");
}
