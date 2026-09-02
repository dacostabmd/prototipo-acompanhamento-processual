'use client';

import { useMemo, useState } from 'react';
import GhostFibers from './GhostFibers';
import {
  buildCaseData,
  buildCaseDataFromProcesses,
  TAG_META,
  type CaseData,
  type LegalProcess
} from '@/lib/mockProcesses';
import {
  cleanDigits,
  formatCpf,
  formatDateLabel,
  formatPhone,
  isValidCpf,
  normalizeName
} from '@/lib/format';

/* ── Design tokens (extraídos do protótipo) ───────────────────────────── */
const BLUE = '#2455b8';
const BLUE_DARK = '#17347a';
const BLUE_LIGHT = '#a9c3ef';
const NEAR_BLACK = '#0b0b0d';
const PAPER = '#ffffff';
const CREAM = '#f5f2ea';
const CREAM_TEXT = '#f5efe1';
const BORDER = '#e3ddd0';
const INPUT_BORDER = '#d7d0c0';
const INPUT_BG = '#fbf9f4';
const TEXT = '#1b2733';
const MUTED = '#5b6b78';
const DANGER = '#8a3a3a';
const WHATSAPP = '#25603f';

const LOADING_TEXT = 'Gerando resumo com inteligência artificial...';

export interface ProcessTrackerProps {
  /** Modelo usado nas chamadas de IA (repassado às rotas /api/ai/*). */
  aiModel?: 'claude-haiku-4-5' | 'claude-sonnet-4-5';
  /** Tom do assistente de triagem no chat. */
  chatTone?: 'Acolhedor' | 'Formal';
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export default function ProcessTracker({
  aiModel = 'claude-haiku-4-5',
  chatTone = 'Acolhedor'
}: ProcessTrackerProps) {
  const [fullName, setFullName] = useState('');
  const [cpfInput, setCpfInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [formError, setFormError] = useState('');

  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [caseData, setCaseData] = useState<CaseData | null>(null);

  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState('');

  const [whatsappSending, setWhatsappSending] = useState(false);
  const [whatsappSent, setWhatsappSent] = useState(false);

  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatEnded, setChatEnded] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);

  const found = hasSearched && !notFound && !!caseData;

  const loadingLetters = useMemo(
    () =>
      LOADING_TEXT.split('').map((ch, i) => ({
        ch: ch === ' ' ? '\u00A0' : ch,
        delay: `${(i * 0.035).toFixed(2)}s`
      })),
    []
  );

