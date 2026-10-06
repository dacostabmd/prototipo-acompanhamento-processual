'use client';

import { authFetch } from '@/lib/authFetch';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { SegmentedControl, Switch, Tooltip } from '@mantine/core';
import { Lock, Check, X, Info, XCircle, Scale, AlertTriangle } from 'lucide-react';
import Stepper, { Step } from './Stepper';
import ProcessResultView from './ProcessResultView';
import FontesSelector, {
  IDS_TODOS_DATAJUD,
  custoFontesSelecionadas,
  fontesInfosimplesDoTribunal
} from './FontesSelector';
import {
  buildCaseData,
  buildCaseDataFromProcesses,
  type CaseData,
  type LegalProcess
} from '@/lib/mockProcesses';
import {
  cleanDigits,
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
import { custoTotal, formatarReais } from '@/lib/infosimplesPricing';
import { fontesInfosimplesPara, IDS_PRINCIPAIS_INFOSIMPLES, type TipoBusca } from '@/lib/fontesInfosimples';

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

// 'error' = a fonte FALHOU (≠ 'not-found', que é a fonte respondendo que não há processo).
type ScanStatus = 'pending' | 'loading' | 'found' | 'not-found' | 'cancelled' | 'error';
/** De onde o card está consultando: Infosimples (raspagem do portal) ou DataJud (API pública do CNJ). */
type ScanFonte = 'infosimples' | 'datajud';
/** Progresso de uma única fonte dentro do card do tribunal. */
type ScanFonteProgresso = { status: ScanStatus; startedAt?: number; elapsedMs?: number; erro?: string };
/**
 * Um card por tribunal/estado (não mais um card por fonte): reúne o progresso da Infosimples e do
 * DataJud para o mesmo tribunal num só lugar, já que as duas consultam o mesmo processo.
 */
type ScanItem = {
  label: string;
  infosimples?: ScanFonteProgresso;
  datajud?: ScanFonteProgresso;
};

const MOSS_GREEN = '#3d6b4f';
const WARN = '#d4a65f';
const RUBY_RED = '#9b2c3f';

/** Ordena os ids das fontes colocando primeiro o tribunal do DDD informado (mesma regra do backend). */
function ordenarPorDdd(ids: string[], ddd: number): string[] {
  return prioritizeByDdd(ids.map(label => ({ label })), ddd).map(i => i.label);
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
  // Documentos extras (CPF/CNPJ adicionais do mesmo titular, ex.: empresas dele) — cada um roda
  // como uma busca completa própria, em sequência, depois do documento principal (botão "+").
  const [extraDocsInput, setExtraDocsInput] = useState<string[]>([]);
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

  // Passo 2 · Onde procurar. Por CPF/CNPJ/nome: ids das fontes Infosimples (começa nas principais) e
  // endpoints DataJud (começa em todos, são gratuitos). Por número CNJ: só liga/desliga as 2 fontes.
  const [infosimplesSel, setInfosimplesSel] = useState<string[]>(IDS_PRINCIPAIS_INFOSIMPLES);
  const [datajudSel, setDatajudSel] = useState<string[]>(IDS_TODOS_DATAJUD);

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
  // No fluxo por número (Fluxo A), o evento do DataJud vem como "DataJud (CNJ)" sem o nome do
  // tribunal embutido — guarda o único tribunal-alvo da busca para rotear a sub-fonte certa no card.
  const targetTribunalRef = useRef<string>('');
  // Múltiplos documentos (botão "+" no Passo 1): rodam em sequência, cada um como uma busca completa.
  // O ref permite interromper a fila assim que o usuário clicar em "cancelar busca" (lido de forma
  // síncrona entre um documento e o próximo, sem esperar o próximo render do state).
  const buscaCanceladaRef = useRef(false);
  const [documentoAtualIdx, setDocumentoAtualIdx] = useState(0);
  const [totalDocumentos, setTotalDocumentos] = useState(1);
  const [custoAcumulado, setCustoAcumulado] = useState(0);
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
  // O campo de documento aceita CPF (11 dígitos) ou CNPJ (14), identificado pelo tamanho.
  const cpfInputDigits = cleanDigits(cpfInput);
  const isDocValid =
    (cpfInputDigits.length === 11 && isValidCpf(cpfInputDigits)) ||
    (cpfInputDigits.length === 14 && isValidCnpj(cpfInputDigits));
  const isProcessNumberValid = cleanDigits(processNumberInput).length === 20;
  const docLabel = cpfInputDigits.length === 14 ? 'CNPJ' : 'CPF';
  const tipoBusca: TipoBusca =
    searchMode === 'numero' ? 'numero' : searchMode === 'nome' ? 'nome' : cpfInputDigits.length === 14 ? 'cnpj' : 'cpf';

  // Passo 2: fontes efetivas. Por número, o tribunal vem do CNJ e só há 2 fontes (DataJud e Infosimples).
  const aliasDatajudCnj = detectedTribunal?.datajudAlias ?? '';
  const servicosDoNumero = fontesInfosimplesDoTribunal(aliasDatajudCnj);
  const usaDatajudNumero = !!aliasDatajudCnj && datajudSel.includes(aliasDatajudCnj);
  const idsInfosimplesEfetivos =
    tipoBusca === 'numero'
      ? servicosDoNumero.filter(s => infosimplesSel.includes(s.id)).map(s => s.id)
      : fontesInfosimplesPara(tipoBusca)
          .filter(f => infosimplesSel.includes(f.id))
          .map(f => f.id);
  // Custo previsto: Infosimples é pago por consulta; o DataJud é sempre gratuito. Por número, o
  // valor é o máximo (os sistemas do tribunal são consultados em sequência até achar o processo).
  // Documentos adicionais (botão "+") rodam como buscas completas à parte: o custo soma por documento.
  const qtdDocumentosValidos =
    1 +
    extraDocsInput.filter(d => {
      const digits = cleanDigits(d);
      return (digits.length === 11 && isValidCpf(digits)) || (digits.length === 14 && isValidCnpj(digits));
    }).length;
  const custoPrevistoPorDocumento =
    tipoBusca === 'numero'
      ? custoTotal(servicosDoNumero.filter(s => infosimplesSel.includes(s.id)).map(s => s.service))
      : custoFontesSelecionadas(tipoBusca, infosimplesSel);
  const custoPrevisto = custoPrevistoPorDocumento * (tipoBusca === 'numero' ? 1 : qtdDocumentosValidos);
  const custoPrevistoLabel =
    tipoBusca === 'numero'
      ? custoPrevisto === 0
        ? 'Gratuito (DataJud CNJ)'
        : `${idsInfosimplesEfetivos.length > 1 ? 'até ' : ''}${formatarReais(custoPrevisto)}`
      : qtdDocumentosValidos > 1
      ? `${formatarReais(custoPrevisto)} (${qtdDocumentosValidos} documentos)`
      : formatarReais(custoPrevisto);
  const qtdDatajudEfetivos = tipoBusca === 'numero' ? (usaDatajudNumero ? 1 : 0) : datajudSel.length;

  // Ao buscar por número de processo, o CNJ (20 dígitos) é o dado principal e Nome/CPF tornam-se opcionais.
  // Por nome da parte, o nome é o dado principal e o documento é opcional (no modo, fullName = nome da parte).
  const isStep1Valid =
    searchMode === 'numero'
      ? isProcessNumberValid && (cpfInputDigits.length === 0 || isDocValid)
      : searchMode === 'nome'
      ? isPagante && partyNameInput.trim().length >= 3 && (cpfInputDigits.length === 0 || isDocValid)
      : fullName.trim().length >= 3 && isDocValid;
  const isStep2Valid = tipoBusca === 'numero' ? usaDatajudNumero || idsInfosimplesEfetivos.length > 0 : idsInfosimplesEfetivos.length > 0;
  const isStep3Valid = true;
  // Celular opcional (da parte pesquisada): vazio é válido; se preenchido, exige DDD + número.
  const isStep4Valid = cleanDigits(phoneInput).length === 0 || cleanDigits(phoneInput).length >= 10;

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

  // Busca completa para UM documento (CPF ou CNPJ) — usada tanto pelo documento principal quanto
  // por cada documento adicional (botão "+"), em sequência. Devolve os processos achados e o custo
  // real desta rodada; null se cancelada pelo usuário no meio do caminho.
  const executarBuscaDocumento = async (
    digits: string
  ): Promise<{ processes: any[]; custo: number; tribunaisConsultados: string[] } | null> => {
    const phoneDigits = cleanDigits(phoneInput);
    const isBuscaNumero = searchMode === 'numero';
    const cnjParsed = isBuscaNumero ? parseCnj(processNumberInput) : null;
    const scanStartedAt = Date.now();
    const usaInfosimples = isBuscaNumero ? idsInfosimplesEfetivos.length > 0 : true;
    const targets = isBuscaNumero
      ? cnjParsed?.tribunalLabel
        ? [cnjParsed.tribunalLabel]
        : []
      : ordenarPorDdd(idsInfosimplesEfetivos, extractDdd(phoneDigits));
    // No fluxo multi-tribunal, o DataJud só consegue confirmar um processo já achado pela Infosimples
    // (a API do CNJ não busca por CPF/CNPJ/nome) — mas a sub-fonte já nasce "pending" dentro do card,
    // deixando claro desde o início que as duas fontes vão trabalhar em paralelo assim que houver um
    // número de processo para consultar. No fluxo por número, as duas já têm o número e começam juntas.
    const usaDataJudAgora = isBuscaNumero ? usaDatajudNumero : datajudSel.length > 0;
    targetTribunalRef.current = isBuscaNumero ? cnjParsed?.tribunalLabel || '' : '';
    setScanItems(
      targets.map(label => ({
        label,
        infosimples: usaInfosimples ? { status: 'loading', startedAt: scanStartedAt } : undefined,
        datajud: usaDataJudAgora
          ? isBuscaNumero
            ? { status: 'loading', startedAt: scanStartedAt }
            : { status: 'pending' }
          : undefined
      }))
    );
    consultaIdRef.current = null;
    setCancelingLabels(new Set());

    const res = await authFetch('/api/processos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documento: digits,
        nomeParte: searchMode === 'nome' ? partyNameInput.trim() : '',
        fullName: fullName.trim() || (isBuscaNumero ? 'Consulta por Número' : ''),
        phone: phoneDigits,
        state: stateInput,
        processNumber: isBuscaNumero ? processNumberInput : '',
        // Fontes do Passo 2: ids Infosimples (lista explícita) e endpoints DataJud (null = todos).
        tribunaisSelecionados: idsInfosimplesEfetivos,
        datajudSelecionados: isBuscaNumero
          ? usaDatajudNumero
            ? [aliasDatajudCnj]
            : []
          : datajudSel.length === IDS_TODOS_DATAJUD.length
          ? null
          : datajudSel,
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
      if (buscaCanceladaRef.current) {
        void reader.cancel().catch(() => {});
        return null;
      }
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
          // O backend rotula o evento do DataJud como "DataJud (CNJ)" (fluxo por número, sem o nome
          // do tribunal embutido — usa o tribunal-alvo guardado no ref) ou "DataJud · <tribunal>"
          // (fluxo multi-tribunal) — normaliza para o nome puro do tribunal (chave do card único,
          // ex.: "TJSP") e direciona o progresso para a sub-fonte certa dentro dele.
          const dataJudMatch = evt.fonte === 'datajud' ? /^DataJud · (.+)$/.exec(evt.label) : null;
          const tribunalLabel: string =
            evt.fonte === 'datajud' ? dataJudMatch?.[1] ?? targetTribunalRef.current : evt.label;
          const chave: 'infosimples' | 'datajud' = evt.fonte === 'datajud' ? 'datajud' : 'infosimples';

          setScanItems(prev => {
            const existe = prev.some(item => item.label === tribunalLabel);
            const novoProgresso = (anterior: ScanFonteProgresso | undefined): ScanFonteProgresso => {
              if (evt.status === 'loading') {
                return { status: 'loading', startedAt: anterior?.startedAt ?? Date.now() };
              }
              const elapsedMs = anterior?.startedAt ? Date.now() - anterior.startedAt : undefined;
              // Tribunal cancelado pelo usuário não entra na média histórica (não é um tempo real de resposta).
              if (elapsedMs && !evt.cancelado && !evt.erro) recordSample(`${tribunalLabel} (${chave})`, elapsedMs);
              const status: ScanStatus = evt.cancelado ? 'cancelled' : evt.found ? 'found' : evt.erro ? 'error' : 'not-found';
              return { status, erro: evt.erro, elapsedMs };
            };

            // O card do DataJud por um processo achado num tribunal que não tinha varredura própria
            // (não deveria acontecer hoje, mas por segurança) entra dinamicamente se for novo.
            if (!existe) {
              if (evt.status !== 'loading') return prev;
              const novoItem: ScanItem = { label: tribunalLabel, [chave]: novoProgresso(undefined) };
              return [...prev, novoItem];
            }

            const proximo = prev.map((item): ScanItem => {
              if (item.label !== tribunalLabel) return item;
              return { ...item, [chave]: novoProgresso(item[chave]) };
            });

            // Infosimples terminou sem achar nada neste tribunal: o DataJud deste card, se ainda
            // "pending" (esperando um número de processo que nunca vai existir), fecha como "sem achado".
            if (chave === 'infosimples' && evt.status !== 'loading' && !evt.found) {
              return proximo.map((item): ScanItem =>
                item.label === tribunalLabel && item.datajud?.status === 'pending'
                  ? { ...item, datajud: { status: 'not-found' } }
                  : item
              );
            }
            return proximo;
          });
        } else if (evt.type === 'done') {
          data = evt;
        }
      }
    }

    if (buscaCanceladaRef.current) return null;
    if (!data) {
      throw new Error('Falha ao processar resposta do servidor.');
    }

    return {
      processes: data.notFound || !data.processes ? [] : data.processes,
      custo: typeof data.custoEstimado === 'number' ? data.custoEstimado : 0,
      tribunaisConsultados: data.tribunaisConsultados || []
    };
  };

  // Envio final do Stepper e Execução da Busca + Bitrix. Documentos adicionais (botão "+" do Passo 1)
  // rodam em sequência, depois do documento principal — cada um é uma busca completa à parte.
  const handleFinalStepCompleted = async () => {
    const documentosDigits = [cpfInput, ...extraDocsInput]
      .map(d => cleanDigits(d))
      .filter(d => (d.length === 11 && isValidCpf(d)) || (d.length === 14 && isValidCnpj(d)));
    const digits = documentosDigits[0] ?? cleanDigits(cpfInput);
    const phoneDigits = cleanDigits(phoneInput);

    if (!isStep1Valid || !isStep2Valid || !isStep4Valid) {
      setFormError('Por favor, revise os dados informados nos passos anteriores.');
      return;
    }

    setFormError('');
    setSearching(true);
    setHasSearched(false);
    buscaCanceladaRef.current = false;
    setTotalDocumentos(documentosDigits.length || 1);
    setDocumentoAtualIdx(0);
    setCustoAcumulado(0);

    try {
      const todosProcessos: any[] = [];
      const todosTribunais = new Set<string>();
      let custoTotalAcumulado = 0;
      const fila = documentosDigits.length > 0 ? documentosDigits : [digits];

      for (let i = 0; i < fila.length; i++) {
        if (buscaCanceladaRef.current) break;
        setDocumentoAtualIdx(i);
        const resultado = await executarBuscaDocumento(fila[i]);
        if (!resultado) break; // cancelado no meio desta rodada

        resultado.processes.forEach(p => todosProcessos.push(p));
        resultado.tribunaisConsultados.forEach(t => todosTribunais.add(t));
        custoTotalAcumulado += resultado.custo;
        setCustoAcumulado(custoTotalAcumulado);
      }

      // Cancelada pelo usuário: volta ao formulário sem mostrar resultado parcial — "cancelar" é
      // desistir da busca, não ver o que já tinha sido achado até aquele ponto.
      if (buscaCanceladaRef.current) {
        setSearching(false);
        return;
      }

      setTribunaisConsultados(Array.from(todosTribunais));
      setCustoEstimado(custoTotalAcumulado);
      await new Promise(r => setTimeout(r, 400));

      let currentCases: CaseData | null = null;
      let totalFound = 0;

      if (todosProcessos.length === 0) {
        setNotFound(true);
        setCaseData(null);
      } else {
        setNotFound(false);
        currentCases = buildCaseDataFromProcesses(todosProcessos);
        setCaseData(currentCases);
        totalFound = todosProcessos.length;
      }

      setHasSearched(true);

      // 2. Integração com Bitrix24 (criação automática de card)
      try {
        const bitrixRes = await authFetch('/api/bitrix/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName,
            cpf: formatDocumento(digits),
            phone: formatPhone(phoneDigits),
            state: stateInput,
            processNumber: processNumberInput,
            processesCount: totalFound,
            tribunal: Array.from(todosTribunais).join(', ') || stateInput,
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

  // Cancela a consulta inteira (todos os tribunais do documento atual + os próximos documentos da
  // fila) — diferente de handleCancelarTribunal, que para só uma sub-fonte de um tribunal específico.
  const handleCancelarBuscaInteira = () => {
    buscaCanceladaRef.current = true;
    const consultaId = consultaIdRef.current;
    if (!consultaId) return;
    // Aborta cada tribunal/sub-fonte ainda em andamento da rodada atual (o backend libera os recursos
    // e o loop de leitura do NDJSON também já vai parar sozinho ao ver buscaCanceladaRef).
    scanItems.forEach(item => {
      if (item.infosimples?.status === 'loading') {
        void authFetch('/api/processos/cancelar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consultaId, label: item.label })
        }).catch(() => {});
      }
      if (item.datajud?.status === 'loading') {
        void authFetch('/api/processos/cancelar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consultaId, label: `DataJud · ${item.label}` })
        }).catch(() => {});
      }
    });
  };

  // Cancela a consulta de um tribunal específico em andamento (card individual na tela de
  // varredura), sem afetar os demais — usa o consultaId recebido no evento 'started' do streaming.
  const handleCancelarTribunal = async (label: string) => {
    const consultaId = consultaIdRef.current;
    if (!consultaId) return;
    setCancelingLabels(prev => new Set(prev).add(label));
    try {
      const res = await authFetch('/api/processos/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consultaId, label })
      });
      const resultado = await res.json().catch(() => null);
      // cancelado:false = o servidor não achou a consulta em andamento (já terminou ou é outra instância).
      if (resultado && resultado.cancelado === false) {
        console.warn(`[ProcessTracker] o servidor não encontrou "${label}" para cancelar (já concluído ou outra instância).`);
      }
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
        {/* ═════════════════════════════════════════════════════════════════
            FASE 1: FORMULÁRIO EM STEPPER ANIMADO (4 PASSOS)
            ═════════════════════════════════════════════════════════════════ */}
        {!hasSearched && (
          <div style={{ width: '100%', maxWidth: searching ? 900 : 720, animation: 'bf-fadein 0.5s ease both' }}>
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

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 14,
                    flexWrap: 'wrap',
                    marginBottom: 20
                  }}
                >
                  {totalDocumentos > 1 && (
                    <span style={{ fontSize: 12.5, color: MUTED }}>
                      Documento {documentoAtualIdx + 1} de {totalDocumentos} · custo acumulado{' '}
                      <strong style={{ color: TEXT }}>{formatarReais(custoAcumulado)}</strong>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleCancelarBuscaInteira}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'transparent',
                      border: `1px solid ${DANGER}`,
                      color: DANGER,
                      borderRadius: 4,
                      padding: '6px 14px',
                      fontSize: 12,
                      letterSpacing: 0.3,
                      cursor: 'pointer'
                    }}
                  >
                    <XCircle size={14} strokeWidth={2} />
                    CANCELAR BUSCA
                  </button>
                </div>

                {searchMode === 'numero' ? (
                  (() => {
                    const subfontesConcluida = (f?: ScanFonteProgresso) =>
                      !f || f.status === 'found' || f.status === 'not-found' || f.status === 'cancelled' || f.status === 'error';
                    const subfontePendente = (f?: ScanFonteProgresso) => f && (f.status === 'pending' || f.status === 'loading');
                    const item = scanItems[0];
                    const todasConcluidas = !item || (subfontesConcluida(item.infosimples) && subfontesConcluida(item.datajud));
                    const algumEncontrado = item?.infosimples?.status === 'found' || item?.datajud?.status === 'found';
                    const dataJudPendente = subfontePendente(item?.datajud);
                    const tribunalPendente = subfontePendente(item?.infosimples);
                    const totalCount = (item?.infosimples ? 1 : 0) + (item?.datajud ? 1 : 0) || 1;

                    // % estimado pela média dos dois itens em andamento (mesma mecânica de tempo médio
                    // histórico usada no grid multi-tribunal, via lib/tribunalTiming.ts) — curva
                    // assintótica (1 - e^-x): avança rápido no início e desacelera perto de 99%, mas
                    // nunca trava num teto fixo enquanto se espera a resposta real.
                    const pct = todasConcluidas
                      ? 100
                      : Math.min(
                          99,
                          Math.round(
                            ([item?.infosimples, item?.datajud].reduce((sum, f) => {
                              if (!f) return sum;
                              if (f.status !== 'loading' || !f.startedAt) return sum + (f.status === 'pending' ? 0 : 100);
                              const liveElapsedMs = Date.now() - f.startedAt;
                              const avgMs = getAvgMs(item!.label);
                              return sum + Math.min(99, (1 - Math.exp(-liveElapsedMs / avgMs)) * 100);
                            }, 0) /
                              totalCount)
                          )
                        );

                    const statusLabel = todasConcluidas
                      ? algumEncontrado
                        ? 'Processo localizado — consolidando os dados...'
                        : 'Nenhuma das duas fontes localizou o processo...'
                      : dataJudPendente && tribunalPendente
                      ? `Consultando a base pública do CNJ (DataJud) e o ${item?.label || 'tribunal'} em paralelo...`
                      : dataJudPendente
                      ? 'Consultando a base pública do CNJ (DataJud)...'
                      : tribunalPendente
                      ? `Aguardando resposta do ${item?.label}...`
                      : 'Consolidando os dados encontrados...';

                    // Passou da média histórica de alguma das duas fontes: a % deixa de ser uma
                    // estimativa confiável (pode faltar 1s ou 1min) — troca para barra indeterminada.
                    const algumAtrasado = [item?.infosimples, item?.datajud].some(
                      f => f?.status === 'loading' && f.startedAt && Date.now() - f.startedAt > getAvgMs(item?.label ?? '')
                    );

                    return (
                      <div style={{ maxWidth: 420, margin: '0 auto' }}>
                        <div
                          style={{
                            height: 6,
                            borderRadius: 3,
                            background: 'rgba(255,255,255,0.08)',
                            overflow: 'hidden',
                            position: 'relative'
                          }}
                        >
                          {!todasConcluidas && algumAtrasado ? (
                            <div
                              style={{
                                position: 'absolute',
                                top: 0,
                                bottom: 0,
                                left: '-40%',
                                width: '40%',
                                background: WARN,
                                borderRadius: 3,
                                animation: 'bf-indeterminate 1.1s ease-in-out infinite'
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                height: '100%',
                                width: `${pct}%`,
                                background: todasConcluidas ? (algumEncontrado ? MOSS_GREEN : RUBY_RED) : BLUE,
                                borderRadius: 3,
                                transition: 'width 0.4s ease'
                              }}
                            />
                          )}
                        </div>
                        <div style={{ marginTop: 10, fontSize: 12.5, color: MUTED, lineHeight: 1.4 }}>
                          {statusLabel} {!todasConcluidas && !algumAtrasado && `(${pct}%)`}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <>
                {(() => {
                  const doneCount = scanItems.filter(
                    i => !i.infosimples || i.infosimples.status === 'found' || i.infosimples.status === 'not-found' || i.infosimples.status === 'cancelled' || i.infosimples.status === 'error'
                  ).length;
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
                      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                      gap: 10,
                      textAlign: 'left',
                      maxWidth: 1080,
                      margin: '0 auto'
                    }}
                    className="bf-scan-grid"
                  >
                    {scanItems.map(item => {
                      // Status composto do card: achou em qualquer fonte > ainda rodando > falhou >
                      // sem processos > cancelado > aguardando. Resume as duas sub-fontes num resumo
                      // só, já que o card agora é por tribunal, não por fonte.
                      const subfontes = [item.infosimples, item.datajud].filter(
                        (f): f is ScanFonteProgresso => !!f
                      );
                      const statusGeral: ScanStatus = subfontes.some(f => f.status === 'found')
                        ? 'found'
                        : subfontes.some(f => f.status === 'loading')
                        ? 'loading'
                        : subfontes.some(f => f.status === 'pending')
                        ? 'pending'
                        : subfontes.some(f => f.status === 'error')
                        ? 'error'
                        : subfontes.every(f => f.status === 'cancelled')
                        ? 'cancelled'
                        : 'not-found';
                      return (
                        <div
                          key={item.label}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
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
                              {statusGeral === 'pending' && (
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: INPUT_BORDER }} />
                              )}
                              {statusGeral === 'found' && <Check size={16} strokeWidth={2.5} style={{ color: MOSS_GREEN }} />}
                              {(statusGeral === 'not-found' || statusGeral === 'cancelled') && (
                                <X size={16} strokeWidth={2.5} style={{ color: RUBY_RED }} />
                              )}
                              {statusGeral === 'error' && <AlertTriangle size={16} strokeWidth={2.2} style={{ color: WARN }} />}
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
                          </div>

                          {item.infosimples && (
                            <SubFonteBar
                              label="Infosimples"
                              cor="#b8a8d4"
                              progresso={item.infosimples}
                              tribunal={item.label}
                              onCancelar={() => handleCancelarTribunal(item.label)}
                              cancelando={cancelingLabels.has(item.label)}
                            />
                          )}
                          {item.datajud && (
                            <SubFonteBar
                              label="DataJud (CNJ)"
                              cor="#8fb8d4"
                              progresso={item.datajud}
                              tribunal={item.label}
                              onCancelar={() => handleCancelarTribunal(`DataJud · ${item.label}`)}
                              cancelando={cancelingLabels.has(`DataJud · ${item.label}`)}
                            />
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
                          { label: 'CPF / CNPJ', value: 'cpf' },
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

                    {/* Nome: na busca por nome da parte o campo é um só (nome da parte = nome completo). */}
                    {searchMode === 'nome' ? (
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: TEXT, marginBottom: 6 }}>
                          NOME DA PARTE
                        </label>
                        <input
                          type="text"
                          value={partyNameInput}
                          onChange={e => {
                            setPartyNameInput(e.target.value);
                            setFullName(e.target.value);
                          }}
                          placeholder="Nome completo da parte, como consta no processo"
                          style={inputStyle}
                          autoFocus
                        />
                      </div>
                    ) : (
                      <>
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
                      </>
                    )}

                    <label style={{ display: 'flex', alignItems: 'center', fontSize: 11.5, fontWeight: 600, color: TEXT, marginBottom: 6 }}>
                      {isConsultante
                        ? 'SEU CPF/CNPJ'
                        : searchMode === 'numero' || searchMode === 'nome'
                        ? 'CPF OU CNPJ (OPCIONAL)'
                        : 'CPF OU CNPJ DO TITULAR'}
                      <Tooltip
                        label={
                          isConsultante
                            ? 'CPF/CNPJ fixo, definido no cadastro e travado para consultantes'
                            : searchMode === 'numero'
                            ? 'Opcional na busca por processo CNJ'
                            : searchMode === 'nome'
                            ? 'Opcional. Identifica o titular no resumo e no contato; não filtra homônimos.'
                            : 'Digite 11 dígitos para CPF ou 14 para CNPJ — o sistema identifica sozinho.'
                        }
                        withArrow
                      >
                        <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', color: MUTED, cursor: 'help' }}>
                          {isConsultante ? <Lock size={13} strokeWidth={2.2} /> : <Info size={14} />}
                        </span>
                      </Tooltip>
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <input
                        type="text"
                        value={cpfInput}
                        onChange={e => setCpfInput(formatDocumento(e.target.value))}
                        placeholder={
                          (searchMode === 'numero' || searchMode === 'nome') && !isConsultante
                            ? 'CPF ou CNPJ (opcional)'
                            : '000.000.000-00 ou 00.000.000/0000-00'
                        }
                        maxLength={18}
                        inputMode="numeric"
                        style={{ ...inputStyle, flex: 1 }}
                        disabled={isConsultante}
                      />
                      {!isConsultante && searchMode !== 'numero' && (
                        <Tooltip label="Adicionar outro documento (ex.: CNPJ de uma empresa do mesmo titular) — roda como uma busca própria, depois desta" withArrow>
                          <button
                            type="button"
                            onClick={() => setExtraDocsInput(prev => [...prev, ''])}
                            aria-label="Adicionar outro documento"
                            style={{
                              flexShrink: 0,
                              width: 40,
                              height: 40,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'transparent',
                              border: `1px solid ${INPUT_BORDER}`,
                              borderRadius: 4,
                              color: TEXT,
                              fontSize: 18,
                              lineHeight: 1,
                              cursor: 'pointer'
                            }}
                          >
                            +
                          </button>
                        </Tooltip>
                      )}
                    </div>
                    {!isDocValid && cpfInputDigits.length >= 11 && (
                      <span style={{ fontSize: 11, color: DANGER, marginTop: 4, display: 'block' }}>
                        {cpfInputDigits.length === 11 || cpfInputDigits.length === 14
                          ? `Dígito verificador do ${docLabel} inválido. Verifique os números.`
                          : 'O CPF tem 11 dígitos e o CNPJ tem 14.'}
                      </span>
                    )}

                    {extraDocsInput.map((doc, i) => {
                      const digits = cleanDigits(doc);
                      const valido = (digits.length === 11 && isValidCpf(digits)) || (digits.length === 14 && isValidCnpj(digits));
                      return (
                        <div key={i} style={{ marginTop: 8 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <input
                              type="text"
                              value={doc}
                              onChange={e =>
                                setExtraDocsInput(prev => prev.map((d, idx) => (idx === i ? formatDocumento(e.target.value) : d)))
                              }
                              placeholder={`Documento adicional ${i + 2} (CPF ou CNPJ)`}
                              maxLength={18}
                              inputMode="numeric"
                              style={{ ...inputStyle, flex: 1 }}
                            />
                            <button
                              type="button"
                              onClick={() => setExtraDocsInput(prev => prev.filter((_, idx) => idx !== i))}
                              aria-label={`Remover documento adicional ${i + 2}`}
                              title="Remover este documento"
                              style={{
                                flexShrink: 0,
                                width: 40,
                                height: 40,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'transparent',
                                border: `1px solid ${INPUT_BORDER}`,
                                borderRadius: 4,
                                color: MUTED,
                                cursor: 'pointer'
                              }}
                            >
                              <XCircle size={16} strokeWidth={2} />
                            </button>
                          </div>
                          {!valido && digits.length >= 11 && (
                            <span style={{ fontSize: 11, color: DANGER, marginTop: 4, display: 'block' }}>
                              {digits.length === 11 || digits.length === 14
                                ? 'Dígito verificador inválido. Verifique os números.'
                                : 'O CPF tem 11 dígitos e o CNPJ tem 14.'}
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {!isConsultante && (searchMode === 'cpf' || (searchMode !== 'numero' && cpfInput)) && (
                      <span style={{ fontSize: 11, color: MUTED, marginTop: 6, display: 'block', lineHeight: 1.5 }}>
                        {extraDocsInput.length > 0
                          ? `A busca vai rodar em sequência: o documento principal e mais ${extraDocsInput.length} documento(s) adicional(is), cada um varrendo os mesmos tribunais — o custo soma por documento.`
                          : 'A busca é feita por documento. Se o titular tem processos tanto no CPF quanto em CNPJ(s) de empresas dele, use o botão "+" para adicionar cada documento — todos rodam na mesma consulta.'}
                      </span>
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
                        : 'Já deixamos marcadas as fontes principais. Abra cada grupo para ver todas, com o custo de cada uma.'}
                    </p>

                    <FontesSelector
                      tipoBusca={tipoBusca}
                      detectado={detectedTribunal}
                      infosimplesSel={infosimplesSel}
                      onInfosimplesChange={setInfosimplesSel}
                      datajudSel={datajudSel}
                      onDatajudChange={setDatajudSel}
                    />

                    <div
                      style={{
                        marginTop: 14,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        flexWrap: 'wrap',
                        padding: '10px 14px',
                        borderRadius: 4,
                        border: `1px solid ${INPUT_BORDER}`,
                        background: 'rgba(255,255,255,0.04)'
                      }}
                    >
                      <span style={{ fontSize: 12, color: MUTED, letterSpacing: 0.5 }}>CUSTO ESTIMADO (INFOSIMPLES + DATAJUD)</span>
                      <span style={{ fontSize: 14, color: TEXT, fontWeight: 700 }}>{custoPrevistoLabel}</span>
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
                            ? `Nº ${processNumberInput || '—'}${cpfInput ? ` · ${docLabel} ${cpfInput}` : ''}${fullName ? ` · ${fullName}` : ''}`
                            : searchMode === 'nome'
                            ? `Nome ${partyNameInput || '—'}${cpfInput ? ` · ${docLabel} ${cpfInput}` : ''}`
                            : `${docLabel} ${cpfInput || '—'}`
                        }
                        onEdit={() => setCurrentStepIndex(1)}
                      />
                      <ReviewRow
                        label="Onde"
                        value={
                          searchMode === 'numero' && detectedTribunal?.valido
                            ? `${detectedTribunal.tribunalLabel} · ${[usaDatajudNumero && 'DataJud', idsInfosimplesEfetivos.length > 0 && 'Infosimples'].filter(Boolean).join(' + ') || 'nenhuma fonte'}`
                            : `${idsInfosimplesEfetivos.length} fonte(s) Infosimples · ${qtdDatajudEfetivos} endpoint(s) DataJud`
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
                      CELULAR DA PARTE PESQUISADA (OPCIONAL, COM DDD)
                    </label>
                    <input
                      type="text"
                      value={phoneInput}
                      onChange={e => setPhoneInput(formatPhone(e.target.value))}
                      placeholder="(21) 97402-6883"
                      maxLength={15}
                      style={{ ...inputStyle, marginBottom: 16 }}
                    />
                    {!isStep4Valid && cleanDigits(phoneInput).length > 0 ? (
                      <span style={{ fontSize: 11, color: DANGER, marginTop: -12, marginBottom: 16, display: 'block' }}>
                        Informe o DDD e os 9 dígitos do celular.
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: MUTED, marginTop: -12, marginBottom: 16, display: 'block' }}>
                        Telefone de quem está sendo pesquisado, não o seu. Com o DDD, consultamos primeiro o tribunal do estado dele.
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
                      <span style={{ fontSize: 15, color: custoPrevisto === 0 ? '#8fb99a' : TEXT, fontWeight: 700 }}>
                        {custoPrevistoLabel}
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
        {hasSearched && notFound && <FontesComErroAviso itens={scanItems} />}
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
              A consulta automática para {searchMode === 'numero' ? `o processo ${processNumberInput || 'informado'}` : searchMode === 'nome' ? `o nome ${partyNameInput || 'informado'}` : `o ${docLabel} ${cpfInput || 'informado'}`} não retornou processos públicos ativos no tribunal consultado ({tribunaisConsultados.join(', ') || stateInput}).
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
                  {searchMode === 'numero' ? 'Tentar outro processo' : searchMode === 'nome' ? 'Tentar outro nome' : 'Tentar outro CPF/CNPJ'}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ═════════════════════════════════════════════════════════════════
            FASE 3: DASHBOARD SPLIT 70% / 30% (TRANSITION AUTOMÁTICA EM FADE)
            ═════════════════════════════════════════════════════════════════ */}
        {found && caseData && <FontesComErroAviso itens={scanItems} />}
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

/** Aviso das fontes que FALHARAM na consulta — diferente de "sem processos": o processo pode existir lá. */
function FontesComErroAviso({ itens }: { itens: ScanItem[] }) {
  const comErro = itens.flatMap(i =>
    [
      i.infosimples?.status === 'error' ? { chave: `${i.label} (Infosimples)`, erro: i.infosimples.erro } : null,
      i.datajud?.status === 'error' ? { chave: `${i.label} (DataJud)`, erro: i.datajud.erro } : null
    ].filter((x): x is { chave: string; erro: string | undefined } => x !== null)
  );
  const totalConsultas = itens.reduce((sum, i) => sum + (i.infosimples ? 1 : 0) + (i.datajud ? 1 : 0), 0);
  if (comErro.length === 0) return null;
  return (
    <div
      role="alert"
      style={{
        width: '100%',
        maxWidth: 720,
        boxSizing: 'border-box',
        margin: '0 0 16px',
        padding: '12px 16px',
        borderRadius: 4,
        border: `1px solid ${WARN}`,
        background: 'rgba(212,166,95,0.1)',
        color: TEXT,
        fontSize: 12.5,
        lineHeight: 1.5,
        textAlign: 'left'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 6 }}>
        <AlertTriangle size={15} style={{ color: WARN }} />
        {comErro.length} de {totalConsultas} fonte(s) falharam — o processo pode existir nelas
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, color: MUTED }}>
        {comErro.map(i => (
          <li key={i.chave}>
            <strong style={{ color: TEXT }}>{i.chave}:</strong> {i.erro}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barra de progresso de uma única sub-fonte (Infosimples ou DataJud) dentro do card do tribunal. */
function SubFonteBar({
  label,
  cor,
  progresso,
  tribunal,
  onCancelar,
  cancelando
}: {
  label: string;
  cor: string;
  progresso: ScanFonteProgresso;
  tribunal: string;
  onCancelar: () => void;
  cancelando: boolean;
}) {
  const liveElapsedMs =
    progresso.status === 'loading' && progresso.startedAt ? Date.now() - progresso.startedAt : progresso.elapsedMs ?? 0;
  const avgMs = getAvgMs(`${tribunal} (${label})`);
  const isOverdue = progresso.status === 'loading' && liveElapsedMs > avgMs;
  const estimatedPct =
    progresso.status === 'found' || progresso.status === 'not-found' || progresso.status === 'error'
      ? 100
      : progresso.status === 'loading'
      ? // Curva assintótica (1 - e^-x): cresce rápido no início e desacelera perto de 99%, mas nunca
        // trava num teto fixo — mesmo bem além da média histórica a barra segue avançando visivelmente,
        // em vez de parecer travada enquanto se espera uma resposta real que pode demorar muito mais.
        Math.min(99, Math.round((1 - Math.exp(-liveElapsedMs / avgMs)) * 100))
      : 0;
  const elapsedLabel = liveElapsedMs > 0 ? `${(liveElapsedMs / 1000).toFixed(1)}s` : null;

  const statusTexto =
    progresso.status === 'pending'
      ? label === 'DataJud (CNJ)'
        ? 'De prontidão'
        : 'Aguardando'
      : progresso.status === 'loading'
      ? isOverdue
        ? elapsedLabel ?? 'Em andamento...'
        : `${estimatedPct}% · ${elapsedLabel}`
      : progresso.status === 'found'
      ? elapsedLabel
        ? `Encontrado · ${elapsedLabel}`
        : 'Encontrado'
      : progresso.status === 'not-found'
      ? elapsedLabel
        ? `Sem processos · ${elapsedLabel}`
        : 'Sem processos'
      : progresso.status === 'error'
      ? elapsedLabel
        ? `Falhou · ${elapsedLabel}`
        : 'Falhou'
      : 'Cancelado';

  const stageLabel =
    progresso.status === 'pending' && label === 'DataJud (CNJ)'
      ? 'Consulta a API pública do CNJ assim que a Infosimples achar o número do processo neste tribunal'
      : progresso.status === 'loading'
      ? isOverdue
        ? `Demorando mais que o normal (média ${(avgMs / 1000).toFixed(1)}s) — sistema pode estar lento`
        : liveElapsedMs < 400
        ? `Enviando requisição à ${label}...`
        : label === 'DataJud (CNJ)'
        ? 'Aguardando resposta da API do CNJ...'
        : 'Aguardando resposta do tribunal...'
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 2, gap: 6, minWidth: 0 }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: cor, flex: 'none' }} />
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.2, color: cor, textTransform: 'uppercase', flexShrink: 0 }}>
          {label}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontWeight: 600,
            flexShrink: 0,
            maxWidth: '100%',
            overflowWrap: 'anywhere',
            color:
              progresso.status === 'found'
                ? MOSS_GREEN
                : progresso.status === 'error'
                ? WARN
                : progresso.status === 'not-found' || progresso.status === 'cancelled'
                ? RUBY_RED
                : MUTED
          }}
        >
          {statusTexto}
        </span>
        {progresso.status === 'loading' && (
          <button
            type="button"
            onClick={onCancelar}
            disabled={cancelando}
            title={`Cancelar consulta a ${label} (${tribunal})`}
            aria-label={`Cancelar consulta a ${label} (${tribunal})`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              padding: 2,
              cursor: cancelando ? 'default' : 'pointer',
              opacity: cancelando ? 0.4 : 0.7,
              color: MUTED,
              flexShrink: 0
            }}
          >
            <XCircle size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', position: 'relative' }}>
        {progresso.status === 'pending' && <div style={{ height: '100%', width: 0 }} />}
        {progresso.status === 'loading' &&
          (isOverdue ? (
            // Já passou da média: uma % "estimada" não significa mais nada útil (pode faltar 1s
            // ou 1min) — troca para barra indeterminada, que deixa claro que ainda está rodando
            // sem fingir uma previsão de quanto falta.
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: '-40%',
                width: '40%',
                background: WARN,
                borderRadius: 2,
                animation: 'bf-indeterminate 1.1s ease-in-out infinite'
              }}
            />
          ) : (
            <div
              style={{
                height: '100%',
                width: `${estimatedPct}%`,
                background: BLUE,
                borderRadius: 2,
                transition: 'width 0.15s linear'
              }}
            />
          ))}
        {(progresso.status === 'found' ||
          progresso.status === 'not-found' ||
          progresso.status === 'cancelled' ||
          progresso.status === 'error') && (
          <div
            style={{
              height: '100%',
              width: '100%',
              borderRadius: 2,
              background: progresso.status === 'found' ? MOSS_GREEN : progresso.status === 'error' ? WARN : RUBY_RED
            }}
          />
        )}
      </div>

      {progresso.status === 'error' && progresso.erro && (
        <div title={progresso.erro} style={{ fontSize: 10, color: WARN, lineHeight: 1.3, overflowWrap: 'anywhere', paddingLeft: 11 }}>
          {progresso.erro}
        </div>
      )}

      {stageLabel && (
        <div style={{ fontSize: 10, color: isOverdue ? '#d4a65f' : MUTED, lineHeight: 1.3, paddingLeft: 11 }}>{stageLabel}</div>
      )}
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
