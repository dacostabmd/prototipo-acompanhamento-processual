import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const alt = 'JusConsulta | Acompanhamento Processual Inteligente';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          backgroundColor: '#070C18',
          padding: '64px 80px',
          backgroundImage:
            'radial-gradient(circle at 10% 20%, rgba(30, 124, 242, 0.18) 0%, transparent 40%), radial-gradient(circle at 90% 80%, rgba(63, 160, 255, 0.12) 0%, transparent 40%)'
        }}
      >
        {/* Top Header / Brand Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              backgroundColor: '#1E7CF2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '26px'
            }}
          >
            J
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#ffffff', fontSize: '28px', fontWeight: 700, letterSpacing: '-0.5px' }}>
              Jus<span style={{ color: '#1E7CF2' }}>Consulta</span>
            </span>
            <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '13px', fontWeight: 500 }}>
              Uma solução jurídica TechTie
            </span>
          </div>
        </div>

        {/* Center Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '960px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              borderRadius: '9999px',
              border: '1px solid rgba(30, 124, 242, 0.4)',
              backgroundColor: 'rgba(30, 124, 242, 0.12)',
              padding: '6px 18px',
              width: 'fit-content'
            }}
          >
            <span style={{ color: '#1E7CF2', fontSize: '15px', fontWeight: 600 }}>
              Inteligência Artificial + WhatsApp 24/7
            </span>
          </div>

          <h1
            style={{
              color: '#ffffff',
              fontSize: '56px',
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: '-1.5px',
              margin: 0
            }}
          >
            Acompanhamento Processual com Inteligência de Verdade
          </h1>

          <p
            style={{
              color: 'rgba(255, 255, 255, 0.65)',
              fontSize: '22px',
              lineHeight: 1.4,
              margin: 0
            }}
          >
            Adeus juridiquês e sustos de penhora. Despachos traduzidos para linguagem humana e atendimento direto no seu WhatsApp.
          </p>
        </div>

        {/* Bottom Feature Badges */}
        <div style={{ display: 'flex', gap: '28px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '9999px', backgroundColor: '#25D366' }} />
            <span style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '16px', fontWeight: 600 }}>
              WhatsApp Bidirecional
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '9999px', backgroundColor: '#1E7CF2' }} />
            <span style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '16px', fontWeight: 600 }}>
              Smart Digest Anti-Spam
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '9999px', backgroundColor: '#F59E0B' }} />
            <span style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '16px', fontWeight: 600 }}>
              Blindagem Sisbajud & Prazos
            </span>
          </div>
        </div>
      </div>
    ),
    {
      ...size
    }
  );
}
