'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { CaseData, LegalProcess, MovementTag } from '@/lib/mockProcesses';

import { validateSafeDocument, type FileValidationResult } from '@/lib/security';

const BLUE = '#2455b8';
const BLUE_DARK = '#17347a';
const BLUE_LIGHT = '#a9c3ef';
const GOLD = '#c5a059';
const GOLD_LIGHT = '#f4ebd8';
const CREAM = '#f5f2ea';
const CREAM_TEXT = '#f5efe1';
const PAPER = '#ffffff';
const BORDER = '#e3ddd0';
const TEXT = '#1b2733';
const MUTED = '#37424c';
const DANGER = '#8a3a3a';
const DANGER_BG = '#fbf0f0';
const SUCCESS = '#1b6b3e';
const SUCCESS_BG = '#edf7f0';
const WHATSAPP = '#25603f';

const TAG_META: Record<MovementTag, { label: string; color: string }> = {
  urgente: { label: 'URGENTE', color: '#8a2b2b' },
  positivo: { label: 'POSITIVO', color: '#1b6b3e' },
  andamento: { label: 'EM ANDAMENTO', color: '#2455b8' },
  informativo: { label: 'INFORMATIVO', color: '#4b5a68' }
};

interface ProcessDashboardSplitProps {
  fullName: string;
  cpf: string;
  phone: string;
  state: string;
  processNumber?: string;
  caseData: CaseData;
  tribunaisConsultados: string[];
  aiSummary: string;
  aiSummaryLoading: boolean;
  onRefreshAiSummary: () => void;
  onNewSearch: () => void;
  bitrixLeadId?: string | number | null;
  bitrixSimulated?: boolean;
}

type ChatMessage = { role: 'user' | 'assistant'; content: string; attachments?: { name: string; size: number }[] };

