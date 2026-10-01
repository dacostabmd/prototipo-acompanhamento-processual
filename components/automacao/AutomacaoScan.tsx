'use client';

import { Check, X } from 'lucide-react';

export type ScanItemStatus = 'loading' | 'found' | 'not-found';
export interface ScanItem {
  dealId: number;
  label: string;
  status: ScanItemStatus;
  numeroCnj?: string;
}

interface Props {
  items: ScanItem[];
}

// Mesma paleta/mecânica visual da tela "Varrendo bases judiciais" (components/ProcessTracker.tsx),
// reaproveitada aqui para a varredura de leads do Bitrix.
const TEXT = '#f5f6fa';
const MUTED = 'rgba(226,229,245,0.65)';
const BORDER = 'rgba(255,255,255,0.12)';
const BLUE = '#5f5f5f';
const MOSS_GREEN = '#3d6b4f';
const RUBY_RED = '#9b2c3f';

export default function AutomacaoScan({ items }: Props) {
  const doneCount = items.filter(i => i.status !== 'loading').length;
  const totalCount = items.length || 1;
  const pct = Math.round((doneCount / totalCount) * 100);

  return (
    <div
      style={{
        background: 'rgba(20,20,20,0.88)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        padding: '48px 32px',
        borderRadius: 10,
        textAlign: 'center',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        border: `1px solid ${BORDER}`
      }}
    >
      <h3 style={{ margin: '0 0 8px', fontSize: 18, color: TEXT, fontWeight: 600 }}>Qualificando leads...</h3>
      <p style={{ margin: '0 0 20px', fontSize: 13.5, color: MUTED }}>
        Buscando o número de processo de cada lead e enriquecendo com InfoSimples e DataJud. Leads sem dado encontrado são
        descartados automaticamente.
      </p>

      <div style={{ maxWidth: 560, margin: '0 auto 24px' }}>
        <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: BLUE,
              borderRadius: 3,
              transition: 'width 0.4s ease'
            }}
          />
        </div>
        <div style={{ marginTop: 6, fontSize: 11.5, color: MUTED, textAlign: 'right' }}>
          {doneCount}/{items.length} leads verificados
        </div>
      </div>

      {items.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 10,
            textAlign: 'left',
            maxWidth: 560,
            margin: '0 auto'
          }}
        >
          {items.map(item => (
            <div
              key={item.dealId}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '10px 12px',
                background: 'rgba(10,10,10,0.6)',
                border: `1px solid ${BORDER}`,
                borderRadius: 4,
                fontSize: 12.5,
                minWidth: 0,
                animation: 'bf-fadein 0.35s ease both'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span aria-hidden="true" style={{ display: 'inline-flex', width: 16, height: 16, flex: 'none', alignItems: 'center', justifyContent: 'center' }}>
                  {item.status === 'loading' && (
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        border: `2px solid ${BLUE}`,
                        borderTopColor: 'transparent',
                        animation: 'bf-spin 0.8s linear infinite'
                      }}
                    />
                  )}
                  {item.status === 'found' && <Check size={16} strokeWidth={2.5} style={{ color: MOSS_GREEN }} />}
                  {item.status === 'not-found' && <X size={16} strokeWidth={2.5} style={{ color: RUBY_RED }} />}
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    color: TEXT,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {item.label}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 11,
                    fontWeight: 600,
                    flexShrink: 0,
                    textAlign: 'right',
                    color: item.status === 'found' ? MOSS_GREEN : item.status === 'not-found' ? RUBY_RED : MUTED
                  }}
                >
                  {item.status === 'loading' && 'Consultando...'}
                  {item.status === 'found' && (item.numeroCnj ?? 'Qualificado')}
                  {item.status === 'not-found' && 'Sem dados'}
                </span>
              </div>

              <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                {item.status === 'loading' && (
                  <div
                    style={{
                      height: '100%',
                      width: '60%',
                      background: BLUE,
                      borderRadius: 2,
                      animation: 'bf-blink 1.2s ease-in-out infinite'
                    }}
                  />
                )}
                {item.status !== 'loading' && (
                  <div
                    style={{
                      height: '100%',
                      width: '100%',
                      borderRadius: 2,
                      background: item.status === 'found' ? MOSS_GREEN : RUBY_RED
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
