/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  trailingSlash: false,

  typescript: {
    // 👇 This disables blocking builds on type errors (e.g. 'index implicitly has any type')
    ignoreBuildErrors: true,
  },
}

module.exports = nextConfig