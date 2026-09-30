'use client';

import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

interface Stage {
  id: number;
  title: string;
  description: string;
  targetProgress: number;
}

const STAGES: Stage[] = [
  {
    id: 1,
    title: 'Varredura & Leitura Processual',
    description: 'Mapeando instâncias, tribunais, partes contrárias e valores de causa',
    targetProgress: 28
  },
  {
    id: 2,
    title: 'Auditoria de Riscos & Alertas',
    description: 'Rastreando execuções ativas, penhoras Sisbajud e notificações pendentes',
    targetProgress: 58
  },
  {
    id: 3,
    title: 'Mapeamento de Pontos Favoráveis',
    description: 'Identificando decisões liminares, extinções, cancelamento de débitos e baixas',
    targetProgress: 84
  },
  {
    id: 4,
    title: 'Consolidação & Recomendações',
    description: 'Estruturando relatório executivo com plano estratégico de defesa patrimonial',
    targetProgress: 97
  }
];

export default function AiSummaryLoadingBar() {
  const [progress, setProgress] = useState(8);
  const [activeStage, setActiveStage] = useState(0);

  useEffect(() => {
    // Intervalo de animação fluida de progresso
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 96) return 96; // Aguarda a finalização real da API
        const stepIncrement = prev < 30 ? 2.4 : prev < 60 ? 1.8 : prev < 85 ? 1.2 : 0.6;
        const nextVal = Math.min(prev + stepIncrement, 96);

        // Atualiza a etapa ativa com base no progresso atingido
        if (nextVal >= 84) {
          setActiveStage(3);
        } else if (nextVal >= 55) {
          setActiveStage(2);
        } else if (nextVal >= 25) {
          setActiveStage(1);
        } else {
          setActiveStage(0);
        }

        return nextVal;
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 4,
        padding: '24px 26px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        animation: 'bf-fadein 0.4s ease both'
      }}
    >
      {/* Cabeçalho do Loading */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#999999',
              boxShadow: '0 0 10px rgba(153, 153, 153, 0.8)',
              animation: 'bf-blink 1.2s ease-in-out infinite'
            }}
          />
          <span
            style={{
              fontSize: 11,
              letterSpacing: 1.5,
              fontWeight: 700,
              color: '#bdbdbb',
              textTransform: 'uppercase'
            }}
          >
            Inteligência Artificial • Análise de Processos em Andamento
          </span>
        </div>

        {/* Contador percentual */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'rgba(254,254,250,0.6)', letterSpacing: 0.5 }}>Progresso:</span>
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: '#fefefa',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      {/* Barra de Progresso com Shimmer */}
      <div
        style={{
          width: '100%',
          height: 8,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: 999,
          overflow: 'hidden',
          position: 'relative',
          marginBottom: 24
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #3d3d3d 0%, #5f5f5f 50%, #999999 100%)',
            borderRadius: 999,
            position: 'relative',
            transition: 'width 0.15s ease-out'
          }}
        >
          {/* Efeito de onda iluminada (wave sweep) */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)',
              animation: 'bf-wave-sweep 1.8s linear infinite'
            }}
          />
        </div>
      </div>

      {/* Lista Discriminada de Etapas (Grid 2x2 responsivo) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12
        }}
      >
        {STAGES.map((stage, idx) => {
          const isDone = progress >= stage.targetProgress;
          const isActive = !isDone && idx === activeStage;

          return (
            <div
              key={stage.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 4,
                background: isActive
                  ? 'rgba(153, 153, 153, 0.08)'
                  : isDone
                  ? 'rgba(27, 107, 62, 0.08)'
                  : 'rgba(255,255,255,0.03)',
                border: isActive
                  ? '1px solid rgba(153, 153, 153, 0.35)'
                  : isDone
                  ? '1px solid rgba(27, 107, 62, 0.3)'
                  : '1px solid rgba(255,255,255,0.1)',
                transition: 'all 0.3s ease'
              }}
            >
              {/* Ícone de Status da Etapa */}
              <div style={{ flexShrink: 0, marginTop: 2 }}>
                {isDone ? (
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: '#1b6b3e',
                      color: '#fefefa',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700
                    }}
                  >
                    <Check size={13} strokeWidth={3} />
                  </div>
                ) : isActive ? (
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      border: '2px solid #999999',
                      borderTopColor: 'transparent',
                      animation: 'bf-spin 0.8s linear infinite'
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,0.1)',
                      color: 'rgba(254,254,250,0.6)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 600
                    }}
                  >
                    {stage.id}
                  </div>
                )}
              </div>

              {/* Textos da Etapa */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 2
                  }}
                >
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: isActive || isDone ? 600 : 500,
                      color: isDone ? '#4fae7a' : isActive ? '#fefefa' : 'rgba(254,254,250,0.65)'
                    }}
                  >
                    {stage.title}
                  </span>

                  {isActive && (
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 600,
                        color: '#fefefa',
                        background: 'rgba(153, 153, 153, 0.2)',
                        padding: '2px 6px',
                        borderRadius: 3,
                        animation: 'bf-blink 1.2s ease-in-out infinite'
                      }}
                    >
                      Processando...
                    </span>
                  )}
                  {isDone && (
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 600,
                        color: '#4fae7a',
                        background: 'rgba(27, 107, 62, 0.15)',
                        padding: '2px 6px',
                        borderRadius: 3
                      }}
                    >
                      Concluído
                    </span>
                  )}
                </div>

                <p
                  style={{
                    margin: 0,
                    fontSize: 11,
                    lineHeight: 1.4,
                    color: isActive ? 'rgba(254,254,250,0.8)' : 'rgba(254,254,250,0.5)'
                  }}
                >
                  {stage.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Rodapé Informativo */}
      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: '1px dashed rgba(255,255,255,0.15)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          fontSize: 11,
          color: 'rgba(254,254,250,0.55)'
        }}
      >
        <span>
          Cruzando dados processuais com jurisprudência e estratégias de defesa patrimonial...
        </span>
        <span style={{ fontWeight: 500, color: '#bdbdbb' }}>Sigilo Profissional Garantido</span>
      </div>
    </div>
  );
}
