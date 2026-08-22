import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  transpilePackages: ["@discloud/ui"],
}

export default nextConfig