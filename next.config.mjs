/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Faz tree-shaking por ícone/componente nessas libs, reduzindo o JS enviado por rota
    // (menos bytes para baixar/parsear a cada navegação client-side).
    optimizePackageImports: ['lucide-react', '@mantine/core', '@mantine/hooks']
  }
};

export default nextConfig;
