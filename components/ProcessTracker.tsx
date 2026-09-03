'use client';

import React, { useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import GhostFibers from './GhostFibers';
import Stepper, { Step } from './Stepper';
import ProcessDashboardSplit from './ProcessDashboardSplit';
import {
  buildCaseData,
  buildCaseDataFromProcesses,
  type CaseData,
  type LegalProcess
} from '@/lib/mockProcesses';
import {
  cleanDigits,
  formatCpf,
  formatPhone,
  isValidCpf
} from '@/lib/format';

/* ── Design tokens ────────────────────────────────────────────────────── */
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

const BRAZIL_STATES = [
  { value: 'AUTO', label: 'Verificação Inteligente (Recomendado — SP, RJ e Federais)' },
  { value: 'SP', label: 'São Paulo — TJSP (Tribunal de Justiça de SP)' },
  { value: 'RJ', label: 'Rio de Janeiro — TJRJ (Tribunal de Justiça do RJ)' },
  { value: 'MG', label: 'Minas Gerais — TJMG' },
  { value: 'RS', label: 'Rio Grande do Sul — TJRS' },
  { value: 'PR', label: 'Paraná — TJPR' },
  { value: 'SC', label: 'Santa Catarina — TJSC' },
  { value: 'DF', label: 'Distrito Federal — TJDFT' },
  { value: 'BA', label: 'Bahia — TJBA' },
  { value: 'FEDERAL', label: 'Justiça Federal — TRF1 / TRF2 / TRF3' },
  { value: 'OUTRO', label: 'Outro Tribunal Estadual' }
];

export interface ProcessTrackerProps {
  aiModel?: 'claude-haiku-4-5' | 'claude-sonnet-4-5';
  chatTone?: 'Acolhedor' | 'Formal';
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export default function ProcessTracker({
  aiModel = 'claude-haiku-4-5',
  chatTone = 'Acolhedor'
}: ProcessTrackerProps) {
  // Stepper Fields
  const [fullName, setFullName] = useState('');
  const [cpfInput, setCpfInput] = useState('');
  const [stateInput, setStateInput] = useState('AUTO');
  const [processNumberInput, setProcessNumberInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [formError, setFormError] = useState('');

  // Search & Result states
  const [currentStepIndex, setCurrentStepIndex] = useState(1);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [tribunaisConsultados, setTribunaisConsultados] = useState<string[]>([]);

  // Bitrix states
  const [bitrixLeadId, setBitrixLeadId] = useState<string | number | null>(null);
  const [bitrixSimulated, setBitrixSimulated] = useState(false);

  // AI Summary state
  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState('');

  // Floating Chat Modal state (com 40% a mais de largura e altura)
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatEnded, setChatEnded] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);

  const found = hasSearched && !notFound && !!caseData;

  // Validações por passo do Stepper
  const isStep1Valid = fullName.trim().length >= 3;
  const isStep2Valid = cleanDigits(cpfInput).length === 11 && isValidCpf(cleanDigits(cpfInput));
  const isStep3Valid = true;
  const isStep4Valid = cleanDigits(phoneInput).length >= 10;

  const canAdvanceCurrentStep = useMemo(() => {
    switch (currentStepIndex) {
      case 1:
        return isStep1Valid;
      case 2:
        return isStep2Valid;
      case 3:
        return isStep3Valid;
      case 4:
        return isStep4Valid;
      default:
        return true;
    }
  }, [currentStepIndex, isStep1Valid, isStep2Valid, isStep3Valid, isStep4Valid]);

  // Dispara Confete com a paleta nobre estendida
  const triggerConfetti = () => {
    const colors = [
      '#2455b8',
      '#17347a',
      '#3b82f6',
      '#c5a059',
      '#d4af37',
      '#1b6b3e',
      '#8a2b2b',
      '#f5efe1',
      '#60a5fa',
      '#93c5fd'
    ];

    confetti({
      particleCount: 90,
      spread: 75,
      origin: { y: 0.6 },
      colors
    });

    window.setTimeout(() => {
      confetti({
        particleCount: 60,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors
      });
      confetti({
        particleCount: 60,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors
      });
    }, 280);
  };

  // Envio final do Stepper e Execução da Busca + Bitrix
  const handleFinalStepCompleted = async () => {
    const digits = cleanDigits(cpfInput);
    const phoneDigits = cleanDigits(phoneInput);

    if (!isStep1Valid || !isStep2Valid || !isStep4Valid) {
      setFormError('Por favor, revise os dados informados nos passos anteriores.');
      return;
    }

    setFormError('');
    setSearching(true);
    setHasSearched(false);

    // Dispara Confete imediatamente ao finalizar o Stepper
    triggerConfetti();

    try {
      // 1. Busca processual multi-tribunal
      const res = await fetch('/api/processos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: digits,
          fullName,
          phone: phoneDigits,
          state: stateInput,
          processNumber: processNumberInput
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Falha ao consultar processos.');
      }

      setTribunaisConsultados(data.tribunaisConsultados || []);

      let currentCases: CaseData | null = null;
      let totalFound = 0;

      if (data.notFound || !data.processes || data.processes.length === 0) {
        setNotFound(true);
        setCaseData(null);
      } else {
        setNotFound(false);
        currentCases = buildCaseDataFromProcesses(data.processes);
        setCaseData(currentCases);
        totalFound = data.processes.length;
      }

      setHasSearched(true);

      // 2. Integração com Bitrix24 (criação automática de card)
      try {
        const bitrixRes = await fetch('/api/bitrix/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName,
            cpf: formatCpf(digits),
            phone: formatPhone(phoneDigits),
            state: stateInput,
            processNumber: processNumberInput,
            processesCount: totalFound,
            tribunal: data.tribunaisConsultados?.join(', ') || stateInput,
            processesSummary: currentCases
              ? currentCases.processes.slice(0, 3).map(p => `${p.tipo} (${p.numero}) - ${p.valorCausa}`).join('; ')
              : 'Nenhum processo localizado automaticamente'
          })
        });
        const bitrixData = await bitrixRes.json();
        if (bitrixData.leadId) setBitrixLeadId(bitrixData.leadId);
        if (bitrixData.simulated) setBitrixSimulated(true);
      } catch (err) {
        console.error('[Bitrix integration error]', err);
      }

      // 3. Se encontrou processos, gera automaticamente o resumo por IA
      if (currentCases) {
        void fetchAiSummary(currentCases);
      }
    } catch (err: any) {
      console.error('[ProcessTracker search error]', err);
      setFormError(err.message || 'Não foi possível consultar os processos no momento. Tente novamente.');
      setHasSearched(false);
    } finally {
      setSearching(false);
    }
  };

  // Geração de Resumo com IA
  const fetchAiSummary = async (casesToSummarize: CaseData) => {
    setAiSummaryLoading(true);
    setAiSummaryError('');
    try {
      const res = await fetch('/api/ai/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          model: aiModel,
          processes: casesToSummarize.processes.map((p: LegalProcess) => ({
            tipo: p.tipo,
            numero: p.numero,
            tribunal: p.tribunal,
            parteContraria: p.parteContraria,
            valorCausa: p.valorCausa,
            movimentos: p.movimentos.map(m => ({ data: m.data, titulo: m.titulo }))
          }))
        })
      });
      if (!res.ok) throw new Error('Falha na rota de resumo da IA');
      const { text } = await res.json();
      setAiSummary(text);
    } catch {
      setAiSummaryError('Não foi possível gerar o resumo automático agora.');
    } finally {
      setAiSummaryLoading(false);
    }
  };

  // Abrir Chat Flutuante (com dimensões 40% maiores)
  const openChat = () => {
    if (chatMessages.length === 0) {
      setChatMessages([
        {
          role: 'assistant',
          content:
            'Olá! Sou o assistente jurídico da Blindagem Financeira. Pode me contar o que está acontecendo? Se tiver número de processo ou documentos, pode compartilhar aqui também.'
        }
      ]);
    }
    setChatOpen(true);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    const newMessages: ChatMessage[] = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages(newMessages);
    setChatLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          tone: chatTone,
          model: aiModel,
          caseContext: caseData
            ? {
                fullName,
                cpf: cpfInput,
                totalProcessos: caseData.totalProcessos,
                processes: caseData.processes.map(p => ({
                  numero: p.numero,
                  tribunal: p.tribunal,
                  tipo: p.tipo,
                  valorCausa: p.valorCausa,
                  parteContraria: p.parteContraria
                }))
              }
            : null
        })
      });

      if (!res.ok) throw new Error('Falha no chat');
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.text }]);
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
        position: 'relative',
        minHeight: '100vh',
        background: found
          ? 'radial-gradient(ellipse at 50% 0%, #152744 0%, #0b0b0d 75%)'
          : NEAR_BLACK,
        color: TEXT,
        fontFamily: "'Cinzel', 'Playfair Display', Georgia, 'Times New Roman', serif"
      }}
    >
      {/* Fibers de fundo no canvas ativo apenas no formulário/stepper para alto desempenho */}
      {!found && <GhostFibers />}

      {/* Container principal */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          padding: 'clamp(20px, 4vw, 48px) clamp(16px, 3vw, 36px)',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}
      >
        {/* Logotipo Blindagem Financeira */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img
            src="/blindagem-logo.png"
            alt="Blindagem Financeira"
            style={{
              height: 48,
              width: 'auto',
              filter: 'brightness(1.1) drop-shadow(0 4px 12px rgba(0,0,0,0.6))',
              display: 'inline-block'
            }}
          />
        </div>

        {/* ═════════════════════════════════════════════════════════════════
            FASE 1: FORMULÁRIO EM STEPPER ANIMADO (4 PASSOS)
            ═════════════════════════════════════════════════════════════════ */}
        {!hasSearched && (
          <div style={{ width: '100%', maxWidth: 720, animation: 'bf-fadein 0.5s ease both' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <h1
                style={{
                  fontSize: 'clamp(20px, 3.2vw, 26px)',
                  color: '#ffffff',
                  letterSpacing: 1.5,
                  margin: '0 0 8px',
                  fontWeight: 600,
                  textShadow: '0 2px 8px rgba(0,0,0,0.5)'
                }}
              >
                CONSULTE SEUS PROCESSOS
              </h1>
              <p
                style={{
                  fontSize: 13.5,
                  color: '#d1d5db',
                  lineHeight: 1.6,
                  maxWidth: 580,
                  margin: '0 auto',
                  fontFamily: 'system-ui, -apple-system, sans-serif'
                }}
              >
                Preencha os passos abaixo para verificar processos judiciais e execuções vinculadas ao seu documento.
              </p>
            </div>

            {formError && (
              <div
                style={{
                  background: 'rgba(138,58,58,0.9)',
                  color: '#ffffff',
                  padding: '10px 16px',
                  borderRadius: 2,
                  marginBottom: 16,
                  fontSize: 13,
                  textAlign: 'center'
                }}
              >
                {formError}
              </div>
            )}

            {searching ? (
              <div
                style={{
                  background: PAPER,
                  padding: '48px 32px',
                  borderRadius: 4,
                  textAlign: 'center',
                  boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
                  border: `1px solid ${BORDER}`
                }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    width: 44,
                    height: 44,
                    border: `3px solid ${BORDER}`,
                    borderTopColor: BLUE,
                    borderRadius: '50%',
                    animation: 'bf-spin 0.9s linear infinite',
                    marginBottom: 16
                  }}
                />
                <h3 style={{ margin: '0 0 8px', fontSize: 18, color: '#000', fontWeight: 600 }}>
                  Varrendo bases judiciais...
                </h3>
                <p style={{ margin: 0, fontSize: 13.5, color: MUTED }}>
                  Consultando tribunais e registrando protocolo com Inteligência Artificial.
                </p>
              </div>
            ) : (
              <Stepper
                initialStep={1}
                onStepChange={step => setCurrentStepIndex(step)}
                onFinalStepCompleted={handleFinalStepCompleted}
                canAdvance={canAdvanceCurrentStep}
                backButtonText="VOLTAR"
                nextButtonText="CONTINUAR"
              >
                {/* ── PASSO 1: NOME COMPLETO ── */}
                <Step>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: BLUE, fontWeight: 700, marginBottom: 4 }}>
                      PASSO 1 DE 4 · IDENTIFICAÇÃO OFICIAL
                    </div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#000', fontWeight: 600 }}>
                      Nome Completo do Titular
                    </h2>
                    <p style={{ margin: '0 0 18px', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                      Informe exatamente como consta no RG, CNH ou na capa do processo para correta validação.
                    </p>

                    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#000', marginBottom: 6 }}>
                      NOME COMPLETO
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      placeholder="Nome completo exatamente como consta no documento ou processo"
                      style={inputStyle}
                      autoFocus
                    />
                    {!isStep1Valid && fullName.length > 0 && (
                      <span style={{ fontSize: 11, color: DANGER, marginTop: 4, display: 'block' }}>
                        Mínimo de 3 caracteres para identificação.
                      </span>
                    )}
                  </div>
                </Step>

                {/* ── PASSO 2: CPF ── */}
                <Step>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: BLUE, fontWeight: 700, marginBottom: 4 }}>
                      PASSO 2 DE 4 · DOCUMENTO OFICIAL
                    </div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#000', fontWeight: 600 }}>
                      Cadastro de Pessoa Física (CPF)
                    </h2>
                    <p style={{ margin: '0 0 18px', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                      O número do CPF é utilizado para rastreamento nas bases públicas dos tribunais.
                    </p>

                    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#000', marginBottom: 6 }}>
                      CPF
                    </label>
                    <input
                      type="text"
                      value={cpfInput}
                      onChange={e => setCpfInput(formatCpf(e.target.value))}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      style={inputStyle}
                      autoFocus
                    />
                    {!isStep2Valid && cleanDigits(cpfInput).length === 11 && (
                      <span style={{ fontSize: 11, color: DANGER, marginTop: 4, display: 'block' }}>
                        Dígito verificador do CPF inválido. Verifique os números.
                      </span>
                    )}
                  </div>
                </Step>

                {/* ── PASSO 3: ESTADO DO PROCESSO ── */}
                <Step>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: BLUE, fontWeight: 700, marginBottom: 4 }}>
                      PASSO 3 DE 4 · JURISDIÇÃO E PROCESSO
                    </div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#000', fontWeight: 600 }}>
                      Estado do Processo ou Número CNJ
                    </h2>
                    <p style={{ margin: '0 0 18px', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                      Selecione o estado provável onde tramita a ação e/ou informe o número do processo se já souber.
                    </p>

                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#000', marginBottom: 6 }}>
                        ESTADO DO PROCESSO / TRIBUNAL
                      </label>
                      <select
                        value={stateInput}
                        onChange={e => setStateInput(e.target.value)}
                        style={{
                          ...inputStyle,
                          cursor: 'pointer'
                        }}
                      >
                        {BRAZIL_STATES.map(st => (
                          <option key={st.value} value={st.value}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#000', marginBottom: 6 }}>
                        NÚMERO DO PROCESSO (CNJ — OPCIONAL)
                      </label>
                      <input
                        type="text"
                        value={processNumberInput}
                        onChange={e => setProcessNumberInput(e.target.value)}
                        placeholder="0000000-00.0000.0.00.0000 (se possuir)"
                        style={inputStyle}
                      />
                      <span style={{ fontSize: 11, color: MUTED, marginTop: 4, display: 'block' }}>
                        Deixe em branco se desejar que a busca encontre todos os processos vinculados ao seu CPF.
                      </span>
                    </div>
                  </div>
                </Step>

                {/* ── PASSO 4: NÚMERO DE CELULAR ── */}
                <Step>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: BLUE, fontWeight: 700, marginBottom: 4 }}>
                      PASSO 4 DE 4 · CONTATO & WHATSAPP
                    </div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#000', fontWeight: 600 }}>
                      Número de Celular (WhatsApp)
                    </h2>
                    <p style={{ margin: '0 0 18px', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                      Utilizado para envio do relatório confidencial e confirmação de segurança.
                    </p>

                    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#000', marginBottom: 6 }}>
                      NÚMERO DE CELULAR (COM DDD)
                    </label>
                    <input
                      type="text"
                      value={phoneInput}
                      onChange={e => setPhoneInput(formatPhone(e.target.value))}
                      placeholder="(21) 97402-6883"
                      maxLength={15}
                      style={inputStyle}
                      autoFocus
                    />
                    {!isStep4Valid && cleanDigits(phoneInput).length > 0 && (
                      <span style={{ fontSize: 11, color: DANGER, marginTop: 4, display: 'block' }}>
                        Informe o DDD e os 9 dígitos do celular.
                      </span>
                    )}
                  </div>
                </Step>
              </Stepper>
            )}
          </div>
        )}

        {/* ═════════════════════════════════════════════════════════════════
            FASE 2: NENHUM PROCESSO ENCONTRADO
            ═════════════════════════════════════════════════════════════════ */}
        {hasSearched && notFound && (
          <section
            style={{
              width: '100%',
              maxWidth: 720,
              marginTop: 20,
              background: PAPER,
              borderTop: `1px solid ${BORDER}`,
              borderRight: `1px solid ${BORDER}`,
              borderBottom: `1px solid ${BORDER}`,
              borderLeft: '4px solid #4a5a6a',
              padding: '36px 40px',
              animation: 'bf-fadein 0.6s ease both',
              boxShadow: '0 12px 40px rgba(0,0,0,0.3)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 10
              }}
            >
              <h2 style={{ margin: 0, fontSize: 19, color: '#000', fontWeight: 600 }}>
                Nenhum processo localizado automaticamente
              </h2>
              {tribunaisConsultados.length > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    color: MUTED,
                    background: '#ebe5d8',
                    padding: '3px 8px',
                    letterSpacing: 0.5
                  }}
                >
                  Bases: {tribunaisConsultados.join(', ')}
                </span>
              )}
            </div>
            <p style={{ margin: '0 0 22px', fontSize: 14, color: MUTED, lineHeight: 1.7 }}>
              A consulta automática para o CPF {cpfInput} não retornou processos públicos ativos no tribunal consultado ({tribunaisConsultados.join(', ') || stateInput}).
              Isso não significa que não existam pendências, pois processos em segredo de justiça ou em outros estados exigem verificação especializada.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <button
                onClick={() => setInfoModalOpen(true)}
                style={{ ...primaryButtonStyle, padding: '13px 28px', fontWeight: 400, letterSpacing: 1 }}
              >
                PRECISO DE AUXÍLIO JURÍDICO
              </button>
              <div style={{ display: 'flex', gap: 16 }}>
                <button
                  type="button"
                  onClick={() => {
                    const demoData = buildCaseData();
                    setCaseData(demoData);
                    setNotFound(false);
                    setHasSearched(true);
                    void fetchAiSummary(demoData);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: BLUE,
                    fontSize: 12.5,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 4
                  }}
                >
                  Visualizar com dados demonstrativos (Modo Teste)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHasSearched(false);
                    setNotFound(false);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: MUTED,
                    fontSize: 12.5,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 4
                  }}
                >
                  Tentar outro CPF
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ═════════════════════════════════════════════════════════════════
            FASE 3: DASHBOARD SPLIT 70% / 30% (TRANSITION AUTOMÁTICA EM FADE)
            ═════════════════════════════════════════════════════════════════ */}
        {found && caseData && (
          <ProcessDashboardSplit
            fullName={fullName || 'Cliente'}
            cpf={cpfInput}
            phone={phoneInput}
            state={stateInput === 'AUTO' ? 'Multi-Tribunal Automático' : stateInput}
            processNumber={processNumberInput}
            caseData={caseData}
            tribunaisConsultados={tribunaisConsultados}
            aiSummary={aiSummary}
            aiSummaryLoading={aiSummaryLoading}
            onRefreshAiSummary={() => void fetchAiSummary(caseData)}
            onNewSearch={() => {
              setHasSearched(false);
              setNotFound(false);
              setCaseData(null);
              setAiSummary('');
            }}
            bitrixLeadId={bitrixLeadId}
            bitrixSimulated={bitrixSimulated}
          />
        )}
      </div>

      {/* ═════════════════════════════════════════════════════════════════
          MODAL DE AJUDA / FALAR COM A IA (+40% LARGURA E ALTURA)
          ═════════════════════════════════════════════════════════════════ */}
      {infoModalOpen && (
        <div
          onClick={() => setInfoModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(14,36,56,0.6)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            animation: 'bf-fadein 0.25s ease'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 735, // Aumentado em 40% (anterior: 525)
              maxWidth: '96vw',
              height: '86vh', // Aumentado em 40%
              maxHeight: 924, // Aumentado em 40% (anterior: 660)
              background: CREAM,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 70px rgba(0,0,0,0.45)',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                background: BLUE,
                color: CREAM_TEXT,
                padding: '24px 28px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <div style={{ fontSize: 15, letterSpacing: 1, fontWeight: 600 }}>ASSESSORIA JURÍDICA ESTRATÉGICA</div>
                <div style={{ fontSize: 11, color: BLUE_LIGHT, marginTop: 4 }}>Blindagem Financeira & Defesa Patrimonial</div>
              </div>
              <button
                onClick={() => setInfoModalOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: CREAM_TEXT,
                  fontSize: 24,
                  cursor: 'pointer',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: '#000', fontWeight: 600 }}>
                Como a Blindagem Financeira atua em processos e cobranças?
              </h3>
              <p style={{ margin: 0, fontSize: 14, color: TEXT, lineHeight: 1.8 }}>
                Mesmo quando um processo ainda não aparece nos registros públicos abertos do tribunal, ordens de penhora, execuções fiscais ou medidas de constrição de bens podem estar em trâmite sigiloso ou em vias de citação.
              </p>
              <div
                style={{
                  background: '#ffffff',
                  borderTop: `1px solid ${BORDER}`,
                  borderRight: `1px solid ${BORDER}`,
                  borderBottom: `1px solid ${BORDER}`,
                  borderLeft: `4px solid ${BLUE}`,
                  padding: '20px 24px'
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: '#000', marginBottom: 6 }}>
                  NOSSAS FRENTES DE ATUAÇÃO:
                </div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: MUTED, lineHeight: 1.8 }}>
                  <li>Defesa técnica e imediata em Execuções Fiscais e Títulos Extrajudiciais.</li>
                  <li>Desbloqueio de contas bancárias (Sisbajud / Bacenjud) e proteção de ativos.</li>
                  <li>Negociação estratégica de dívidas bancárias com redução substancial do passivo.</li>
                  <li>Blindagem patrimonial lícita de imóveis, veículos e investimentos familiares.</li>
                </ul>
              </div>
            </div>

            <div
              style={{
                padding: '20px 28px',
                background: '#ffffff',
                borderTop: `1px solid ${BORDER}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <button
                onClick={() => setInfoModalOpen(false)}
                style={{ background: 'transparent', border: `1px solid ${BORDER}`, padding: '10px 20px', fontSize: 12, cursor: 'pointer' }}
              >
                FECHAR
              </button>
              <button
                onClick={() => {
                  setInfoModalOpen(false);
                  openChat();
                }}
                style={{ ...primaryButtonStyle, padding: '11px 24px', fontSize: 12 }}
              >
                INICIAR CHAT DE TRIAGEM
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════
          MODAL DO CHAT DE TRIAGEM COM IA (+40% LARGURA E ALTURA)
          ═════════════════════════════════════════════════════════════════ */}
      <div
        onClick={() => setChatOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,36,56,0.6)',
          zIndex: 70,
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
            width: 735, // Aumentado em 40% (anterior: 525)
            maxWidth: '96vw',
            height: '86vh', // Aumentado em 40%
            maxHeight: 924, // Aumentado em 40% (anterior: 660)
            background: CREAM,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 25px 70px rgba(0,0,0,0.45)',
            transform: chatOpen ? 'scale(1)' : 'scale(0.95)',
            transition: 'transform 0.3s ease',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              background: BLUE,
              color: CREAM_TEXT,
              padding: '22px 28px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <div>
              <div style={{ fontSize: 14.5, letterSpacing: 1, fontWeight: 600 }}>ASSISTENTE JURÍDICO IA</div>
              <div style={{ fontSize: 11, color: BLUE_LIGHT, marginTop: 3 }}>Blindagem Financeira</div>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: CREAM_TEXT,
                fontSize: 24,
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
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 14
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
                    padding: '13px 18px',
                    fontSize: 14,
                    lineHeight: 1.65,
                    borderRadius: 4,
                    background: msg.role === 'user' ? BLUE : PAPER,
                    color: msg.role === 'user' ? '#fff' : TEXT,
                    border: msg.role === 'user' ? 'none' : `1px solid ${BORDER}`,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
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
                    padding: '12px 18px',
                    fontSize: 13,
                    color: MUTED,
                    background: '#ffffff',
                    border: `1px solid ${BORDER}`,
                    animation: 'bf-blink 1.4s ease-in-out infinite'
                  }}
                >
                  Analisando contexto...
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              padding: '16px 20px',
              borderTop: `1px solid ${BORDER}`,
              background: '#ffffff',
              display: 'flex',
              gap: 10
            }}
          >
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void sendChatMessage()}
              placeholder="Descreva sua dúvida, número do processo ou situação..."
              style={{ ...inputStyle, flex: 1, fontSize: 13.5, padding: '12px 16px' }}
            />
            <button
              onClick={() => void sendChatMessage()}
              style={{
                background: BLUE,
                color: CREAM_TEXT,
                border: 'none',
                padding: '12px 22px',
                fontSize: 12,
                letterSpacing: 1,
                fontWeight: 600,
                cursor: 'pointer'
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

/* ── Estilos reutilizados ─────────────────────────────────────────────── */
const inputStyle: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 15,
  padding: '13px 16px',
  border: `1px solid ${INPUT_BORDER}`,
  background: INPUT_BG,
  color: TEXT,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box'
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
