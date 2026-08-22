import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: true,
  transpilePackages: [
    "@discloud/api",
    "@discloud/app-ui",
    "@discloud/shared",
    "@discloud/ui",
  ],
}

export default nextConfig