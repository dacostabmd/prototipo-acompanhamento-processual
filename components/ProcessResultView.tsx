'use client';

import { authFetch } from '@/lib/authFetch';
import React, { useRef, useState, useEffect } from 'react';
import { formatChatMessageHtml, formatDateLabel } from '@/lib/format';
import { TAG_META, type CaseData } from '@/lib/mockProcesses';
import { Check, FileText, ShieldCheck } from 'lucide-react';
import AiSummaryLoadingBar from './AiSummaryLoadingBar';

const BLUE = '#5f5f5f';
const BLUE_LIGHT = '#d4d4d2';
const TEXT = '#ffffff';
const MUTED = 'rgba(229,231,235,0.75)';
const BORDER = 'rgba(255,255,255,0.12)';
const GLASS = 'rgba(20,20,22,0.55)';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

interface ProcessResultViewProps {
  fullName: string;
  cpf: string;
  phone: string;
  caseData: CaseData;
  tribunaisConsultados: string[];
  custoEstimado?: number;
  aiSummary: string;
  aiSummaryLoading: boolean;
  onRefreshAiSummary: () => void;
  onNewSearch: () => void;
  aiModel?: 'claude-haiku-4-5' | 'claude-sonnet-4-5';
  chatTone?: 'Acolhedor' | 'Formal';
}