export default function ProcessDashboardSplit({
  fullName,
  cpf,
  phone,
  state,
  processNumber,
  caseData,
  tribunaisConsultados,
  aiSummary,
  aiSummaryLoading,
  onRefreshAiSummary,
  onNewSearch,
  bitrixLeadId,
  bitrixSimulated
}: ProcessDashboardSplitProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [whatsappSending, setWhatsappSending] = useState(false);
  const [whatsappSent, setWhatsappSent] = useState(false);

  // Freemium State: false = Freemium limitado; true = Pro desbloqueado (para devs)
  const [isProUnlocked, setIsProUnlocked] = useState(true);
  const [freemiumQuestionsUsed, setFreemiumQuestionsUsed] = useState(0);

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `Olá, ${fullName.split(' ')[0] || 'Cliente'}! Sou o Assistente Jurídico com IA da Blindagem Financeira. Analisei seus ${caseData.totalProcessos} processo(s) encontrados. Como posso ajudar com dúvidas sobre prazos, riscos patrimoniais ou defesas possíveis? Você também pode me enviar documentos, PDFs ou fotos de petições aqui.`
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Anexos de arquivos protegidos
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; size: number; type: string }[]>([]);
  const [fileScanning, setFileScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (chatMessages.length > 1) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, chatLoading]);

  // Upload e Validação de Arquivos Seguros
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadError(null);
    setFileScanning(true);
    setScanStatus('Inspecionando assinaturas de arquivo e executáveis...');

    const validated: { name: string; size: number; type: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setScanStatus(`Analisando "${file.name}" contra ameaças e malware...`);
      const result: FileValidationResult = await validateSafeDocument(file);

      if (!result.safe) {
        setUploadError(result.error || `Arquivo "${file.name}" bloqueado.`);
        setFileScanning(false);
        setScanStatus(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      validated.push({
        name: result.name,
        size: result.size,
        type: result.type
      });
    }

    setAttachedFiles(prev => [...prev, ...validated]);
    setFileScanning(false);
    setScanStatus(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Insights calculados
  const totalUrgentes = caseData.processes.filter(p =>
    p.movimentos.some(m => m.tag === 'urgente') || /execu[cç][aã]o|penhora|fiscal/i.test(p.tipo)
  ).length;

  const totalPositivos = caseData.processes.filter(p =>
    p.movimentos.some(m => m.tag === 'positivo')
  ).length;

  const riskScore = totalUrgentes > 2 ? 'Crítico' : totalUrgentes > 0 ? 'Moderado' : 'Controlado';
  const riskColor = riskScore === 'Crítico' ? '#8a2b2b' : riskScore === 'Moderado' ? '#b45309' : '#1b6b3e';

  // Envio por WhatsApp
  const handleSendWhatsapp = () => {
    if (whatsappSending) return;
    setWhatsappSending(true);

    const rawDigits = phone.replace(/\D/g, '');
    const targetPhone = rawDigits.startsWith('55') ? rawDigits : `55${rawDigits}`;

    let resumoLimpo = aiSummary
      ? aiSummary
          .replace(/<span[^>]*color:\s*#8a2b2b[^>]*>(.*?)<\/span>/gi, '🔴 *$1*')
          .replace(/<span[^>]*color:\s*#1b6b3e[^>]*>(.*?)<\/span>/gi, '🟢 *$1*')
          .replace(/<span[^>]*>(.*?)<\/span>/gi, '*$1*')
          .replace(/<strong>(.*?)<\/strong>/gi, '*$1*')
          .replace(/<b>(.*?)<\/b>/gi, '*$1*')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<p[^>]*>/gi, '')
          .replace(/<[^>]+>/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      : `Encontrados ${caseData.totalProcessos} processos vinculados ao seu CPF.`;

    const mensagem =
      `*BLINDAGEM FINANCEIRA — Resumo Processual*\n\n` +
      `*Cliente:* ${fullName}\n` +
      `*CPF:* ${cpf}\n` +
      `*Estado:* ${state || 'Nacional'}\n` +
      `*Processos Localizados:* ${caseData.totalProcessos}\n` +
      `*Nível de Atenção:* ${riskScore}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `*RESUMO EXECUTIVO (IA):*\n\n` +
      `${resumoLimpo}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `_Para suporte especializado em proteção patrimonial e negociações de passivo, fale conosco._\n` +
      `*Equipe Blindagem Financeira*`;

    window.open(`https://api.whatsapp.com/send?phone=${targetPhone}&text=${encodeURIComponent(mensagem)}`, '_blank');
    setWhatsappSending(false);
    setWhatsappSent(true);
  };

  // Download do PDF
  const handleDownloadPdf = () => {
    window.print();
  };

  // Envio de mensagem no Chat com CONTEXTO TOTAL e ANEXOS
  const handleSendMessage = async () => {
    if ((!chatInput.trim() && attachedFiles.length === 0) || chatLoading) return;

    if (!isProUnlocked && freemiumQuestionsUsed >= 1) {
      return;
    }

    const userText = chatInput.trim();
    const currentAttachments = [...attachedFiles];
    setChatInput('');
    setAttachedFiles([]);

    const newMessages: ChatMessage[] = [
      ...chatMessages,
      {
        role: 'user',
        content: userText || (currentAttachments.length > 0 ? 'Documento enviado para análise:' : ''),
        attachments: currentAttachments.map(a => ({ name: a.name, size: a.size }))
      }
    ];
    setChatMessages(newMessages);
    setChatLoading(true);
    setFreemiumQuestionsUsed(prev => prev + 1);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({
            role: m.role,
            content: m.attachments && m.attachments.length > 0
              ? `${m.content}\n[Anexos seguros verificados: ${m.attachments.map(a => a.name).join(', ')}]`
              : m.content
          })),
          attachments: currentAttachments,
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
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.text }]);
    } catch {
      setChatMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content:
            'No momento tive uma oscilação na resposta. Por favor, tente novamente ou fale diretamente com nossos advogados especialistas.'
        }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div style={{ width: '100%', maxWidth: 1400, margin: '0 auto', animation: 'bf-fadein 0.6s ease both' }}>
      {/* ── BARRA SUPERIOR DO CLIENTE ── */}
      <section
        style={{
          background: BLUE,
          color: CREAM_TEXT,
          padding: '20px 32px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 24,
          borderRadius: 2
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: BLUE_LIGHT, fontWeight: 600 }}>CLIENTE</div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: 0.5 }}>{fullName}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: BLUE_LIGHT, fontWeight: 600 }}>CPF</div>
            <div style={{ fontSize: 14, letterSpacing: 1 }}>{cpf}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: BLUE_LIGHT, fontWeight: 600 }}>ESTADO / TRIBUNAL</div>
            <div style={{ fontSize: 14 }}>{state || 'Nacional'}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: BLUE_LIGHT, fontWeight: 600 }}>PROCESSOS ENCONTRADOS</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
              {caseData.totalProcessos}
              {tribunaisConsultados.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 400, color: BLUE_LIGHT, marginLeft: 6 }}>
                  ({tribunaisConsultados.join(' + ')})
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onNewSearch}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.4)',
              color: CREAM_TEXT,
              padding: '8px 16px',
              fontSize: 11,
              letterSpacing: 1,
              cursor: 'pointer'
            }}
          >
            NOVA BUSCA
          </button>
        </div>
      </section>

      {/* ── GRID PRINCIPAL SPLIT 70% / 30% (PAPERS CONECTADOS) ── */}
      <div
        className="bf-split-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 3fr)',
          gap: 0,
          alignItems: 'stretch',
          background: PAPER,
          border: `1px solid ${BORDER}`,
          borderRadius: 3,
          boxShadow: '0 16px 50px rgba(0,0,0,0.3)',
          overflow: 'hidden'
        }}
      >
        {/* ══════════════════════════════════════════════════════
            COLUNA ESQUERDA (70%) — RESUMO, TIMELINE & INSIGHTS
            ══════════════════════════════════════════════════════ */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            borderRight: `1px solid ${BORDER}`,
            background: '#ffffff'
          }}
        >
          {/* Card de Ações Rápidas & Insights da IA */}
          <div
            style={{
              padding: '26px 32px',
              borderBottom: `1px solid ${BORDER}`
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 16,
                paddingBottom: 20,
                borderBottom: `1px solid #f0eae1`
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 18, color: '#000', fontWeight: 600, letterSpacing: 0.5 }}>
                  Dossiê Jurídico & Análise de IA
                </h2>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                  Relatório consolidado com timeline de movimentações e síntese executiva
                </div>
              </div>

              {/* Botões de Ação */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={handleDownloadPdf}
                  style={{
                    background: '#1b2733',
                    color: '#ffffff',
                    border: 'none',
                    padding: '10px 18px',
                    fontSize: 11.5,
                    letterSpacing: 1,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontWeight: 500
                  }}
                  title="Baixar resumo completo em PDF"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  BAIXAR PDF
                </button>

                <button
                  onClick={handleSendWhatsapp}
                  style={{
                    background: WHATSAPP,
                    color: CREAM_TEXT,
                    border: 'none',
                    padding: '10px 18px',
                    fontSize: 11.5,
                    letterSpacing: 1,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.85.5 3.58 1.4 5.09L2 22l5.2-1.36a9.9 9.9 0 0 0 4.84 1.24h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.02c-.24.68-1.4 1.32-1.94 1.4-.5.08-1.12.11-1.8-.11-.42-.14-.96-.32-1.66-.63-2.92-1.26-4.82-4.2-4.96-4.4-.14-.19-1.18-1.57-1.18-3 0-1.42.75-2.12 1.02-2.41.27-.29.58-.36.78-.36h.55c.18 0 .42-.02.65.5.24.55.82 1.98.9 2.12.08.14.13.3.03.48-.1.19-.16.31-.31.48-.16.17-.32.38-.46.51-.16.15-.32.31-.14.62.19.32.85 1.4 1.83 2.27 1.26 1.13 2.32 1.48 2.66 1.65.34.16.55.14.75-.08.24-.27.55-.72.87-1.16.22-.31.5-.35.83-.22.34.13 2.12 1 2.48 1.18.36.18.6.27.68.42.09.16.09.9-.15 1.58z" />
                  </svg>
                  {whatsappSent ? 'ENVIADO!' : 'ENVIAR WHATSAPP'}
                </button>

                <button
                  onClick={onRefreshAiSummary}
                  disabled={aiSummaryLoading}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${BLUE}`,
                    color: '#000',
                    padding: '10px 16px',
                    fontSize: 11,
                    letterSpacing: 1,
                    cursor: aiSummaryLoading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {aiSummaryLoading ? 'ANALISANDO...' : 'RECRIAR RESUMO'}
                </button>
              </div>
            </div>

            {/* Métricas de Insights */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 16,
                marginTop: 20
              }}
            >
              <div
                style={{
                  background: '#faf8f5',
                  borderTop: `1px solid ${BORDER}`,
                  borderRight: `1px solid ${BORDER}`,
                  borderBottom: `1px solid ${BORDER}`,
                  borderLeft: `4px solid ${riskColor}`,
                  padding: '14px 18px'
                }}
              >
                <div style={{ fontSize: 10.5, color: MUTED, letterSpacing: 1 }}>ÍNDICE DE RISCO</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: riskColor, marginTop: 4 }}>
                  {riskScore}
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                  {totalUrgentes > 0 ? `${totalUrgentes} alerta(s) de execução/cobrança` : 'Nenhuma penhora imediata'}
                </div>
              </div>

              <div
                style={{
                  background: '#faf8f5',
                  borderTop: `1px solid ${BORDER}`,
                  borderRight: `1px solid ${BORDER}`,
                  borderBottom: `1px solid ${BORDER}`,
                  borderLeft: `4px solid ${SUCCESS}`,
                  padding: '14px 18px'
                }}
              >
                <div style={{ fontSize: 10.5, color: MUTED, letterSpacing: 1 }}>PONTOS FAVORÁVEIS</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: SUCCESS, marginTop: 4 }}>
                  {totalPositivos}
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                  Decisões favoráveis ou baixas
                </div>
              </div>

              <div
                style={{
                  background: '#faf8f5',
                  borderTop: `1px solid ${BORDER}`,
                  borderRight: `1px solid ${BORDER}`,
                  borderBottom: `1px solid ${BORDER}`,
                  borderLeft: `4px solid ${BLUE}`,
                  padding: '14px 18px'
                }}
              >
                <div style={{ fontSize: 10.5, color: MUTED, letterSpacing: 1 }}>TOTAL DE AÇÕES</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: BLUE, marginTop: 4 }}>
                  {caseData.totalProcessos}
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                  Varredura em {tribunaisConsultados.join(', ') || 'TJSP/TJRJ'}
                </div>
              </div>
            </div>

            {/* Resumo da Inteligência Artificial */}
            <div style={{ marginTop: 24 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 14
                }}
              >
                <span
                  style={{
                    fontSize: 9.5,
                    letterSpacing: 1.5,
                    color: BLUE,
                    border: `1px solid ${BLUE}`,
                    padding: '3px 8px'
                  }}
                >
                  RESUMO EXECUTIVO POR IA
                </span>

                {/* Legenda de Cores */}
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: MUTED }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8a2b2b' }} />
                    <strong style={{ color: '#8a2b2b' }}>Vermelho escuro:</strong> Alertas & Execuções
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1b6b3e' }} />
                    <strong style={{ color: '#1b6b3e' }}>Verde escuro:</strong> Favoráveis & Arquivados
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <strong style={{ color: '#000' }}>Negrito:</strong> Processos e Valores
                  </span>
                </div>
              </div>

              {aiSummaryLoading ? (
                <div style={{ padding: '24px', textAlign: 'center', color: MUTED, fontSize: 14 }}>
                  <div style={{ animation: 'bf-blink 1.4s ease-in-out infinite' }}>
                    Analisando processos com Inteligência Artificial e gerando síntese jurídica...
                  </div>
                </div>
              ) : aiSummary ? (
                <div
                  style={{
                    fontSize: 14,
                    lineHeight: 1.85,
                    color: TEXT,
                    textAlign: 'left',
                    background: '#faf8f5',
                    border: `1px solid ${BORDER}`,
                    padding: '22px 26px'
                  }}
                  dangerouslySetInnerHTML={{ __html: formatAiSummaryHtml(aiSummary) }}
                />
              ) : (
                <div style={{ padding: '16px', background: '#faf8f5', color: MUTED, fontSize: 13 }}>
                  Clique em &quot;Recriar Resumo&quot; para gerar a síntese com Inteligência Artificial.
                </div>
              )}
            </div>
          </div>

          {/* Linha do Tempo dos Processos */}
          <div
            style={{
              padding: '28px 32px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16.5, color: '#000', fontWeight: 600 }}>
                Linha do Tempo Processual ({caseData.timeline.length} movimentações)
              </h3>
              <span style={{ fontSize: 11, color: MUTED }}>Clique no card para expandir detalhes da ação</span>
            </div>

            <div style={{ position: 'relative', paddingLeft: 32 }}>
              {/* Linha vertical */}
              <div
                style={{
                  position: 'absolute',
                  left: 11,
                  top: 8,
                  bottom: 8,
                  width: 2,
                  background: '#dcd5c9'
                }}
              />

              {caseData.timeline.map(item => {
                const tagMeta = TAG_META[item.tag] || TAG_META.informativo;
                const isExpanded = expandedId === item.id;
                const process = item.processo;

                return (
                  <div key={item.id} style={{ position: 'relative', marginBottom: 24 }}>
                    {/* Ponto na timeline */}
                    <div
                      style={{
                        position: 'absolute',
                        left: -32 + 5,
                        top: 14,
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: tagMeta.color,
                        border: '3px solid #ffffff',
                        boxShadow: '0 0 0 2px rgba(0,0,0,0.1)'
                      }}
                    />

                    {/* Card do movimento */}
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      style={{
                        background: isExpanded ? '#fbf9f4' : '#ffffff',
                        borderTop: `1px solid ${isExpanded ? BLUE : BORDER}`,
                        borderRight: `1px solid ${isExpanded ? BLUE : BORDER}`,
                        borderBottom: `1px solid ${isExpanded ? BLUE : BORDER}`,
                        borderLeft: `4px solid ${tagMeta.color}`,
                        padding: '16px 20px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: isExpanded ? '0 6px 20px rgba(36,85,184,0.1)' : 'none'
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                          marginBottom: 8
                        }}
                      >
                        <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>
                          {formatDateLabel(item.date)}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            letterSpacing: 1,
                            color: tagMeta.color,
                            fontWeight: 700
                          }}
                        >
                          {tagMeta.label}
                        </span>
                      </div>

                      <div style={{ fontSize: 14.5, fontWeight: 600, color: '#000', marginBottom: 6 }}>
                        {item.titulo}
                      </div>

                      <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
                        {item.descricao}
                      </p>

                      {/* Detalhes expandidos */}
                      {isExpanded && process && (
                        <div
                          style={{
                            marginTop: 14,
                            paddingTop: 14,
                            borderTop: '1px dashed #dcd5c9',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: 12,
                            fontSize: 12
                          }}
                        >
                          <div>
                            <strong style={{ color: '#000' }}>Processo:</strong> {process.numero}
                          </div>
                          <div>
                            <strong style={{ color: '#000' }}>Tribunal/Vara:</strong> {process.tribunal}
                          </div>
                          <div>
                            <strong style={{ color: '#000' }}>Classe/Tipo:</strong> {process.tipo}
                          </div>
                          <div>
                            <strong style={{ color: '#000' }}>Parte Contrária:</strong> {process.parteContraria}
                          </div>
                          <div>
                            <strong style={{ color: '#000' }}>Valor da Causa:</strong> {process.valorCausa}
                          </div>
                          <div>
                            <strong style={{ color: '#000' }}>Distribuição:</strong> {process.distribuicao}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════
            COLUNA DIREITA (30%) — CHAT COM A IA & FREEMIUM
            ══════════════════════════════════════════════════════ */}
        <div
          style={{
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 700,
            position: 'sticky',
            top: 0
          }}
        >
          {/* Cabeçalho do Chat */}
          <div
            style={{
              background: BLUE_DARK,
              color: CREAM_TEXT,
              padding: '18px 22px',
              borderBottom: `2px solid ${GOLD}`
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, letterSpacing: 1, fontWeight: 600 }}>ASSISTENTE JURÍDICO IA</div>
                <div style={{ fontSize: 10.5, color: BLUE_LIGHT, marginTop: 2 }}>Tira-dúvidas & Estratégia</div>
              </div>
              <span
                style={{
                  background: GOLD,
                  color: '#000',
                  fontSize: 9.5,
                  fontWeight: 700,
                  padding: '3px 7px',
                  borderRadius: 2,
                  letterSpacing: 0.5
                }}
              >
                PRO
              </span>
            </div>

            {/* Chave/Switch Freemium para Desenvolvedores / Testes */}
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: '1px solid rgba(255,255,255,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 10.5,
                color: '#d1d5db'
              }}
            >
              <span>Modo Pro (Dev):</span>
              <button
                type="button"
                onClick={() => setIsProUnlocked(!isProUnlocked)}
                style={{
                  background: isProUnlocked ? '#10b981' : '#4b5563',
                  color: '#ffffff',
                  border: 'none',
                  padding: '3px 9px',
                  borderRadius: 12,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {isProUnlocked ? 'DESBLOQUEADO' : 'TRAVADO (FREEMIUM)'}
              </button>
            </div>
          </div>

          {/* Histórico de Mensagens */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              background: '#faf8f5'
            }}
          >
            {chatMessages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
                }}
              >
                <div
                  style={{
                    maxWidth: '86%',
                    padding: '12px 16px',
                    fontSize: 13,
                    lineHeight: 1.6,
                    borderRadius: 4,
                    background: msg.role === 'user' ? BLUE : '#ffffff',
                    color: msg.role === 'user' ? '#ffffff' : TEXT,
                    border: msg.role === 'user' ? 'none' : `1px solid ${BORDER}`,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
                  }}
                >
                  <div>{msg.content}</div>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {msg.attachments.map((att, attIdx) => (
                        <div
                          key={attIdx}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 8px',
                            borderRadius: 3,
                            background: msg.role === 'user' ? 'rgba(255,255,255,0.18)' : '#f3f4f6',
                            fontSize: 11,
                            fontWeight: 500
                          }}
                        >
                          <span>📄</span>
                          <span style={{ textDecoration: 'underline' }}>{att.name}</span>
                          <span style={{ fontSize: 9.5, opacity: 0.8 }}>({(att.size / 1024).toFixed(0)} KB · Seguro)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    padding: '10px 14px',
                    fontSize: 12,
                    color: MUTED,
                    background: '#ffffff',
                    border: `1px solid ${BORDER}`,
                    animation: 'bf-blink 1.4s ease-in-out infinite'
                  }}
                >
                  Analisando teses jurídicas e documentos...
                </div>
              </div>
            )}

            {/* Banner Freemium (quando atinge o limite no modo restrito) */}
            {!isProUnlocked && freemiumQuestionsUsed >= 1 && (
              <div
                style={{
                  background: GOLD_LIGHT,
                  border: `1px solid ${GOLD}`,
                  padding: '16px',
                  borderRadius: 4,
                  textAlign: 'center',
                  marginTop: 10
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: '#684a0c', marginBottom: 6 }}>
                  CONSULTORIA ESTRATÉGICA COMPLETA
                </div>
                <p style={{ fontSize: 11.5, color: '#684a0c', margin: '0 0 12px', lineHeight: 1.5 }}>
                  Você experimentou a prévia do assistente. Para elaborar petições, defesas de penhora ou falar com
                  um especialista humano, agende uma sessão exclusiva.
                </p>
                <button
                  onClick={handleSendWhatsapp}
                  style={{
                    background: BLUE,
                    color: '#ffffff',
                    border: 'none',
                    padding: '8px 14px',
                    fontSize: 11,
                    letterSpacing: 1,
                    fontWeight: 600,
                    cursor: 'pointer',
                    width: '100%'
                  }}
                >
                  FALAR COM ADVOGADO ESPECIALISTA
                </button>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Área de Notificação de Verificação Antivírus e Anexos Selecionados */}
          {scanStatus && (
            <div
              style={{
                padding: '6px 16px',
                background: '#eff6ff',
                color: '#1d4ed8',
                fontSize: 11,
                borderTop: '1px solid #bfdbfe',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span style={{ animation: 'bf-blink 1s infinite' }}>🛡️</span>
              <span>{scanStatus}</span>
            </div>
          )}

          {uploadError && (
            <div
              style={{
                padding: '8px 16px',
                background: '#fef2f2',
                color: '#b91c1c',
                fontSize: 11.5,
                borderTop: '1px solid #fecaca',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8
              }}
            >
              <span>⚠️ {uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 14 }}
              >
                ×
              </button>
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div
              style={{
                padding: '8px 16px',
                background: '#f9fafb',
                borderTop: `1px solid ${BORDER}`,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6
              }}
            >
              {attachedFiles.map((f, idx) => (
                <div
                  key={idx}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    padding: '4px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#374151'
                  }}
                >
                  <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>
                  <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.name}
                  </span>
                  <span style={{ color: '#9ca3af', fontSize: 9.5 }}>({(f.size / 1024).toFixed(0)} KB)</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: '0 2px' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Campo de Entrada do Chat com Botão de Anexo */}
          <div
            style={{
              padding: '12px 18px',
              background: '#ffffff',
              borderTop: `1px solid ${BORDER}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            {/* Input file invisível */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
              multiple
              style={{ display: 'none' }}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={fileScanning || (!isProUnlocked && freemiumQuestionsUsed >= 1)}
              title="Anexar documento, PDF ou imagem (com verificação antivírus)"
              style={{
                background: '#f3f4f6',
                border: `1px solid ${BORDER}`,
                color: '#4b5563',
                padding: '10px 12px',
                fontSize: 14,
                cursor: !isProUnlocked && freemiumQuestionsUsed >= 1 ? 'not-allowed' : 'pointer',
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s'
              }}
            >
              📎
            </button>

            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleSendMessage()}
              disabled={!isProUnlocked && freemiumQuestionsUsed >= 1}
              placeholder={
                !isProUnlocked && freemiumQuestionsUsed >= 1
                  ? 'Limite gratuito atingido'
                  : 'Faça uma pergunta sobre seus processos ou envie um documento...'
              }
              style={{
                flex: 1,
                padding: '10px 12px',
                fontSize: 13,
                border: `1px solid ${BORDER}`,
                outline: 'none',
                background: !isProUnlocked && freemiumQuestionsUsed >= 1 ? '#f3f4f6' : '#ffffff'
              }}
            />
            <button
              onClick={() => void handleSendMessage()}
              disabled={chatLoading || fileScanning || (!isProUnlocked && freemiumQuestionsUsed >= 1)}
              style={{
                background: !isProUnlocked && freemiumQuestionsUsed >= 1 ? '#9ca3af' : BLUE,
                color: '#ffffff',
                border: 'none',
                padding: '10px 16px',
                fontSize: 11.5,
                letterSpacing: 1,
                fontWeight: 600,
                cursor: !isProUnlocked && freemiumQuestionsUsed >= 1 ? 'not-allowed' : 'pointer'
              }}
            >
              ENVIAR
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDateLabel(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

function formatAiSummaryHtml(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // Limpeza de placeholders genéricos
  text = text
    .replace(/\[\s*seu nome\s*\]/gi, 'Equipe Blindagem Financeira')
    .replace(/\[\s*nome(?:\s+do\s+advogado)?\s*\]/gi, 'Equipe Blindagem Financeira')
    .replace(/\[\s*seu cargo\s*\]/gi, '')
    .replace(/\[.*?nome.*?\]/gi, 'Equipe Blindagem Financeira');

  text = text.replace(/Equipe Blindagem Financeira\s*\n\s*Blindagem Financeira/gi, 'Equipe Blindagem Financeira');

  // Normaliza markdown bold **texto** -> <strong>texto</strong>
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  const dangerTerms = [
    'execução fiscal',
    'execução de título extrajudicial',
    'execução de título',
    'execuções fiscais',
    'execuções',
    'alto risco',
    'risco de decisões adversas',
    'penhora',
    'bloqueio de contas',
    'bloqueio judicial',
    'bloqueio',
    'sisbajud',
    'bacenjud',
    'mandado de levantamento'
  ];

  const successTerms = [
    'arquivado provisoriamente',
    'arquivado definitivamente',
    'arquivamento',
    'alívio em sua situação',
    'alívio',
    'favorável para a sua defesa',
    'favorável',
    'débito cancelado',
    'extinta',
    'extinto',
    'acordo homologado',
    'sem restrições'
  ];

  dangerTerms.forEach(term => {
    const regex = new RegExp(`(?<!<span[^>]*>)\\b(${term})\\b(?![^<]*<\\/span>)`, 'gi');
    text = text.replace(regex, '<span style="color: #8a2b2b; font-weight: 700;">$1</span>');
  });

  successTerms.forEach(term => {
    const regex = new RegExp(`(?<!<span[^>]*>)\\b(${term})\\b(?![^<]*<\\/span>)`, 'gi');
    text = text.replace(regex, '<span style="color: #1b6b3e; font-weight: 700;">$1</span>');
  });

  return text
    .split(/\n\s*\n/)
    .map(p => `<p style="margin: 0 0 14px; line-height: 1.85;">${p.replace(/\n/g, '<br />')}</p>`)
    .join('');
}
