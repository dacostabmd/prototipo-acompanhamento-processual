'use client';

import { authFetch } from '@/lib/authFetch';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { SegmentedControl, Switch, Checkbox, Tooltip } from '@mantine/core';
import { Lock, Check, X, Info, XCircle, Scale } from 'lucide-react';
import Stepper, { Step } from './Stepper';
import ProcessResultView from './ProcessResultView';
import {
  buildCaseData,
  buildCaseDataFromProcesses,
  type CaseData,
  type LegalProcess
} from '@/lib/mockProcesses';
import {
  cleanDigits,
  formatCpf,
  formatDocumento,
  formatPhone,
  isValidCpf,
  isValidCnpj,
  formatChatMessageHtml,
  formatProcessNumber,
  parseCnj
} from '@/lib/format';
import { useDevPagante } from '@/lib/devPagante';
import { extractDdd, prioritizeByDdd } from '@/lib/ddd';
import { useSharedProfile } from '@/components/ProfileProvider';
import { getAvgMs, recordSample } from '@/lib/tribunalTiming';
import { custoServico, custoTotal } from '@/lib/infosimplesPricing';

/* ── Design tokens (tema dark/glass) ─────────────────────────────────── */
const BLUE = '#5f5f5f';
const BLUE_DARK = '#3d3d3d';
const BLUE_LIGHT = '#bdbdbb';
const PAPER = 'rgba(255,255,255,0.05)';
const CREAM = 'rgba(255,255,255,0.06)';
const CREAM_TEXT = '#fefefa';
const BORDER = 'rgba(255,255,255,0.12)';
const INPUT_BORDER = 'rgba(255,255,255,0.18)';
const INPUT_BG = 'rgba(15,15,15,0.65)';
const TEXT = '#f5f6fa';
const MUTED = 'rgba(226,229,245,0.65)';
const DANGER = '#e08a8a';
const WHATSAPP = '#25603f';


