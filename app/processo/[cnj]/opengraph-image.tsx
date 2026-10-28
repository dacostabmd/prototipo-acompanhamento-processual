import { ImageResponse } from 'next/og';
import { cleanDigits } from '@/lib/format';
import { parseCnj, formatProcessNumber } from '@/lib/cnj';

export const runtime = 'nodejs';
export const alt = 'Processo Judicial | JusConsulta';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ cnj: string }> }) {
  const { cnj } = await params;
  const digits = cleanDigits(cnj);
  const cnjFormatado = digits.length === 20 ? formatProcessNumber(digits) : cnj;
  const cnjInfo = digits.length === 20 ? parseCnj(digits) : null;
  const tribunal = cnjInfo?.tribunalLabel || cnjInfo?.tribunalNome || 'Tribunal de Justiça';
  const ramo = cnjInfo?.ramoDescricao || 'Justiça Estadual / Federal';

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
            'radial-gradient(circle at 10% 20%, rgba(30, 124, 242, 0.22) 0%, transparent 45%), radial-gradient(circle at 90% 80%, rgba(37, 211, 102, 0.1) 0%, transparent 45%)'
        }}
      >
        {/* Top Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                backgroundColor: '#1E7CF2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '24px'
              }}
            >
              J
            </div>
            <span style={{ color: '#ffffff', fontSize: '24px', fontWeight: 700, letterSpacing: '-0.5px' }}>
              Jus<span style={{ color: '#1E7CF2' }}>Consulta</span>
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '9999px',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              padding: '6px 16px'
            }}
          >
            <span style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px', fontWeight: 600 }}>
              {tribunal} · {ramo}
            </span>
          </div>
        </div>

        {/* Center Process Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1000px' }}>
          <span style={{ color: '#1E7CF2', fontSize: '16px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
            Andamento Processual Oficial
          </span>

          <h1
            style={{
              color: '#ffffff',
              fontSize: '48px',
              fontWeight: 800,
              fontFamily: 'monospace',
              letterSpacing: '-1px',
              margin: 0
            }}
          >
            {cnjFormatado}
          </h1>

          <p
            style={{
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '22px',
              lineHeight: 1.4,
              margin: 0
            }}
          >
            Acompanhe atualizações diárias, entenda despachos com Inteligência Artificial e receba avisos de prazos no WhatsApp.
          </p>
        </div>

        {/* Bottom Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: '24px' }}>
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '15px' }}>
              • Tradução para linguagem didática
            </span>
            <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '15px' }}>
              • Alerta de risco e penhora
            </span>
            <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '15px' }}>
              • Conexão oficial DataJud
            </span>
          </div>

          <span style={{ color: '#1E7CF2', fontSize: '16px', fontWeight: 700 }}>
            jusconsulta.com.br
          </span>
        </div>
      </div>
    ),
    {
      ...size
    }
  );
}
