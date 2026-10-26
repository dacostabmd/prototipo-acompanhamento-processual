import Link from 'next/link';
import { FileQuestion, Home, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0B1730',
        color: '#FFFFFF',
        padding: '24px',
        textAlign: 'center',
        fontFamily: 'var(--font-inter-tight), "Inter Tight", -apple-system, sans-serif'
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
          color: '#60A5FA'
        }}
      >
        <FileQuestion size={40} />
      </div>

      <h1
        style={{
          fontSize: '2.5rem',
          fontWeight: 700,
          marginBottom: 12,
          letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, #FFFFFF 0%, #94A3B8 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}
      >
        404 — Página Não Encontrada
      </h1>

      <p
        style={{
          color: '#94A3B8',
          fontSize: '1.1rem',
          maxWidth: 480,
          lineHeight: 1.6,
          marginBottom: 32
        }}
      >
        O recurso, processo ou endereço que você procurou não existe, foi movido ou está temporariamente indisponível.
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: '#2563EB',
            color: '#FFFFFF',
            padding: '12px 24px',
            borderRadius: 10,
            fontWeight: 600,
            textDecoration: 'none',
            transition: 'background 0.2s ease'
          }}
        >
          <Home size={18} />
          Voltar ao Início
        </Link>
        <Link
          href="/painel"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#E2E8F0',
            padding: '12px 24px',
            borderRadius: 10,
            fontWeight: 600,
            textDecoration: 'none',
            transition: 'background 0.2s ease'
          }}
        >
          <ArrowLeft size={18} />
          Acessar Painel
        </Link>
      </div>
    </div>
  );
}
