/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { optimizePackageImports: ["@phosphor-icons/react"] },

  async rewrites() {
    return [
      // OAuth 元数据发现路径（RFC 8414 的 oauth-authorization-server、RFC 9728 的
      // oauth-protected-resource）。本服务只用静态 Bearer API Key、不提供 OAuth，
      // 但 MCP 客户端在收到 401 后会按规范来这几个路径寻找 OAuth 元数据。
      //
      // Next.js 对 `.well-known` 这种点开头的 app 目录支持不可靠，所以改写到
      // /api/well-known/*，由 route handler 统一返回 JSON。
      // 否则这些请求会落到应用的 HTML 404 页，客户端 JSON.parse 失败后抛出
      // "Invalid OAuth error response: Unexpected token '<'"，把真实原因（缺 key）完全掩盖。
      { source: "/.well-known/:path*", destination: "/api/well-known/:path*" },
    ];
  },
};

export default nextConfig;