export interface ProcessTrackerProps {
  aiModel?: 'claude-haiku-4-5' | 'claude-sonnet-4-5';
  chatTone?: 'Acolhedor' | 'Formal';
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type ScanStatus = 'pending' | 'loading' | 'found' | 'not-found' | 'cancelled';
type ScanItem = { label: string; status: ScanStatus; startedAt?: number; elapsedMs?: number };

const MOSS_GREEN = '#3d6b4f';
const RUBY_RED = '#9b2c3f';

// Espelha a lógica multi-tribunal do backend (app/api/processos/route.ts) para exibir o progresso real
// da varredura e o custo estimado (services usados em lib/infosimplesPricing.ts para o cálculo).
const ALL_TRIBUNAIS: { service: string; label: string }[] = [
  { service: 'tribunal/tjsp/primeiro-grau', label: 'TJSP' },
  { service: 'tribunal/tjsp/eproc-lista', label: 'TJSP (eproc)' },
  { service: 'tribunal/tjrj/processo-eproc', label: 'TJRJ' },
  { service: 'tribunal/tjmg/processo', label: 'TJMG' },
  { service: 'tribunal/tjpr/processo', label: 'TJPR' },
  { service: 'tribunal/tjba/primeiro-grau', label: 'TJBA' },
  { service: 'tribunal/tjrs/primeiro-grau', label: 'TJRS' },
  { service: 'tribunal/tjsc/processo', label: 'TJSC' },
  { service: 'tribunal/trf1/processo', label: 'TRF1' },
  { service: 'tribunal/trf2/processo', label: 'TRF2' },
  { service: 'tribunal/trf2/processo-eproc', label: 'TRF2 (eproc)' },
  { service: 'tribunal/trf3/consulta-publica', label: 'TRF3' },
  { service: 'tribunal/trf5/processo', label: 'TRF5' },
  { service: 'tribunal/trf6/processo', label: 'TRF6' }
];
const ALL_TRIBUNAL_LABELS = ALL_TRIBUNAIS.map(t => t.label);
const SERVICE_BY_LABEL = new Map(ALL_TRIBUNAIS.map(t => [t.label, t.service]));

/** Custo estimado (R$) de consultar os tribunais dados pelos labels (ou todos, se null/vazio). */
function custoEstimadoLabels(labels: string[] | null): number {
  const targets = !labels || labels.length === 0 ? ALL_TRIBUNAL_LABELS : labels;
  return custoTotal(targets.map(l => SERVICE_BY_LABEL.get(l) ?? '').filter(Boolean));
}

function getTargetTribunals(ddd: number, tribunaisFiltro: string[] | null): string[] {
  const base = prioritizeByDdd(ALL_TRIBUNAIS, ddd).map(t => t.label);
  if (!tribunaisFiltro || tribunaisFiltro.length === 0) return base;
  return base.filter(label => tribunaisFiltro.includes(label));
}

export default function ProcessTracker({
  aiModel = 'claude-haiku-4-5',
  chatTone = 'Acolhedor'
}: ProcessTrackerProps) {
  const isPagante = useDevPagante();
  const { profile } = useSharedProfile();
  const isConsultante = profile.role === 'cliente';

  // Passo 1 · Como buscar
  const [fullName, setFullName] = useState('');
  const [searchMode, setSearchMode] = useState<'cpf' | 'numero' | 'nome'>('cpf');
  const [cpfInput, setCpfInput] = useState('');
  const [processNumberInput, setProcessNumberInput] = useState('');
  const [partyNameInput, setPartyNameInput] = useState('');
  const [stateInput] = useState('AUTO');

  // Consultante: documento fixo do próprio perfil, pré-preenchido e travado.
  useEffect(() => {
    if (isConsultante && profile.documento) {
      setCpfInput(formatDocumento(profile.documento));
      setFullName(prev => prev || profile.nome);
    }
  }, [isConsultante, profile.documento, profile.nome]);

  // Passo 2 · Onde procurar
  const [buscarTodosTribunais, setBuscarTodosTribunais] = useState(true);
  const [tribunaisSelecionados, setTribunaisSelecionados] = useState<string[]>([]);

  // Passo 3 · Avisos
  const [avisarNovidades, setAvisarNovidades] = useState(false);
  const [canalEmail, setCanalEmail] = useState(true);
  const [canalWhatsapp, setCanalWhatsapp] = useState(false);
  const [resumoSimples, setResumoSimples] = useState(false);

  // Passo 4 · Revisar e consultar
  const [phoneInput, setPhoneInput] = useState('');
  const [formError, setFormError] = useState('');

  // Search & Result states
  const [currentStepIndex, setCurrentStepIndex] = useState(1);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [tribunaisConsultados, setTribunaisConsultados] = useState<string[]>([]);
  const [custoEstimado, setCustoEstimado] = useState<number>(0);
  const [scanItems, setScanItems] = useState<ScanItem[]>([]);
  const [scanClockTick, setScanClockTick] = useState(0);
  // Id da consulta em andamento (recebido no evento 'started' do streaming), usado para cancelar
  // um tribunal específico via POST /api/processos/cancelar sem afetar os demais.
  const consultaIdRef = useRef<string | null>(null);
  const [cancelingLabels, setCancelingLabels] = useState<Set<string>>(new Set());

  // Atualiza o cronômetro/% estimado de cada card de tribunal enquanto a varredura está em curso.
  useEffect(() => {
    if (!searching) return;
    const id = window.setInterval(() => setScanClockTick(t => t + 1), 150);
    return () => window.clearInterval(id);
  }, [searching]);

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

  const detectedTribunal = useMemo(() => {
    return searchMode === 'numero' ? parseCnj(processNumberInput) : null;
  }, [searchMode, processNumberInput]);

  // Validações por passo do novo Stepper: 1·Como buscar 2·Onde procurar 3·Avisos 4·Revisar e consultar
  const cpfInputDigits = cleanDigits(cpfInput);
  const isCpfValid =
    isConsultante && profile.documentoTipo === 'cnpj'
      ? cpfInputDigits.length === 14 && isValidCnpj(cpfInputDigits)
      : cpfInputDigits.length === 11 && isValidCpf(cpfInputDigits);
  const isProcessNumberValid = cleanDigits(processNumberInput).length === 20;

  // Ao buscar por número de processo, o CNJ (20 dígitos) é o dado principal e Nome/CPF tornam-se opcionais.
  const isStep1Valid =
    searchMode === 'numero'
      ? isProcessNumberValid && (cpfInputDigits.length === 0 || isCpfValid)
      : fullName.trim().length >= 3 &&
        isCpfValid &&
        (searchMode !== 'nome' || (isPagante && partyNameInput.trim().length >= 3));
  const isStep2Valid = true;
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

  // Dispara Confete com a paleta nobre estendida (Grey Olive, Charcoal, Gunmetal, Dourado e Porcelain)
  const triggerConfetti = () => {
    const colors = [
      '#999999',
      '#5f5f5f',
      '#3d3d3d',
      '#bdbdbb',
      '#c5a059',
      '#d4af37',
      '#e8cca4',
      '#fefefa'
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

    // A Infosimples só consulta por CPF hoje (ver app/api/processos/route.ts); consultante PJ
    // ainda não tem cobertura real de busca — gap registrado no roadmap.
    if (isConsultante && profile.documentoTipo === 'cnpj') {
      setFormError('Consulta por CNPJ ainda não está disponível. Em breve habilitaremos a busca para consultantes PJ.');
      return;
    }

    setFormError('');
    setSearching(true);
    setHasSearched(false);

    // O backend transmite o progresso em streaming (NDJSON).
    // Quando a busca for por número CNJ, direciona o scan para o tribunal específico do processo.
    const isBuscaNumero = searchMode === 'numero';
    const cnjParsed = isBuscaNumero ? parseCnj(processNumberInput) : null;
    const targets =
      isBuscaNumero && cnjParsed?.valido
        ? ['DataJud (CNJ)', cnjParsed.tribunalLabel]
        : getTargetTribunals(extractDdd(phoneDigits), buscarTodosTribunais ? null : tribunaisSelecionados);
    const scanStartedAt = Date.now();
    setScanItems(targets.map(label => ({ label, status: 'loading', startedAt: scanStartedAt })));
    consultaIdRef.current = null;
    setCancelingLabels(new Set());

    try {
      // 1. Busca processual (direta por CNJ ou multi-tribunal por CPF)
      const res = await authFetch('/api/processos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: digits,
          fullName: fullName.trim() || (isBuscaNumero ? 'Consulta por Número' : ''),
          phone: phoneDigits,
          state: stateInput,
          processNumber: isBuscaNumero ? processNumberInput : '',
          tribunaisSelecionados: buscarTodosTribunais ? null : tribunaisSelecionados,
          avisarMovimentacao: avisarNovidades,
          canalAviso: !avisarNovidades ? 'nenhum' : canalEmail && canalWhatsapp ? 'ambos' : canalEmail ? 'email' : canalWhatsapp ? 'whatsapp' : 'nenhum',
          resumoLinguagemSimples: resumoSimples
        })
      });

      if (!res.ok) {
        let errMsg = 'Falha ao consultar processos.';
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch {
          errMsg = `Erro na resposta do servidor (${res.status}).`;
        }
        throw new Error(errMsg);
      }

      if (!res.body) {
        throw new Error('Resposta do servidor sem corpo de dados.');
      }

      // Lê o NDJSON incrementalmente: uma linha "progress" por tribunal + uma linha "done" final.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let data: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;

          const evt = JSON.parse(line);
          if (evt.type === 'started') {
            consultaIdRef.current = evt.consultaId;
          } else if (evt.type === 'progress') {
            setScanItems(prev =>
              prev.map(item => {
                if (item.label !== evt.label) return item;
                const elapsedMs = item.startedAt ? Date.now() - item.startedAt : undefined;
                // Tribunal cancelado pelo usuário não entra na média histórica (não é um tempo real de resposta).
                if (elapsedMs && !evt.cancelado) recordSample(item.label, elapsedMs);
                return { ...item, status: evt.cancelado ? 'cancelled' : evt.found ? 'found' : 'not-found', elapsedMs };
              })
            );
          } else if (evt.type === 'done') {
            data = evt;
          }
        }
      }

      if (!data) {
        throw new Error('Falha ao processar resposta do servidor.');
      }

      setTribunaisConsultados(data.tribunaisConsultados || []);
      setCustoEstimado(typeof data.custoEstimado === 'number' ? data.custoEstimado : 0);
      await new Promise(r => setTimeout(r, 400));

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
        const bitrixRes = await authFetch('/api/bitrix/lead', {
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
        const bitrixData = await bitrixRes.json().catch(() => ({}));
        if (bitrixData && bitrixData.leadId) setBitrixLeadId(bitrixData.leadId);
        if (bitrixData && bitrixData.simulated) setBitrixSimulated(true);
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

  // Cancela a consulta de um tribunal específico em andamento (card individual na tela de
  // varredura), sem afetar os demais — usa o consultaId recebido no evento 'started' do streaming.
  const handleCancelarTribunal = async (label: string) => {
    const consultaId = consultaIdRef.current;
    if (!consultaId) return;
    setCancelingLabels(prev => new Set(prev).add(label));
    try {
      await authFetch('/api/processos/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consultaId, label })
      });
    } catch (err) {
      console.error('[ProcessTracker cancelar tribunal error]', err);
    } finally {
      setCancelingLabels(prev => {
        const next = new Set(prev);
        next.delete(label);
        return next;
      });
    }
  };

  // Geração de Resumo com IA
  const fetchAiSummary = async (casesToSummarize: CaseData) => {
    setAiSummaryLoading(true);
    setAiSummaryError('');
    const startTime = Date.now();
    try {
      const res = await authFetch('/api/ai/summary', {
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
      const summaryData = await res.json().catch(() => ({}));
      const text = summaryData.text || '';

      // Garante tempo mínimo de ~3.2s para exibição completa das 4 etapas discriminadas
      const elapsed = Date.now() - startTime;
      if (elapsed < 3200) {
        await new Promise(r => setTimeout(r, 3200 - elapsed));
      }

      setAiSummary(text);
      // Dispara o confetti exatamente quando o resultado da análise é finalizado e exibido
      triggerConfetti();
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
      const res = await authFetch('/api/ai/chat', {
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
        position: 'relative',
        minHeight: '100vh',
        color: TEXT,
        fontFamily: 'var(--font-inter), sans-serif'
      }}
    >
      {/* Container principal */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          padding: 'clamp(20px, 4vw, 48px) clamp(16px, 3vw, 36px)',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          boxSizing: 'border-box'
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
                <h3 style={{ margin: '0 0 8px', fontSize: 18, color: TEXT, fontWeight: 600 }}>
                  {searchMode === 'numero' ? 'Realizando nossa pesquisa...' : 'Varrendo bases judiciais...'}
                </h3>
                <p style={{ margin: '0 0 20px', fontSize: 13.5, color: MUTED }}>
                  {searchMode === 'numero'
                    ? 'Cruzamos a API pública do CNJ (DataJud) com a base do tribunal de origem do processo ao mesmo tempo, para trazer o resultado mais completo possível.'
                    : `Consultamos os ${scanItems.length || 14} tribunais abaixo ao mesmo tempo. O % de cada barra é uma
                  estimativa com base no tempo médio histórico daquele tribunal neste navegador; a barra completa
                  quando a resposta real chega — tribunais com sistemas mais lentos (eproc/legado) podem demorar mais.`}
                </p>

                {searchMode === 'numero' ? (
                  (() => {
                    const doneCount = scanItems.filter(i => i.status === 'found' || i.status === 'not-found' || i.status === 'cancelled').length;
                    const totalCount = scanItems.length || 1;
                    const algumEncontrado = scanItems.some(i => i.status === 'found');
                    const todasConcluidas = doneCount === totalCount;
                    const dataJudItem = scanItems.find(i => i.label === 'DataJud (CNJ)');
                    const tribunalItem = scanItems.find(i => i.label !== 'DataJud (CNJ)');
                    const dataJudPendente = dataJudItem && (dataJudItem.status === 'pending' || dataJudItem.status === 'loading');
                    const tribunalPendente = tribunalItem && (tribunalItem.status === 'pending' || tribunalItem.status === 'loading');

                    // % estimado pela média dos dois itens em andamento (mesma mecânica de tempo médio
                    // histórico usada no grid multi-tribunal, via lib/tribunalTiming.ts) — garante que a
                    // barra avance de forma visível mesmo com as duas fontes ainda em "loading".
                    const pct = todasConcluidas
                      ? 100
                      : Math.min(
                          96,
                          Math.round(
                            (scanItems.reduce((sum, item) => {
                              if (item.status !== 'loading' || !item.startedAt) return sum + (item.status === 'pending' ? 0 : 100);
                              const liveElapsedMs = Date.now() - item.startedAt;
                              const avgMs = getAvgMs(item.label);
                              return sum + Math.min(96, (liveElapsedMs / avgMs) * 100);
                            }, 0) /
                              totalCount)
                          )
                        );

                    const statusLabel = todasConcluidas
                      ? algumEncontrado
                        ? 'Processo localizado — consolidando os dados...'
                        : 'Nenhuma das duas fontes localizou o processo...'
                      : dataJudPendente && tribunalPendente
                      ? `Consultando a base pública do CNJ (DataJud) e o ${tribunalItem?.label || 'tribunal'} em paralelo...`
                      : dataJudPendente
                      ? 'Consultando a base pública do CNJ (DataJud)...'
                      : tribunalPendente
                      ? `Aguardando resposta do ${tribunalItem?.label}...`
                      : 'Consolidando os dados encontrados...';

                    return (
                      <div style={{ maxWidth: 420, margin: '0 auto' }}>
                        <div
                          style={{
                            height: 6,
                            borderRadius: 3,
                            background: 'rgba(255,255,255,0.08)',
                            overflow: 'hidden'
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${pct}%`,
                              background: todasConcluidas ? (algumEncontrado ? MOSS_GREEN : RUBY_RED) : BLUE,
                              borderRadius: 3,
                              transition: 'width 0.4s ease'
                            }}
                          />
                        </div>
                        <div style={{ marginTop: 10, fontSize: 12.5, color: MUTED, lineHeight: 1.4 }}>
                          {statusLabel} {!todasConcluidas && `(${pct}%)`}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <>
                {(() => {
                  const doneCount = scanItems.filter(i => i.status === 'found' || i.status === 'not-found' || i.status === 'cancelled').length;
                  const totalCount = scanItems.length || 1;
                  const pct = Math.round((doneCount / totalCount) * 100);
                  return (
                    <div style={{ maxWidth: 560, margin: '0 auto 24px' }}>
                      <div
                        style={{
                          height: 6,
                          borderRadius: 3,
                          background: 'rgba(255,255,255,0.08)',
                          overflow: 'hidden'
                        }}
                      >
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
                        {doneCount}/{scanItems.length} tribunais consultados
                      </div>
                    </div>
                  );
                })()}

                {scanItems.length > 0 && (
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
                    {scanItems.map(item => {
                      // % estimado com base no tempo médio histórico daquele tribunal (localStorage,
                      // ver lib/tribunalTiming.ts) — não é progresso real (a chamada é atômica),
                      // é uma estimativa que se refina a cada consulta feita no navegador.
                      const liveElapsedMs =
                        item.status === 'loading' && item.startedAt ? Date.now() - item.startedAt : item.elapsedMs ?? 0;
                      const avgMs = getAvgMs(item.label);
                      const isOverdue = item.status === 'loading' && liveElapsedMs > avgMs;
                      const estimatedPct =
                        item.status === 'found' || item.status === 'not-found'
                          ? 100
                          : item.status === 'loading'
                          ? Math.min(96, Math.round((liveElapsedMs / avgMs) * 100))
                          : 0;
                      const elapsedLabel = liveElapsedMs > 0 ? `${(liveElapsedMs / 1000).toFixed(1)}s` : null;

                      // Subtítulo explicando em que ponto a consulta está: qual etapa da chamada
                      // à Infosimples e, se passou do tempo médio histórico, um aviso de que o
                      // tribunal está demorando mais que o normal (em vez da barra parecer travada).
                      const stageLabel =
                        item.status === 'loading'
                          ? isOverdue
                            ? `Demorando mais que o normal (média ${(avgMs / 1000).toFixed(1)}s) — sistema pode estar lento`
                            : liveElapsedMs < 400
                            ? 'Enviando requisição à Infosimples...'
                            : 'Aguardando resposta do tribunal...'
                          : null;

                      return (
                        <div
                          key={item.label}
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
                            <span
                              aria-hidden="true"
                              style={{
                                display: 'inline-flex',
                                width: 16,
                                height: 16,
                                flex: 'none',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                            >
                              {item.status === 'pending' && (
                                <span
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    background: INPUT_BORDER
                                  }}
                                />
                              )}
                              {item.status === 'found' && (
                                <Check size={16} strokeWidth={2.5} style={{ color: MOSS_GREEN }} />
                              )}
                              {(item.status === 'not-found' || item.status === 'cancelled') && (
                                <X size={16} strokeWidth={2.5} style={{ color: RUBY_RED }} />
                              )}
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
                                marginLeft: item.status === 'loading' ? undefined : 'auto',
                                fontSize: 11,
                                fontWeight: 600,
                                flexShrink: 0,
                                textAlign: 'right',
                                color:
                                  item.status === 'found'
                                    ? MOSS_GREEN
                                    : item.status === 'not-found' || item.status === 'cancelled'
                                    ? RUBY_RED
                                    : MUTED
                              }}
                            >
                              {item.status === 'pending' && 'Aguardando'}
                              {item.status === 'loading' && `${estimatedPct}% · ${elapsedLabel}`}
                              {item.status === 'found' && `Encontrado · ${elapsedLabel}`}
                              {item.status === 'not-found' && `Sem processos · ${elapsedLabel}`}
                              {item.status === 'cancelled' && 'Cancelado'}
                            </span>
                            {item.status === 'loading' && (
                              <button
                                type="button"
                                onClick={() => handleCancelarTribunal(item.label)}
                                disabled={cancelingLabels.has(item.label)}
                                title={`Cancelar consulta a ${item.label}`}
                                aria-label={`Cancelar consulta a ${item.label}`}
                                style={{
                                  marginLeft: 'auto',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: 'transparent',
                                  border: 'none',
                                  padding: 2,
                                  cursor: cancelingLabels.has(item.label) ? 'default' : 'pointer',
                                  opacity: cancelingLabels.has(item.label) ? 0.4 : 0.7,
                                  color: MUTED,
                                  flexShrink: 0
                                }}
                              >
                                <XCircle size={14} strokeWidth={2} />
                              </button>
                            )}
                          </div>

                          <div
                            style={{
                              height: 4,
                              borderRadius: 2,
                              background: 'rgba(255,255,255,0.08)',
                              overflow: 'hidden',
                              position: 'relative'
                            }}
                          >
                            {item.status === 'pending' && <div style={{ height: '100%', width: 0 }} />}
                            {item.status === 'loading' && (
                              <div
                                style={{
                                  height: '100%',
                                  width: `${estimatedPct}%`,
                                  background: BLUE,
                                  borderRadius: 2,
                                  transition: 'width 0.15s linear',
                                  animation: isOverdue ? 'bf-blink 1s ease-in-out infinite' : undefined
                                }}
                              />
                            )}
                            {(item.status === 'found' || item.status === 'not-found' || item.status === 'cancelled') && (
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

                          {stageLabel && (
                            <div style={{ fontSize: 10.5, color: isOverdue ? '#d4a65f' : MUTED, lineHeight: 1.3 }}>
                              {stageLabel}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                  </>
                )}
              </div>
            ) : (
              <Stepper
                initialStep={1}
                goToStep={currentStepIndex}
                onStepChange={step => setCurrentStepIndex(step)}
                onFinalStepCompleted={handleFinalStepCompleted}
                canAdvance={canAdvanceCurrentStep}
                backButtonText="VOLTAR"
                nextButtonText={currentStepIndex === 4 ? 'CONSULTAR AGORA' : 'CONTINUAR'}
              >
                {/* ── PASSO 1: COMO BUSCAR ── */}
                <Step>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: BLUE_LIGHT, fontWeight: 700, marginBottom: 4 }}>
                      PASSO 1 DE 4 · COMO BUSCAR
                    </div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 18, color: TEXT, fontWeight: 600 }}>
                      Como você quer buscar?
                    </h2>
                    <p style={{ margin: '0 0 18px', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                      {isConsultante
                        ? 'Você consulta apenas os processos ligados ao seu próprio CPF/CNPJ cadastrado.'
                        : 'Escolha o dado que você tem em mãos para localizar o processo.'}
                    </p>

                    {!isConsultante && (
                      <SegmentedControl
                        fullWidth
                        value={searchMode}
                        onChange={v => setSearchMode(v as 'cpf' | 'numero' | 'nome')}
                        data={[
                          { label: 'CPF', value: 'cpf' },
                          { label: 'Nº do processo', value: 'numero' },
                          {
                            label: (
                              <Tooltip label={isPagante ? 'Buscar pelo nome da parte' : 'Disponível para assinantes'} withArrow>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  Nome da parte {!isPagante && <Lock size={12} strokeWidth={2.5} style={{ opacity: 0.85 }} />}
                                </span>
                              </Tooltip>
                            ) as unknown as string,
                            value: 'nome',
                            disabled: !isPagante
                          }
                        ]}
                        mb={18}
                      />
                    )}

                    {!isConsultante && searchMode === 'numero' && (
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: TEXT, marginBottom: 6 }}>
                          NÚMERO DO PROCESSO (CNJ)
                        </label>
                        <input
                          type="text"
                          value={processNumberInput}
                          onChange={e => setProcessNumberInput(formatProcessNumber(e.target.value))}
                          placeholder="0000000-00.0000.0.00.0000"
                          style={inputStyle}
                          maxLength={25}
                          autoFocus
                        />
                        {detectedTribunal && (
                          <div style={{ marginTop: 6, fontSize: 11.5, color: '#a9c3ef', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Scale size={13} />
                            <span>
                              Tribunal identificado: <strong style={{ color: TEXT }}>{detectedTribunal.tribunalLabel}</strong> ({detectedTribunal.tribunalNome})
                            </span>
                          </div>
                        )}
                        {cleanDigits(processNumberInput).length > 0 && cleanDigits(processNumberInput).length < 20 && (
                          <span style={{ fontSize: 11, color: DANGER, marginTop: 4, display: 'block' }}>
                            O número CNJ deve conter 20 dígitos numéricos ({cleanDigits(processNumberInput).length}/20).
                          </span>
                        )}
                      </div>
                    )}

                    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: TEXT, marginBottom: 6 }}>
                      {searchMode === 'numero' && !isConsultante ? 'NOME COMPLETO (OPCIONAL)' : 'NOME COMPLETO'}
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      placeholder={
                        searchMode === 'numero' && !isConsultante
                          ? 'Nome do titular ou da parte (opcional)'
                          : 'Nome completo exatamente como consta no documento ou processo'
                      }
                      style={{ ...inputStyle, marginBottom: 16 }}
                      autoFocus={!isConsultante && searchMode !== 'numero'}
                    />

                    <label style={{ display: 'flex', alignItems: 'center', fontSize: 11.5, fontWeight: 600, color: TEXT, marginBottom: 6 }}>
                      {isConsultante
                        ? 'SEU CPF/CNPJ'
                        : searchMode === 'numero' || searchMode === 'nome'
                        ? 'CPF DO TITULAR (OPCIONAL)'
                        : 'CPF DO TITULAR'}
                      <Tooltip
                        label={
                          isConsultante
                            ? 'CPF/CNPJ fixo, definido no cadastro e travado para consultantes'
                            : searchMode === 'numero'
                            ? 'Opcional na busca por processo CNJ'
                            : searchMode === 'nome'
                            ? 'Opcional, mas ajuda a evitar resultados de homônimos'
                            : 'Sempre usamos o processo pelo CPF ligado a ele'
                        }
                        withArrow
                      >
                        <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', color: MUTED, cursor: 'help' }}>
                          {isConsultante ? <Lock size={13} strokeWidth={2.2} /> : <Info size={14} />}
                        </span>
                      </Tooltip>
                    </label>
                    <input
                      type="text"
                      value={cpfInput}
                      onChange={e => setCpfInput(formatDocumento(e.target.value))}
                      placeholder={
                        (searchMode === 'numero' || searchMode === 'nome') && !isConsultante
                          ? '000.000.000-00 (opcional)'
                          : '000.000.000-00'
                      }
                      maxLength={18}
                      style={inputStyle}
                      disabled={isConsultante}
                    />
                    {!isCpfValid && cpfInputDigits.length >= 11 && (
                      <span style={{ fontSize: 11, color: DANGER, marginTop: 4, display: 'block' }}>
                        Dígito verificador do documento inválido. Verifique os números.
                      </span>
                    )}

                    {searchMode === 'nome' && isPagante && (
                      <div style={{ marginTop: 16 }}>
                        <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: TEXT, marginBottom: 6 }}>
                          NOME DA PARTE
                        </label>
                        <input
                          type="text"
                          value={partyNameInput}
                          onChange={e => setPartyNameInput(e.target.value)}
                          placeholder="Nome da parte envolvida no processo"
                          style={inputStyle}
                        />
                      </div>
                    )}
                  </div>
                </Step>

                {/* ── PASSO 2: ONDE PROCURAR ── */}
                <Step>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: BLUE_LIGHT, fontWeight: 700, marginBottom: 4 }}>
                      PASSO 2 DE 4 · ONDE PROCURAR
                    </div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 18, color: TEXT, fontWeight: 600 }}>
                      Onde procurar?
                    </h2>
                    <p style={{ margin: '0 0 18px', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                      {searchMode === 'numero' && detectedTribunal?.valido
                        ? 'Tribunal de origem identificado a partir do número CNJ.'
                        : 'Recomendamos todos, para não perder nada.'}
                    </p>

                    {searchMode === 'numero' && detectedTribunal?.valido && (
                      <div
                        style={{
                          padding: '14px 16px',
                          borderRadius: 4,
                          border: `1px solid ${BLUE}`,
                          background: 'rgba(36,85,184,0.15)',
                          marginBottom: 14
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 13.5, color: TEXT, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Scale size={14} color={BLUE_LIGHT} />
                            {detectedTribunal.tribunalLabel} — {detectedTribunal.tribunalNome}
                          </span>
                          <span style={{ fontSize: 12, color: BLUE_LIGHT, fontWeight: 600 }}>Gratuito (DataJud CNJ)</span>
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
                          A consulta será direcionada diretamente a este tribunal.
                        </p>
                      </div>
                    )}

                    <div
                      onClick={() => setBuscarTodosTribunais(true)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 16px',
                        borderRadius: 4,
                        border: `1px solid ${buscarTodosTribunais ? BLUE : INPUT_BORDER}`,
                        background: buscarTodosTribunais ? 'rgba(36,85,184,0.15)' : 'transparent',
                        cursor: 'pointer',
                        marginBottom: 10
                      }}
                    >
                      <span style={{ fontSize: 13.5, color: TEXT, fontWeight: 600 }}>
                        Todos os tribunais <span style={{ color: MUTED, fontWeight: 400 }}>(recomendado — 14 fontes)</span>
                      </span>
                      <span style={{ fontSize: 12, color: MUTED }}>
                        {searchMode === 'numero' ? 'Gratuito (CNJ)' : `R$ ${custoEstimadoLabels(null).toFixed(2).replace('.', ',')}`}
                      </span>
                    </div>

                    <div
                      onClick={() => setBuscarTodosTribunais(false)}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 4,
                        border: `1px solid ${!buscarTodosTribunais ? BLUE : INPUT_BORDER}`,
                        background: !buscarTodosTribunais ? 'rgba(36,85,184,0.15)' : 'transparent',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13.5, color: TEXT, fontWeight: 600 }}>Escolher tribunais</span>
                        <span style={{ fontSize: 12, color: MUTED }}>
                          a partir de R$ {Math.min(...ALL_TRIBUNAIS.map(t => custoServico(t.service))).toFixed(2).replace('.', ',')}
                        </span>
                      </div>
                      {!buscarTodosTribunais && (
                        <div
                          style={{
                            marginTop: 12,
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                            gap: 8
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          {ALL_TRIBUNAIS.map(({ label, service }) => (
                            <Checkbox
                              key={label}
                              label={
                                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                                  <span>{label}</span>
                                  <span style={{ color: MUTED, fontWeight: 400 }}>
                                    R$ {custoServico(service).toFixed(2).replace('.', ',')}
                                  </span>
                                </span>
                              }
                              size="xs"
                              checked={tribunaisSelecionados.includes(label)}
                              onChange={e =>
                                setTribunaisSelecionados(prev =>
                                  e.target.checked ? [...prev, label] : prev.filter(l => l !== label)
                                )
                              }
                              styles={{ label: { color: TEXT, fontSize: 12, flex: 1 }, body: { alignItems: 'center' } }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Step>

                {/* ── PASSO 3: AVISOS ── */}
                <Step>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: BLUE_LIGHT, fontWeight: 700, marginBottom: 4 }}>
                      PASSO 3 DE 4 · AVISOS
                    </div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 18, color: TEXT, fontWeight: 600 }}>
                      Quer ser avisado das novidades?
                    </h2>
                    <p style={{ margin: '0 0 18px', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                      Você pode mudar isso depois.
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <span style={{ display: 'flex', alignItems: 'center', fontSize: 13.5, color: TEXT, gap: 6 }}>
                        Avisar quando o processo andar
                        <Tooltip label="Monitoramento contínuo — recurso pago, ativado por processo" withArrow>
                          <span style={{ display: 'inline-flex', alignItems: 'center', color: MUTED, cursor: 'help' }}>
                            <Info size={14} />
                          </span>
                        </Tooltip>
                      </span>
                      <Switch checked={avisarNovidades} onChange={e => setAvisarNovidades(e.currentTarget.checked)} color="blue" />
                    </div>

                    {avisarNovidades && (
                      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                        <button
                          type="button"
                          onClick={() => setCanalEmail(v => !v)}
                          style={channelChipStyle(canalEmail)}
                        >
                          E-mail
                        </button>
                        <button
                          type="button"
                          onClick={() => setCanalWhatsapp(v => !v)}
                          style={channelChipStyle(canalWhatsapp)}
                        >
                          WhatsApp
                        </button>
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ display: 'flex', alignItems: 'center', fontSize: 13.5, color: TEXT, gap: 6 }}>
                        Resumo em palavras simples
                        <Tooltip label="Uma linguagem menos jurídica, mais direta ao ponto no resumo gerado por IA" withArrow>
                          <span style={{ display: 'inline-flex', alignItems: 'center', color: MUTED, cursor: 'help' }}>
                            <Info size={14} />
                          </span>
                        </Tooltip>
                      </span>
                      <Switch checked={resumoSimples} onChange={e => setResumoSimples(e.currentTarget.checked)} color="blue" />
                    </div>
                  </div>
                </Step>

                {/* ── PASSO 4: REVISAR E CONSULTAR ── */}
                <Step>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 1.5, color: BLUE_LIGHT, fontWeight: 700, marginBottom: 4 }}>
                      PASSO 4 DE 4 · REVISAR E CONSULTAR
                    </div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 18, color: TEXT, fontWeight: 600 }}>
                      Tudo certo?
                    </h2>
                    <p style={{ margin: '0 0 18px', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                      Confira antes de consultar.
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
                      <ReviewRow
                        label="Buscar por"
                        value={
                          searchMode === 'numero'
                            ? `Nº ${processNumberInput || '—'}${cpfInput ? ` · CPF ${cpfInput}` : ''}${fullName ? ` · ${fullName}` : ''}`
                            : `${isConsultante && profile.documentoTipo === 'cnpj' ? 'CNPJ' : 'CPF'} ${cpfInput || '—'}${
                                !isConsultante && searchMode === 'nome' ? ` · Nome ${partyNameInput || '—'}` : ''
                              }`
                        }
                        onEdit={() => setCurrentStepIndex(1)}
                      />
                      <ReviewRow
                        label="Onde"
                        value={
                          searchMode === 'numero' && detectedTribunal?.valido
                            ? `${detectedTribunal.tribunalLabel} (Direto via CNJ)`
                            : buscarTodosTribunais
                            ? 'Todos os tribunais (14 fontes)'
                            : `${tribunaisSelecionados.length || 0} tribunal(is) selecionado(s)`
                        }
                        onEdit={() => setCurrentStepIndex(2)}
                      />
                      <ReviewRow
                        label="Avisos"
                        value={
                          avisarNovidades
                            ? `Sim · ${[canalEmail && 'E-mail', canalWhatsapp && 'WhatsApp'].filter(Boolean).join(' + ') || 'nenhum canal'}${resumoSimples ? ' · Resumo simples' : ''}`
                            : 'Não avisar'
                        }
                        onEdit={() => setCurrentStepIndex(3)}
                      />
                    </div>

                    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: TEXT, marginBottom: 6 }}>
                      NÚMERO DE CELULAR (COM DDD)
                    </label>
                    <input
                      type="text"
                      value={phoneInput}
                      onChange={e => setPhoneInput(formatPhone(e.target.value))}
                      placeholder="(21) 97402-6883"
                      maxLength={15}
                      style={{ ...inputStyle, marginBottom: 16 }}
                    />
                    {!isStep4Valid && cleanDigits(phoneInput).length > 0 && (
                      <span style={{ fontSize: 11, color: DANGER, marginTop: -12, marginBottom: 16, display: 'block' }}>
                        Informe o DDD e os 9 dígitos do celular.
                      </span>
                    )}

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        borderRadius: 4,
                        border: `1px solid ${INPUT_BORDER}`,
                        background: 'rgba(255,255,255,0.04)'
                      }}
                    >
                      <span style={{ fontSize: 12.5, color: MUTED }}>CUSTO DESTA CONSULTA</span>
                      <span style={{ fontSize: 15, color: TEXT, fontWeight: 700 }}>
                        {searchMode === 'numero' ? (
                          <span style={{ color: '#8fb99a' }}>Gratuito (DataJud CNJ)</span>
                        ) : (
                          `R$ ${custoEstimadoLabels(buscarTodosTribunais ? null : tribunaisSelecionados)
                            .toFixed(2)
                            .replace('.', ',')}`
                        )}
                      </span>
                    </div>
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
              <h2 style={{ margin: 0, fontSize: 19, color: TEXT, fontWeight: 600 }}>
                Nenhum processo localizado automaticamente
              </h2>
              {tribunaisConsultados.length > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    color: MUTED,
                    background: 'rgba(255,255,255,0.08)',
                    padding: '3px 8px',
                    letterSpacing: 0.5
                  }}
                >
                  Bases: {tribunaisConsultados.join(', ')} · Custo estimado: R${' '}
                  {custoEstimado.toFixed(2).replace('.', ',')}
                </span>
              )}
            </div>
            <p style={{ margin: '0 0 22px', fontSize: 14, color: MUTED, lineHeight: 1.7 }}>
              A consulta automática para {searchMode === 'numero' ? `o processo ${processNumberInput || 'informado'}` : `o CPF ${cpfInput || 'informado'}`} não retornou processos públicos ativos no tribunal consultado ({tribunaisConsultados.join(', ') || stateInput}).
              Isso não significa que não existam pendências, pois processos em segredo de justiça ou em outros estados exigem verificação especializada.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <button
                onClick={() => setInfoModalOpen(true)}
                style={{ ...primaryButtonStyle, padding: '13px 28px', fontWeight: 400, letterSpacing: 1 }}
              >
                PRECISO DE AUXÍLIO JURÍDICO
              </button>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
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
                    background: 'rgba(255,255,255,0.08)',
                    border: `1px solid ${BORDER}`,
                    borderRadius: 4,
                    color: '#ffffff',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '8px 16px',
                    transition: 'all 0.2s'
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
                    background: 'transparent',
                    border: `1px solid ${BORDER}`,
                    borderRadius: 4,
                    color: BLUE_LIGHT,
                    fontSize: 12.5,
                    cursor: 'pointer',
                    padding: '8px 16px',
                    transition: 'all 0.2s'
                  }}
                >
                  {searchMode === 'numero' ? 'Tentar outro processo' : 'Tentar outro CPF'}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ═════════════════════════════════════════════════════════════════
            FASE 3: DASHBOARD SPLIT 70% / 30% (TRANSITION AUTOMÁTICA EM FADE)
            ═════════════════════════════════════════════════════════════════ */}
        {found && caseData && (
          <ProcessResultView
            fullName={fullName || 'Cliente'}
            cpf={cpfInput}
            phone={phoneInput}
            caseData={caseData}
            tribunaisConsultados={tribunaisConsultados}
            custoEstimado={custoEstimado}
            aiSummary={aiSummary}
            aiSummaryLoading={aiSummaryLoading}
            onRefreshAiSummary={() => void fetchAiSummary(caseData)}
            onNewSearch={() => {
              setHasSearched(false);
              setNotFound(false);
              setCaseData(null);
              setAiSummary('');
            }}
            aiModel={aiModel}
            chatTone={chatTone}
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
              <h3 style={{ margin: 0, fontSize: 18, color: TEXT, fontWeight: 600 }}>
                Como a Blindagem Financeira atua em processos e cobranças?
              </h3>
              <p style={{ margin: 0, fontSize: 14, color: TEXT, lineHeight: 1.8 }}>
                Mesmo quando um processo ainda não aparece nos registros públicos abertos do tribunal, ordens de penhora, execuções fiscais ou medidas de constrição de bens podem estar em trâmite sigiloso ou em vias de citação.
              </p>
              <div
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  borderTop: `1px solid ${BORDER}`,
                  borderRight: `1px solid ${BORDER}`,
                  borderBottom: `1px solid ${BORDER}`,
                  borderLeft: `4px solid ${BLUE}`,
                  padding: '20px 24px'
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 6 }}>
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
                background: 'rgba(255,255,255,0.04)',
                borderTop: `1px solid ${BORDER}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <button
                onClick={() => setInfoModalOpen(false)}
                style={{ background: 'transparent', border: `1px solid ${BORDER}`, color: TEXT, padding: '10px 20px', fontSize: 12, cursor: 'pointer' }}
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
                  {msg.role === 'user' ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                  ) : (
                    <div
                      style={{ fontSize: 13.5, color: TEXT }}
                      dangerouslySetInnerHTML={{ __html: formatChatMessageHtml(msg.content, false) }}
                    />
                  )}
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
                    background: 'rgba(255,255,255,0.05)',
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
              background: 'rgba(255,255,255,0.04)',
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

/* ── Passo 4 · linha de revisão com botão "editar" ────────────────────── */
function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 4,
        border: `1px solid ${INPUT_BORDER}`,
        background: 'rgba(255,255,255,0.04)'
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, letterSpacing: 1, color: MUTED, textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: 13, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        style={{ background: 'transparent', border: 'none', color: BLUE_LIGHT, fontSize: 11.5, cursor: 'pointer', flexShrink: 0 }}
      >
        editar
      </button>
    </div>
  );
}

function channelChipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: 20,
    border: `1px solid ${active ? BLUE : INPUT_BORDER}`,
    background: active ? 'rgba(36,85,184,0.25)' : 'transparent',
    color: active ? TEXT : MUTED,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer'
  };
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