export default function ProcessResultView({
  fullName,
  cpf,
  phone,
  caseData,
  tribunaisConsultados,
  custoEstimado,
  aiSummary,
  aiSummaryLoading,
  onRefreshAiSummary,
  onNewSearch,
  aiModel = 'claude-haiku-4-5',
  chatTone = 'Acolhedor'
}: ProcessResultViewProps) {
  const [monitorado, setMonitorado] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const principal = caseData.processes[0];
  const ultimasMovimentacoes = caseData.timeline.slice(0, 15);

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    const newMessages: ChatMessage[] = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages(newMessages);
    setChatLoading(true);

    try {
      const res = await authFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          tone: chatTone,
          model: aiModel,
          caseContext: {
            fullName,
            cpf,
            totalProcessos: caseData.totalProcessos,
            processes: caseData.processes.map(p => ({
              numero: p.numero,
              tribunal: p.tribunal,
              tipo: p.tipo,
              valorCausa: p.valorCausa,
              parteContraria: p.parteContraria
            }))
          }
        })
      });
      if (!res.ok) throw new Error('Falha no chat');
      const data = await res.json().catch(() => ({}));
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.text || 'Ocorreu uma instabilidade na resposta.' }]);
    } catch {
      setChatMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Desculpe, tive um problema ao responder. Pode tentar novamente?' }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 1200,
        margin: '0 auto 48px',
        animation: 'bf-fadein 0.6s ease both'
      }}
    >
      {/* ── Cabeçalho ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20
        }}
      >
        <div>
          <div style={{ fontSize: 10.5, letterSpacing: 1.5, color: MUTED, fontWeight: 600 }}>PROCESSO</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>{principal?.numero || '—'}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setMonitorado(v => !v)}
            style={{
              background: monitorado ? 'rgba(95,95,95,0.25)' : 'transparent',
              border: `1px solid ${monitorado ? BLUE : BORDER}`,
              color: TEXT,
              padding: '9px 16px',
              fontSize: 12,
              letterSpacing: 0.5,
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            {monitorado ? (
              <>
                <Check size={14} strokeWidth={2.5} /> ACOMPANHANDO ESTE PROCESSO
              </>
            ) : (
              'ACOMPANHAR ESTE PROCESSO'
            )}
          </button>
          <button
            type="button"
            onClick={onNewSearch}
            style={{
              background: 'transparent',
              border: `1px solid ${BORDER}`,
              color: MUTED,
              padding: '9px 16px',
              fontSize: 12,
              cursor: 'pointer',
              borderRadius: 4
            }}
          >
            NOVA BUSCA
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 66%) minmax(280px, 34%)',
          gap: 20,
          alignItems: 'start'
        }}
        className="bf-split-grid"
      >
        {/* ── Coluna esquerda ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Resumo por IA */}
          <div
            style={{
              background: GLASS,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              padding: '20px 24px',
              height: 420,
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexShrink: 0 }}>
              <span style={{ fontSize: 10, letterSpacing: 1.5, color: BLUE_LIGHT, fontWeight: 700 }}>
                RESUMO EM PALAVRAS SIMPLES
              </span>
              <button
                type="button"
                onClick={onRefreshAiSummary}
                disabled={aiSummaryLoading}
                style={{
                  background: 'transparent',
                  border: `1px solid ${BORDER}`,
                  color: MUTED,
                  padding: '6px 12px',
                  fontSize: 11,
                  cursor: aiSummaryLoading ? 'not-allowed' : 'pointer',
                  borderRadius: 4
                }}
              >
                {aiSummaryLoading ? 'GERANDO...' : 'RECRIAR'}
              </button>
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: aiSummaryLoading ? 'center' : 'flex-start'
              }}
            >
              {aiSummaryLoading ? (
                <AiSummaryLoadingBar />
              ) : aiSummary ? (
                <div style={{ fontSize: 14, lineHeight: 1.8, color: TEXT }} dangerouslySetInnerHTML={{ __html: formatSummaryHtml(aiSummary) }} />
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: MUTED }}>
                  Resumo gerado pela IA: do que trata o processo, em que fase está e qual é o próximo passo provável.
                </p>
              )}
            </div>
          </div>

          {/* Cards de dados-chave: 3 fixos (Infosimples) + extras do DataJud (CNJ) quando disponíveis */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
            <DataCard label="Valor da causa" value={principal?.valorCausa || 'Não informado'} />
            <DataCard label="Parte contrária" value={principal?.parteContraria || 'Não informada'} />
            <DataCard label="Tribunal / Vara" value={principal?.tribunal || tribunaisConsultados.join(', ') || '—'} />
            {principal?.orgaoJulgadorDataJud && <DataCard label="Órgão julgador (CNJ)" value={principal.orgaoJulgadorDataJud} />}
            {principal?.grauDataJud && <DataCard label="Grau" value={principal.grauDataJud} />}
            {principal?.assuntosDataJud && principal.assuntosDataJud.length > 0 && (
              <DataCard label="Assunto (CNJ)" value={principal.assuntosDataJud.join(', ')} />
            )}
            {principal?.distribuicao && <DataCard label="Distribuição" value={principal.distribuicao} />}
          </div>

          {/* Últimas movimentações */}
          <div
            style={{
              background: GLASS,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              padding: '20px 24px',
              height: 420,
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexShrink: 0 }}>
              <span style={{ fontSize: 10, letterSpacing: 1.5, color: BLUE_LIGHT, fontWeight: 700 }}>
                ÚLTIMAS MOVIMENTAÇÕES
              </span>
              {caseData.processes.some(p => p.enriquecidoDataJud) && (
                <span
                  title="Dados complementados com informações oficiais do DataJud (CNJ): movimentações, assuntos, órgão julgador, grau e/ou data de ajuizamento"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    color: '#8fb99a',
                    border: '1px solid #8fb99a',
                    borderRadius: 10,
                    padding: '1px 7px'
                  }}
                >
                  <ShieldCheck size={10} strokeWidth={2.5} />
                  DATAJUD (CNJ)
                </span>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {ultimasMovimentacoes.length === 0 && (
                <p style={{ margin: 0, fontSize: 13, color: MUTED }}>Nenhuma movimentação encontrada.</p>
              )}
              {ultimasMovimentacoes.map(item => {
                const tagMeta = TAG_META[item.tag] || TAG_META.informativo;
                return (
                  <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: tagMeta.color, marginTop: 6, flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, color: TEXT, fontWeight: 600 }}>{item.titulo}</span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: 0.5,
                            color: tagMeta.color,
                            border: `1px solid ${tagMeta.color}`,
                            borderRadius: 10,
                            padding: '1px 7px',
                            flexShrink: 0
                          }}
                        >
                          {tagMeta.label}
                        </span>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>{item.descricao}</p>
                      <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 11, color: 'rgba(254,254,250,0.45)' }}>
                        <span>{formatDateLabel(item.date)}</span>
                        <span>{item.processo.numero}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Coluna direita: chat + petições ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              background: GLASS,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              display: 'flex',
              flexDirection: 'column',
              height: 420
            }}
          >
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${BORDER}`, fontSize: 12, letterSpacing: 1, color: BLUE_LIGHT, fontWeight: 700 }}>
              TIRE DÚVIDAS COM A IA
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {chatMessages.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <SuggestedQuestion text="O que acontece agora?" onClick={setChatInput} />
                  <SuggestedQuestion text="O que significa cada movimentação?" onClick={setChatInput} />
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: '86%',
                      padding: '10px 14px',
                      fontSize: 12.5,
                      lineHeight: 1.6,
                      borderRadius: 4,
                      background: msg.role === 'user' ? BLUE : 'rgba(255,255,255,0.06)',
                      color: TEXT,
                      border: msg.role === 'user' ? 'none' : `1px solid ${BORDER}`
                    }}
                  >
                    {msg.role === 'user' ? (
                      <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: formatChatMessageHtml(msg.content, false) }} />
                    )}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ fontSize: 12, color: MUTED, animation: 'bf-blink 1.4s ease-in-out infinite' }}>Analisando contexto...</div>
              )}
              <div ref={chatBottomRef} />
            </div>
            <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: `1px solid ${BORDER}` }}>
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void sendChatMessage()}
                placeholder="Escreva sua dúvida"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '9px 12px',
                  fontSize: 12.5,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 4,
                  background: 'rgba(255,255,255,0.06)',
                  color: TEXT,
                  outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={() => void sendChatMessage()}
                style={{
                  background: BLUE,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '9px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                →
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDocsOpen(true)}
            style={{
              background: GLASS,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: TEXT,
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <FileText size={15} /> Petições e decisões
            </span>
            <span style={{ fontSize: 10, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '2px 8px' }}>
              Em breve
            </span>
          </button>
        </div>
      </div>

      {docsOpen && (
        <div
          onClick={() => setDocsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#232323',
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: 28,
              maxWidth: 420,
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginBottom: 8 }}>Petições e decisões</div>
            <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, margin: '0 0 18px' }}>
              O acesso à íntegra de petições e decisões está em desenvolvimento e chegará em breve para os processos acompanhados.
            </p>
            <button
              type="button"
              onClick={() => setDocsOpen(false)}
              style={{ background: BLUE, color: '#fff', border: 'none', borderRadius: 4, padding: '10px 20px', fontSize: 12.5, cursor: 'pointer' }}
            >
              ENTENDI
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DataCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: GLASS,
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        padding: '14px 16px'
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: 1, color: MUTED, marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 13.5, color: TEXT, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
    </div>
  );
}

function SuggestedQuestion({ text, onClick }: { text: string; onClick: (v: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(text)}
      style={{
        textAlign: 'left',
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${BORDER}`,
        borderRadius: 4,
        padding: '8px 12px',
        fontSize: 12,
        color: MUTED,
        cursor: 'pointer'
      }}
    >
      {text}
    </button>
  );
}

function formatSummaryHtml(raw: string): string {
  if (!raw) return '';
  let text = raw.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return text
    .split(/\n\s*\n/)
    .map(block => `<p style="margin:0 0 10px;">${block.trim().replace(/\n/g, '<br />')}</p>`)
    .join('');
}