  /* ── Busca (consulta real via Infosimples /api/processos) ─────────────── */
  const handleSearch = async () => {
    const digits = cleanDigits(cpfInput);
    if (digits.length !== 11) return setFormError('Digite um CPF válido com 11 dígitos.');
    if (!isValidCpf(digits)) return setFormError('CPF inválido. Verifique os números digitados.');
    if (!fullName.trim()) return setFormError('Informe o nome completo.');
    const phoneDigits = cleanDigits(phoneInput);
    if (phoneDigits.length < 10 || phoneDigits.length > 11)
      return setFormError('Informe um telefone válido com DDD.');

    setFormError('');
    setSearching(true);
    setHasSearched(false);
    setWhatsappSent(false);

    try {
      const res = await fetch('/api/processos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: digits, fullName })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Falha ao consultar processos.');
      }

      if (data.notFound || !data.processes || data.processes.length === 0) {
        setNotFound(true);
        setCaseData(null);
      } else {
        setNotFound(false);
        setCaseData(buildCaseDataFromProcesses(data.processes));
      }

      setHasSearched(true);
      setAiSummary('');
      setAiSummaryError('');
    } catch (err: any) {
      console.error('[ProcessTracker search]', err);
      setFormError(err.message || 'Não foi possível consultar os processos no momento. Tente novamente.');
      setHasSearched(false);
    } finally {
      setSearching(false);
    }
  };

  const toggleExpand = (id: string) => {
    setCaseData(current =>
      current
        ? {
            ...current,
            timeline: current.timeline.map(item =>
              item.id === id ? { ...item, expanded: !item.expanded } : item
            )
          }
        : current
    );
  };

  /* ── Resumo por IA (mínimo de 3s para a animação de carregamento) ────── */
  const generateAiSummary = async () => {
    if (!caseData) return;
    setAiSummaryLoading(true);
    setAiSummaryError('');
    setAiSummary('');
    const startedAt = Date.now();
    try {
      const res = await fetch('/api/ai/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          model: aiModel,
          processes: caseData.processes.map((p: LegalProcess) => ({
            tipo: p.tipo,
            numero: p.numero,
            tribunal: p.tribunal,
            parteContraria: p.parteContraria,
            valorCausa: p.valorCausa,
            movimentos: p.movimentos.map(m => ({ data: m.data, titulo: m.titulo }))
          }))
        })
      });
      if (!res.ok) throw new Error('request failed');
      const { text } = await res.json();
      const remaining = 3000 - (Date.now() - startedAt);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
      setAiSummary(text);
    } catch {
      const remaining = 3000 - (Date.now() - startedAt);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
      setAiSummaryError('Não foi possível gerar o resumo agora. Tente novamente.');
    } finally {
      setAiSummaryLoading(false);
    }
  };

  /* ── Envio por WhatsApp (disparo direto do resumo para o número alvo) ─── */
  const sendWhatsapp = () => {
    if (!caseData || whatsappSending) return;

    const rawDigits = cleanDigits(phoneInput);
    if (rawDigits.length < 10) {
      setFormError('Informe um telefone válido com DDD para envio por WhatsApp.');
      return;
    }

    setWhatsappSending(true);

    const targetPhone = rawDigits.startsWith('55') ? rawDigits : `55${rawDigits}`;

    let resumoTexto = '';

    if (aiSummary) {
      // Converte tags HTML e spans de cores para a formatação nativa do WhatsApp
      resumoTexto = aiSummary
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
        .trim();
    } else {
      resumoTexto = caseData.processes
        .slice(0, 5)
        .map(
          (p, i) =>
            `${i + 1}. *${p.tipo}* (${p.numero})\n   • *Tribunal:* ${p.tribunal}\n   • *Parte Contrária:* ${p.parteContraria}\n   • *Valor:* ${p.valorCausa}\n   • *Último andamento:* ${p.movimentos[0]?.titulo || 'Sem movimentações'}`
        )
        .join('\n\n');

      if (caseData.processes.length > 5) {
        resumoTexto += `\n\n...e mais *${caseData.processes.length - 5}* processo(s) localizado(s).`;
      }
    }

    const mensagem =
      `*BLINDAGEM FINANCEIRA — Resumo Processual*\n\n` +
      `*Cliente:* ${fullName || 'Cliente'}\n` +
      `*CPF:* ${cpfInput}\n` +
      `*Processos Localizados:* ${caseData.totalProcessos}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `*RESUMO DO ANDAMENTO:*\n\n` +
      `${resumoTexto}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `_Para auxílio jurídico especializado em proteção patrimonial e defesa em execuções, fale com nossa equipe._\n` +
      `*Blindagem Financeira*`;

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${targetPhone}&text=${encodeURIComponent(mensagem)}`;

    window.open(whatsappUrl, '_blank');

    setWhatsappSending(false);
    setWhatsappSent(true);
  };

  /* ── Chat de triagem ─────────────────────────────────────────────────── */
  const openChat = () => {
    if (chatMessages.length === 0) {
      setChatMessages([
        {
          role: 'assistant',
          content:
            'Olá! Sou o assistente jurídico da Blindagem Financeira. Pode me contar, com suas palavras, o que está acontecendo? Se souber o número do processo ou tiver documentos relacionados, pode compartilhar aqui também.'
        }
      ]);
    }
    setChatOpen(true);
  };

  const sendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const next: ChatMessage[] = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(next);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next,
          tone: chatTone,
          model: aiModel,
          totalProcessos: caseData?.totalProcessos ?? 0
        })
      });
      if (!res.ok) throw new Error('request failed');
      const { text: reply } = await res.json();
      setChatMessages(current => [...current, { role: 'assistant', content: reply }]);
    } catch {
      setChatMessages(current => [
        ...current,
        { role: 'assistant', content: 'Desculpe, não consegui responder agora. Pode tentar novamente?' }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const finalizeChat = () => {
    setChatMessages(current => [
      ...current,
      {
        role: 'assistant',
        content:
          'Dossiê enviado ao advogado responsável, reunindo seus dados, o resumo gerado por IA e as informações processuais consultadas via Infosimples. Em breve alguém da nossa equipe entrará em contato.'
      }
    ]);
    setChatEnded(true);
  };

  const summaryButtonLabel = aiSummaryLoading
    ? 'GERANDO...'
    : aiSummary
      ? 'GERAR NOVAMENTE'
      : 'GERAR RESUMO COM IA';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: NEAR_BLACK,
        fontFamily: 'var(--font-cinzel), serif',
        fontWeight: 600,
        color: TEXT,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}
    >
      {/* Fundo animado (shader WebGL) */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <GhostFibers
          lineColor="#16244f"
          glowColor={BLUE}
          speed={0.15}
          grain={0.035}
          vignette={0.9}
          brightness={1.5}
        />
      </div>

      {/* Cabeçalho */}
      <header
        style={{
          position: 'relative',
          zIndex: 1,
          background: BLUE,
          padding: '18px clamp(16px,5vw,40px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/blindagem-logo.png" alt="Blindagem Financeira" style={{ height: 38 }} />
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.25)', paddingLeft: 14 }}>
            <div style={{ color: CREAM_TEXT, fontSize: 'clamp(10px,2.4vw,12px)', letterSpacing: 2 }}>
              ACOMPANHAMENTO DE PROCESSOS
            </div>
          </div>
        </div>
        <div style={{ color: '#9fb0bd', fontSize: 11.5, letterSpacing: 0.5 }}>
          Proteção patrimonial · Negociação de dívidas · Defesa em execuções
        </div>
      </header>

      <main
        style={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          maxWidth: 920,
          margin: '0 auto',
          padding: '40px clamp(12px,4vw,24px) 100px',
          width: '100%'
        }}
      >
        {/* Formulário de consulta */}
        <section
          style={{
            background: PAPER,
            border: `1px solid ${BORDER}`,
            borderTop: `4px solid ${BLUE}`,
            padding: 'clamp(20px,5vw,36px) clamp(16px,5vw,40px)'
          }}
        >
          <h1
            style={{
              margin: '0 0 8px',
              fontSize: 'clamp(20px,5vw,25px)',
              letterSpacing: 0.5,
              color: '#000',
              fontWeight: 600
            }}
          >
            Consulte seus processos
          </h1>
          <p style={{ margin: '0 0 28px', fontSize: 14, color: MUTED, lineHeight: 1.7, maxWidth: 580 }}>
            Informe seus dados para verificarmos se existem processos judiciais vinculados ao seu CPF,
            com base em fontes públicas processuais (via Infosimples).
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 11.5, letterSpacing: 1, color: '#000' }}>NOME COMPLETO</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                onBlur={() => setFullName(current => normalizeName(current))}
                placeholder="Digite seu nome completo"
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 11.5, letterSpacing: 1, color: '#000' }}>CPF</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={cpfInput}
                  onChange={e => {
                    setCpfInput(formatCpf(e.target.value));
                    setFormError('');
                  }}
                  placeholder="000.000.000-00"
                  maxLength={14}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 190 }}>
                <label style={{ fontSize: 11.5, letterSpacing: 1, color: '#000' }}>
                  TELEFONE (WHATSAPP)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={phoneInput}
                  onChange={e => {
                    setPhoneInput(formatPhone(e.target.value));
                    setFormError('');
                  }}
                  placeholder="(00) 00000-0000"
                  maxLength={15}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <button onClick={handleSearch} style={primaryButtonStyle}>
                {searching ? 'CONSULTANDO...' : 'CONSULTAR PROCESSOS'}
              </button>
              {searching && (
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    border: '3px solid rgba(36,85,184,0.15)',
                    borderTopColor: BLUE,
                    borderRightColor: BLUE,
                    animation: 'bf-spin 0.9s linear infinite'
                  }}
                />
              )}
            </div>

            {formError && <div style={{ color: DANGER, fontSize: 13 }}>{formError}</div>}
          </div>
        </section>

        {/* Nenhum processo localizado */}
        {hasSearched && notFound && (
          <section
            style={{
              marginTop: 28,
              background: PAPER,
              border: `1px solid ${BORDER}`,
              borderLeft: '4px solid #4a5a6a',
              padding: '32px 40px',
              animation: 'bf-fadein 0.7s ease both'
            }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: 18, color: '#000', fontWeight: 600 }}>
              Nenhum processo localizado automaticamente
            </h2>
            <p style={{ margin: '0 0 22px', fontSize: 14, color: MUTED, lineHeight: 1.7 }}>
              Isso não significa que não existam pendências. Muitos clientes descobrem processos e
              cobranças que desconheciam apenas com apoio jurídico especializado.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={() => setInfoModalOpen(true)}
                style={{ ...primaryButtonStyle, padding: '13px 26px', fontWeight: 400, letterSpacing: 1 }}
              >
                PRECISO DE AUXÍLIO JURÍDICO
              </button>
            </div>
          </section>
        )}

        {/* Papel branco com resultados */}
        {found && caseData && (
          <section
            style={{
              marginTop: 28,
              background: PAPER,
              padding: 'clamp(14px,4vw,28px)',
              boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
              animation: 'bf-fadein 0.7s ease both'
            }}
          >
            {/* Faixa do cliente */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 14,
                background: BLUE,
                color: CREAM_TEXT,
                padding: '20px 28px'
              }}
            >
              <div>
                <div style={stripLabelStyle}>CLIENTE</div>
                <div style={{ fontSize: 15.5 }}>{fullName}</div>
              </div>
              <div>
                <div style={stripLabelStyle}>CPF CONSULTADO</div>
                <div style={{ fontSize: 15.5 }}>{cpfInput}</div>
              </div>
              <div>
                <div style={stripLabelStyle}>PROCESSOS ENCONTRADOS</div>
                <div style={{ fontSize: 15.5 }}>{caseData.totalProcessos}</div>
              </div>
            </div>

            {/* Resumo por IA + WhatsApp */}
            <div
              style={{
                marginTop: 24,
                background: PAPER,
                border: `1px solid ${BORDER}`,
                padding: '28px 32px'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 14,
                  textAlign: 'center'
                }}
              >
                <h3 style={{ margin: 0, fontSize: 15.5, color: '#000', letterSpacing: 0.5, fontWeight: 600 }}>
                  Resumo e explicação do andamento
                </h3>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button onClick={generateAiSummary} style={ghostButtonStyle}>
                    {summaryButtonLabel}
                  </button>
                  <button
                    onClick={sendWhatsapp}
                    style={{
                      background: WHATSAPP,
                      color: CREAM_TEXT,
                      border: 'none',
                      padding: '10px 20px',
                      fontFamily: 'inherit',
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
                    {whatsappSending ? 'ENVIANDO...' : whatsappSent ? 'ENVIADO' : 'ENVIAR POR WHATSAPP'}
                  </button>
                </div>
              </div>

              {whatsappSent && (
                <p style={{ marginTop: 16, fontSize: 13, color: WHATSAPP, textAlign: 'center' }}>
                  Mensagem enviada via WhatsApp para {phoneInput} com o resumo e os dados do processo.
                </p>
              )}

              {/* Animação de carregamento: onda + letras em fade-out */}
              {aiSummaryLoading && (
                <div
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    height: 34,
                    marginTop: 16,
                    display: 'flex',
                    justifyContent: 'center'
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      width: '45%',
                      background:
                        'linear-gradient(90deg,transparent,rgba(36,85,184,0.55),transparent)',
                      mixBlendMode: 'multiply',
                      animation: 'bf-wave-sweep 1.9s ease-in-out infinite'
                    }}
                  />
                  <div
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 14,
                      color: MUTED
                    }}
                  >
                    <span style={{ display: 'flex' }}>
                      {loadingLetters.map((l, i) => (
                        <span
                          key={i}
                          style={{
                            display: 'inline-block',
                            animation: 'bf-letter-fade 1.9s ease-in-out infinite',
                            animationDelay: l.delay
                          }}
                        >
                          {l.ch}
                        </span>
                      ))}
                    </span>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill={BLUE}
                      style={{
                        animation: 'bf-letter-fade 1.9s ease-in-out infinite',
                        animationDelay: '0.9s',
                        flexShrink: 0
                      }}
                    >
                      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
                    </svg>
                  </div>
                </div>
              )}

              {aiSummary && (
                <div style={{ marginTop: 20 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 10,
                      marginBottom: 14
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: 9.5,
                        letterSpacing: 1.5,
                        color: BLUE,
                        border: `1px solid ${BLUE}`,
                        padding: '3px 8px'
                      }}
                    >
                      GERADO POR IA
                    </span>

                    {/* Legenda visual de cores */}
                    <div
                      style={{
                        display: 'flex',
                        gap: 14,
                        flexWrap: 'wrap',
                        fontSize: 11,
                        color: MUTED
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8a2b2b' }} />
                        <span style={{ color: '#8a2b2b', fontWeight: 700 }}>Vermelho escuro:</span> Alertas e execuções
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1b6b3e' }} />
                        <span style={{ color: '#1b6b3e', fontWeight: 700 }}>Verde escuro:</span> Pontos favoráveis
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <strong style={{ color: '#000' }}>Negrito:</strong> Processos e valores
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.85,
                      color: TEXT,
                      textAlign: 'left',
                      background: '#faf8f5',
                      border: `1px solid ${BORDER}`,
                      padding: '20px 24px'
                    }}
                    dangerouslySetInnerHTML={{ __html: formatAiSummaryHtml(aiSummary) }}
                  />
                </div>
              )}

              {aiSummaryError && (
                <p style={{ marginTop: 14, fontSize: 13, color: DANGER, textAlign: 'center' }}>
                  {aiSummaryError}
                </p>
              )}
            </div>

            {/* Linha do tempo */}
            <div style={{ marginTop: 32 }}>
              <h3
                style={{
                  fontSize: 15.5,
                  color: '#fff',
                  letterSpacing: 0.5,
                  margin: '0 0 20px',
                  fontWeight: 600
                }}
              >
                Linha do tempo de atualizações
              </h3>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  paddingLeft: 28,
                  borderLeft: `2px solid ${BORDER}`
                }}
              >
                {caseData.timeline.map(item => {
                  const meta = TAG_META[item.tag];
                  return (
                    <div key={item.id} style={{ position: 'relative', padding: '0 0 26px 24px' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: -35,
                          top: 4,
                          width: 11,
                          height: 11,
                          borderRadius: '50%',
                          background: meta.color,
                          border: '2px solid #2b2b2e'
                        }}
                      />
                      <div
                        onClick={() => toggleExpand(item.id)}
                        style={{
                          cursor: 'pointer',
                          background: PAPER,
                          border: `1px solid ${BORDER}`,
                          padding: '18px 22px'
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            gap: 12,
                            flexWrap: 'wrap'
                          }}
                        >
                          <span style={{ fontSize: 11, letterSpacing: 1, color: MUTED }}>
                            {formatDateLabel(item.date)}
                          </span>
                          <span
                            style={{ fontSize: 10, letterSpacing: 1, fontWeight: 600, color: meta.color }}
                          >
                            {meta.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 15, color: TEXT, marginTop: 7 }}>{item.titulo}</div>

                        {/* Expansão suave via max-height */}
                        <div
                          style={{
                            maxHeight: item.expanded ? 600 : 0,
                            overflow: 'hidden',
                            transition: 'max-height 0.35s ease'
                          }}
                        >
                          <div
                            style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}
                          >
                            <p style={{ margin: '0 0 14px', fontSize: 13, color: MUTED, lineHeight: 1.75 }}>
                              {item.descricao}
                            </p>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                                gap: '9px 20px',
                                fontSize: 12,
                                color: TEXT
                              }}
                            >
                              <div>
                                <strong style={{ color: '#000' }}>Processo:</strong> {item.processo.numero}
                              </div>
                              <div>
                                <strong style={{ color: '#000' }}>Tribunal:</strong>{' '}
                                {item.processo.tribunal}
                              </div>
                              <div>
                                <strong style={{ color: '#000' }}>Tipo:</strong> {item.processo.tipo}
                              </div>
                              <div>
                                <strong style={{ color: '#000' }}>Parte contrária:</strong>{' '}
                                {item.processo.parteContraria}
                              </div>
                              <div>
                                <strong style={{ color: '#000' }}>Valor da causa:</strong>{' '}
                                {item.processo.valorCausa}
                              </div>
                              <div>
                                <strong style={{ color: '#000' }}>Distribuição:</strong>{' '}
                                {item.processo.distribuicao}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 32, display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={() => setInfoModalOpen(true)}
                style={{
                  ...primaryButtonStyle,
                  padding: '16px 32px',
                  boxShadow: '0 4px 14px rgba(36,85,184,0.25)'
                }}
              >
                PRECISO DE AUXÍLIO JURÍDICO
              </button>
            </div>
          </section>
        )}
      </main>

      {/* Modal informativo (antes do chat) */}
      <div
        onClick={() => setInfoModalOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,36,56,0.55)',
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          opacity: infoModalOpen ? 1 : 0,
          pointerEvents: infoModalOpen ? 'auto' : 'none',
          transition: 'opacity 0.3s ease'
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: PAPER,
            maxWidth: 440,
            width: '100%',
            padding: 32,
            textAlign: 'center',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            transform: infoModalOpen ? 'scale(1)' : 'scale(0.94)',
            transition: 'transform 0.3s ease'
          }}
        >
          <p style={{ margin: '0 0 22px', fontSize: 14, lineHeight: 1.8, color: TEXT }}>
            Quanto mais informações e arquivos você nos enviar agora, mais rápido e completo será o
            relatório que levaremos ao nosso advogado parceiro para avaliar seu caso.
          </p>
          <button
            onClick={() => {
              setInfoModalOpen(false);
              openChat();
            }}
            style={{ ...primaryButtonStyle, padding: '12px 28px', fontSize: 12, fontWeight: 400 }}
          >
            CONTINUAR
          </button>
        </div>
      </div>

      {/* Modal do chat */}
      <div
        onClick={() => setChatOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,36,56,0.55)',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          opacity: chatOpen ? 1 : 0,
          pointerEvents: chatOpen ? 'auto' : 'none',
          transition: 'opacity 0.3s ease'
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: 525,
            maxWidth: '100%',
            height: '80vh',
            maxHeight: 660,
            background: CREAM,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            transform: chatOpen ? 'scale(1)' : 'scale(0.94)',
            transition: 'transform 0.3s ease'
          }}
        >
          <div
            style={{
              background: BLUE,
              color: CREAM_TEXT,
              padding: '20px 24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, letterSpacing: 1 }}>ASSISTENTE JURÍDICO</div>
              <div style={{ fontSize: 10.5, color: BLUE_LIGHT, marginTop: 3 }}>Blindagem Financeira</div>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: CREAM_TEXT,
                fontSize: 20,
                cursor: 'pointer',
                lineHeight: 1
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
              >
                <div
                  style={{
                    maxWidth: '82%',
                    padding: '12px 16px',
                    fontSize: 13.5,
                    lineHeight: 1.65,
                    background: msg.role === 'user' ? BLUE : PAPER,
                    color: msg.role === 'user' ? '#fff' : TEXT,
                    border: msg.role === 'user' ? 'none' : `1px solid ${BORDER}`
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    padding: '12px 16px',
                    fontSize: 13,
                    color: MUTED,
                    animation: 'bf-blink 1.4s ease-in-out infinite'
                  }}
                >
                  Digitando...
                </div>
              </div>
            )}
          </div>

          {chatEnded ? (
            <div
              style={{
                padding: '16px 20px',
                fontSize: 11.5,
                letterSpacing: 0.5,
                color: MUTED,
                borderTop: `1px solid ${BORDER}`,
                background: PAPER
              }}
            >
              Atendimento finalizado.
            </div>
          ) : (
            <div
              style={{
                borderTop: `1px solid ${BORDER}`,
                padding: '14px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                background: PAPER
              }}
            >
              {attachedFiles.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {attachedFiles.map((file, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: 11,
                        background: CREAM,
                        border: `1px solid ${BORDER}`,
                        padding: '4px 10px'
                      }}
                    >
                      {file}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label
                  title="Anexar documento"
                  style={{ cursor: 'pointer', color: MUTED, display: 'flex', alignItems: 'center' }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M8 12l6-6a3 3 0 114 4l-8 8a5 5 0 01-7-7l7-7" />
                  </svg>
                  <input
                    type="file"
                    multiple
                    onChange={e => {
                      const names = Array.from(e.target.files ?? []).map(f => f.name);
                      if (names.length) setAttachedFiles(current => [...current, ...names]);
                    }}
                    style={{ display: 'none' }}
                  />
                </label>
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendChatMessage();
                    }
                  }}
                  placeholder="Descreva sua situação, número do processo..."
                  style={{ ...inputStyle, flex: 1, fontSize: 13, padding: '11px 14px' }}
                />
                <button
                  onClick={() => void sendChatMessage()}
                  style={{
                    background: BLUE,
                    color: CREAM_TEXT,
                    border: 'none',
                    padding: '11px 18px',
                    fontFamily: 'inherit',
                    fontSize: 11.5,
                    letterSpacing: 1,
                    cursor: 'pointer'
                  }}
                >
                  ENVIAR
                </button>
              </div>
              <button
                onClick={finalizeChat}
                style={{
                  alignSelf: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: `1px solid ${BLUE}`,
                  color: '#000',
                  padding: '9px 16px',
                  fontFamily: 'inherit',
                  fontSize: 10.5,
                  letterSpacing: 1,
                  cursor: 'pointer'
                }}
              >
                FINALIZAR E ENVIAR DOSSIÊ AO ADVOGADO
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Estilos reutilizados ─────────────────────────────────────────────── */
const inputStyle: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 15,
  padding: '12px 14px',
  border: `1px solid ${INPUT_BORDER}`,
  background: INPUT_BG,
  color: TEXT,
  outline: 'none'
};

const primaryButtonStyle: React.CSSProperties = {
  background: BLUE,
  color: '#ffffff',
  border: 'none',
  padding: '13px 28px',
  fontFamily: 'inherit',
  fontSize: 12.5,
  letterSpacing: 1.5,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
};

const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#000',
  border: `1px solid ${BLUE}`,
  padding: '10px 20px',
  fontFamily: 'inherit',
  fontSize: 11.5,
  letterSpacing: 1,
  cursor: 'pointer'
};

const stripLabelStyle: React.CSSProperties = {
  fontSize: 10.5,
  letterSpacing: 2,
  color: BLUE_LIGHT,
  marginBottom: 4
};

/* Referência de token não usada diretamente, mantida para o dev: */
void BLUE_DARK;

/** Formata o resumo da IA garantindo destaque em vermelho escuro (#8a2b2b), verde escuro (#1b6b3e) e negrito. */
function formatAiSummaryHtml(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // 1. Normaliza markdown bold **texto** -> <strong>texto</strong>
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // 2. Destacar termos de risco em vermelho escuro (#8a2b2b) se não estiverem já estilizados
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

  // 3. Destacar termos favoráveis em verde escuro (#1b6b3e) se não estiverem já estilizados
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

  // 4. Parágrafos estruturados com espaçamento elegante
  return text
    .split(/\n\s*\n/)
    .map(p => `<p style="margin: 0 0 14px; line-height: 1.85;">${p.replace(/\n/g, '<br />')}</p>`)
    .join('');
}

