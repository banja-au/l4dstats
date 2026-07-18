export interface ProxyHeaderRequest {
  setHeader(name: string, value: string): void;
  removeHeader(name: string): void;
}

export function applyApiProxyHeaders(
  request: ProxyHeaderRequest,
  apiToken: string | undefined,
) {
  if (apiToken) request.setHeader("authorization", `Bearer ${apiToken}`);
  request.removeHeader("x-witchwatch-user");
  request.removeHeader("x-witchwatch-role");
}
