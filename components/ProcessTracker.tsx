'use client';

import { authFetch } from '@/lib/authFetch';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { AnimatePresence, MotionConfig, motion, type Variants } from 'motion/react';
import { SegmentedControl, Switch, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  Lock,
  Info,
  XCircle,
  AlertTriangle,
  AlertCircle,
  FlaskConical,
  CheckCircle2,
  X,
  Timer,
  ListChecks,
  FileText,
  Fingerprint,
  Search,
  Plus,
  UserRound,
  ArrowRight,
  ChevronDown,
  SlidersHorizontal
} from 'lucide-react';
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
import { useDevVisaoAdvogado } from '@/lib/devVisao';
import { extractDdd, prioritizeByTribunalOrDdd, tribunalByDdd, tribunalByUf, ESTADOS_BRASIL } from '@/lib/ddd';
import { useSharedProfile } from '@/components/ProfileProvider';
import { getAvgMs, recordSample } from '@/lib/tribunalTiming';
import { custoTotal, formatarReais } from '@/lib/infosimplesPricing';
import { fontesInfosimplesPara, IDS_PRINCIPAIS_INFOSIMPLES, type TipoBusca } from '@/lib/fontesInfosimples';

/* ── Design tokens (tema dark/glass) ─────────────────────────────────── */
const BLUE = '#1E7CF2';
const BLUE_DARK = 'var(--tt-accent-2)';
const BLUE_LIGHT = 'var(--tt-text-2)';
const PAPER = 'rgb(var(--bf-fg) / 0.05)';
const CREAM = 'rgb(var(--bf-fg) / 0.06)';
const CREAM_TEXT = 'var(--tt-text)';
const BORDER = 'rgb(var(--bf-fg) / 0.12)';
const INPUT_BORDER = 'rgb(var(--bf-fg) / 0.18)';
const INPUT_BG = 'rgb(var(--bf-ink-rgb) / 0.65)';
const TEXT = 'var(--tt-text)';
const MUTED = 'rgb(var(--bf-fg) / 0.65)';
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
type ScanFonteProgresso = {
  status: ScanStatus;
  startedAt?: number;
  elapsedMs?: number;
  /** Falha em linguagem simples (é o que aparece). */
  erro?: string;
  /** Causa técnica com código/tempo/tentativas, mostrada só ao passar o mouse. */
  erroTecnico?: string;
  custo?: number;
};
/**
 * Um card por tribunal/estado (não mais um card por fonte): reúne o progresso da Infosimples e do
 * DataJud para o mesmo tribunal num só lugar, já que as duas consultam o mesmo processo.
 */
type ScanItem = {
  label: string;
  infosimples?: ScanFonteProgresso;
  datajud?: ScanFonteProgresso;
};

/** Processo achado durante a varredura (evento 'processo' do backend), exibido antes do resultado final. */
type ProcessoParcial = { numero: string; tribunal: string; tipo?: string; autor?: string };

/** Consulta da Lemit durante a varredura (evento de progresso fonte 'lemit'), exibida na tela de varredura. */
type LemitEvento = { label: string; status: 'loading' | 'ok' | 'vazio' | 'erro'; detalhe?: string; custo?: number; descoberto?: boolean };

/** Limite de uma varredura no servidor (maxDuration de app/api/processos/route.ts), mostrado no cronômetro. */
const LIMITE_VARREDURA_S = 300;

const MOSS_GREEN = '#3d6b4f';
const WARN = '#4DA6FF';
const RUBY_RED = '#9b2c3f';

/** Ordena os ids das fontes colocando primeiro o tribunal manual selecionado ou o do DDD informado. */
function ordenarFontes(ids: string[], forcedTj?: string | null, ddd?: number): string[] {
  return prioritizeByTribunalOrDdd(ids.map(label => ({ label })), forcedTj, ddd).map(i => i.label);
}

export default function ProcessTracker({
  aiModel = 'claude-haiku-4-5',
  chatTone = 'Acolhedor'
}: ProcessTrackerProps) {
  const isPagante = useDevPagante();
  const { profile } = useSharedProfile();
  const isConsultante = profile.role === 'cliente';

  // Dados da busca
  const [fullName, setFullName] = useState('');
  // Padrão: busca por número (gratuita, só DataJud). Por pessoa/empresa e por nome ficam para a visão de advogado.
  const [searchMode, setSearchMode] = useState<'cpf' | 'numero' | 'nome'>('numero');
  const [cpfInput, setCpfInput] = useState('');
  // Documentos extras (CPF/CNPJ adicionais do mesmo titular, ex.: empresas dele) — cada um roda
  // como uma busca completa própria, em sequência, depois do documento principal (botão "+").
  const [extraDocsInput, setExtraDocsInput] = useState<string[]>([]);
  const [processNumberInput, setProcessNumberInput] = useState('');
  const [partyNameInput, setPartyNameInput] = useState('');
  const [estadoManual, setEstadoManual] = useState('');
  // Opção "somente autor": quando marcado, a API só retorna processos em que o nome/documento
  // pesquisado está no polo ativo (Autor), descartando os em que o pesquisado é Réu/parte contrária.
  // Processos sem informação de polo confiável na fonte permanecem visíveis (não são descartados).
  const [somenteAutor, setSomenteAutor] = useState(false);

  // Consultante: documento fixo do próprio perfil, pré-preenchido e travado.
  useEffect(() => {
    if (isConsultante) setSearchMode('cpf');
    if (isConsultante && profile.documento) {
      setCpfInput(formatDocumento(profile.documento));
      setFullName(prev => prev || profile.nome);
    }
  }, [isConsultante, profile.documento, profile.nome]);

  // Pré-preenche o CNJ vindo da busca pública ou URL (/consulta?busca=... ou ap_processo_pendente)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const buscaUrl = params.get('busca') || params.get('processo');
      const buscaStorage = sessionStorage.getItem('ap_processo_pendente');
      const valor = buscaUrl || buscaStorage;
      if (valor) {
        const digitos = cleanDigits(valor);
        if (digitos.length === 20) {
          setSearchMode('numero');
          setProcessNumberInput(formatProcessNumber(digitos));
          sessionStorage.removeItem('ap_processo_pendente');
        }
      }
    } catch {}
  }, []);

  // Onde procurar. Por CPF/CNPJ/nome: ids das fontes Infosimples (começa nas principais) e
  // endpoints DataJud (começa em todos, são gratuitos). Por número CNJ: só liga/desliga as 2 fontes.
  const [infosimplesSel, setInfosimplesSel] = useState<string[]>(IDS_PRINCIPAIS_INFOSIMPLES);
  const [datajudSel, setDatajudSel] = useState<string[]>(IDS_TODOS_DATAJUD);
  // Por número a busca é gratuita: a Infosimples do tribunal (paga) começa desmarcada e só o advogado pode ligá-la.
  const [infosimplesNumeroSel, setInfosimplesNumeroSel] = useState<string[]>([]);
  const [infosimplesSegundaTentativa, setInfosimplesSegundaTentativa] = useState(false);
  const [refazerBusca, setRefazerBusca] = useState(false);
  // número já tentado na Infosimples: não oferece pagar de novo pelo mesmo resultado
  const [numeroTentadoNaInfosimples, setNumeroTentadoNaInfosimples] = useState('');

  // "Visualizar como": usuário comum vê o formulário enxuto (busca recomendada); advogado vê também busca por
  // nome, documentos extras, estado inicial e a escolha manual de fontes. Consultante é sempre usuário comum.
  // Compartilhada com o botão flutuante "Simular conta" (components/DevMetrics.tsx).
  const visaoAdvogado = useDevVisaoAdvogado();
  // Usuário comum só busca por número (gratuito); pessoa/empresa e nome são da visão de advogado.
  useEffect(() => {
    if (!visaoAdvogado && !isConsultante) setSearchMode('numero');
  }, [visaoAdvogado, isConsultante]);
  const [ajustesAbertos, setAjustesAbertos] = useState(false);
  const [fontesManuaisAbertas, setFontesManuaisAbertas] = useState(false);

  // Refinar a busca (opcional)
  const [phoneInput, setPhoneInput] = useState('');
  // Toggle "economizar": com DDD identificado, tenta só o tribunal do estado dele primeiro e só
  // dispara os demais tribunais selecionados se essa primeira leva não achar nada — economiza
  // chamadas pagas da Infosimples. Ligado por padrão.
  const [economizarPorDdd, setEconomizarPorDdd] = useState(true);
  // Lemit (enriquecimento cadastral por CPF): automática por padrão, desligável em "Onde procurar".
  const [usarLemit, setUsarLemit] = useState(true);
  const [formError, setFormError] = useState('');

  // Search & Result states
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [tribunaisConsultados, setTribunaisConsultados] = useState<string[]>([]);
  const [custoEstimado, setCustoEstimado] = useState<number>(0);
  // Processos que a fonte encontrou mas o checkbox "somente autor" descartou (pesquisado é Réu) —
  // reportado à parte para não sumir em silêncio quando o usuário espera achar algo.
  const [descartadosPorPolo, setDescartadosPorPolo] = useState<{ numero: string; tribunal: string; autor?: string }[]>([]);
  const [scanItems, setScanItems] = useState<ScanItem[]>([]);
  const [scanClockTick, setScanClockTick] = useState(0);
  // Id da consulta em andamento (recebido no evento 'started' do streaming), usado para cancelar
  // um tribunal específico via POST /api/processos/cancelar sem afetar os demais.
  const consultaIdRef = useRef<string | null>(null);
  // No fluxo por número (Fluxo A), o evento do DataJud vem como "DataJud (CNJ)" sem o nome do
  // tribunal embutido — guarda o único tribunal-alvo da busca para rotear a sub-fonte certa no card.
  const targetTribunalRef = useRef<string>('');
  // Múltiplos documentos (botão "+" ao lado do documento): rodam em sequência, cada um como uma busca completa.
  // O ref permite interromper a fila assim que o usuário clicar em "cancelar busca" (lido de forma
  // síncrona entre um documento e o próximo, sem esperar o próximo render do state).
  const buscaCanceladaRef = useRef(false);
  // "Encerrar e ver resultados": interrompe os tribunais em andamento mas mostra o que já foi achado
  // (≠ cancelar, que descarta tudo e volta ao formulário).
  const buscaEncerradaRef = useRef(false);
  // Leitor do stream em andamento: se o servidor não fechar a consulta logo após o "encerrar" (o pedido pode cair
  // em outra instância, ou ele ainda espera DataJud/Lemit), a tela corta a leitura e mostra o que já chegou.
  const readerAtualRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const timerEncerrarRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [processosParciais, setProcessosParciais] = useState<ProcessoParcial[]>([]);
  const [varreduraIniciadaEm, setVarreduraIniciadaEm] = useState<number | null>(null);
  const [planoVarredura, setPlanoVarredura] = useState<string | null>(null);
  const [lemitEventos, setLemitEventos] = useState<LemitEvento[]>([]);
  const [documentoAtualIdx, setDocumentoAtualIdx] = useState(0);
  const [totalDocumentos, setTotalDocumentos] = useState(1);
  const [custoAcumulado, setCustoAcumulado] = useState(0);
  // Diálogo "continuar nos demais tribunais?" — aparece quando a economia por DDD achou algo já na
  // 1ª onda, mas ainda restam tribunais selecionados que não chegaram a ser consultados.
  const [perguntaContinuarOnda, setPerguntaContinuarOnda] = useState<{ tribunaisRestantes: string[] } | null>(null);
  const resolverContinuarOndaRef = useRef<((continuar: boolean) => void) | null>(null);
  // Tela de transição explícita entre o fim da varredura e a exibição do resultado (processando dados).
  const [processandoResultado, setProcessandoResultado] = useState(false);

  // Atualiza o cronômetro/% estimado de cada card de tribunal enquanto a varredura está em curso.
  useEffect(() => {
    if (!searching) return;
    const id = window.setInterval(() => setScanClockTick(t => t + 1), 150);
    return () => window.clearInterval(id);
  }, [searching]);

  // AI Summary state
  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState('');

  // Floating Chat Modal state (com 40% a mais de largura e altura)
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  // Painel flutuante "Em desenvolvimento": simula cada etapa do layout sem chamar a API.
  const [devSimOpen, setDevSimOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatEnded, setChatEnded] = useState(false);

  const found = hasSearched && !notFound && !!caseData;

  const detectedTribunal = useMemo(() => {
    return searchMode === 'numero' ? parseCnj(processNumberInput) : null;
  }, [searchMode, processNumberInput]);

  // Validações do formulário (tela única): dados da busca, onde procurar e refinamento opcional.
  // O campo de documento aceita CPF (11 dígitos) ou CNPJ (14), identificado pelo tamanho.
  const cpfInputDigits = cleanDigits(cpfInput);
  const isDocValid =
    (cpfInputDigits.length === 11 && isValidCpf(cpfInputDigits)) ||
    (cpfInputDigits.length === 14 && isValidCnpj(cpfInputDigits));
  const isProcessNumberValid = cleanDigits(processNumberInput).length === 20;
  const docLabel = cpfInputDigits.length === 14 ? 'CNPJ' : 'CPF';
  const tipoBusca: TipoBusca =
    searchMode === 'numero' ? 'numero' : searchMode === 'nome' ? 'nome' : cpfInputDigits.length === 14 ? 'cnpj' : 'cpf';

  // Onde procurar: fontes efetivas. Por número, o tribunal vem do CNJ e só há 2 fontes (DataJud e Infosimples).
  const aliasDatajudCnj = detectedTribunal?.datajudAlias ?? '';
  const servicosDoNumero = fontesInfosimplesDoTribunal(aliasDatajudCnj);
  // 2ª tentativa opcional por número: o DataJud não achou e o usuário pediu para buscar na Infosimples do
  // tribunal (paga). Nela o DataJud não é consultado de novo.
  const usaDatajudNumero = !!aliasDatajudCnj && datajudSel.includes(aliasDatajudCnj) && !infosimplesSegundaTentativa;
  const idsInfosimplesEfetivos =
    tipoBusca === 'numero'
      ? infosimplesSegundaTentativa
        ? servicosDoNumero.map(s => s.id)
        : visaoAdvogado
        ? servicosDoNumero.filter(s => infosimplesNumeroSel.includes(s.id)).map(s => s.id)
        : []
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
      ? custoTotal(servicosDoNumero.filter(s => idsInfosimplesEfetivos.includes(s.id)).map(s => s.service))
      : custoFontesSelecionadas(tipoBusca, infosimplesSel);
  const custoPrevisto = custoPrevistoPorDocumento * (tipoBusca === 'numero' ? 1 : qtdDocumentosValidos);
  const custoPrevistoLabel =
    tipoBusca === 'numero'
      ? custoPrevisto === 0
        ? 'Gratuito'
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
  // Celular opcional (da parte pesquisada): vazio é válido; se preenchido, exige DDD + número.
  const isStep4Valid = cleanDigits(phoneInput).length === 0 || cleanDigits(phoneInput).length >= 10;
  const formularioValido = isStep1Valid && isStep2Valid && isStep4Valid;
  // O que ainda falta para liberar "Consultar agora" (exibido ao lado do botão).
  const pendenciasFormulario = [
    searchMode === 'numero' && !isProcessNumberValid && 'número do processo (20 dígitos)',
    searchMode === 'nome' && partyNameInput.trim().length < 3 && 'nome da parte',
    searchMode === 'cpf' && fullName.trim().length < 3 && 'nome completo',
    searchMode === 'cpf' && !isDocValid && 'CPF ou CNPJ válido',
    searchMode !== 'cpf' && cpfInputDigits.length > 0 && !isDocValid && 'CPF/CNPJ válido (ou deixe em branco)',
    !isStep2Valid && 'ao menos uma fonte de consulta',
    !isStep4Valid && 'celular com DDD (ou deixe em branco)'
  ].filter((p): p is string => typeof p === 'string');

  // Dispara Confete com a paleta nobre estendida (Grey Olive, Charcoal, Gunmetal, Dourado e Porcelain)
  const triggerConfetti = () => {
    const colors = [
      '#999999',
      '#4A5878',
      '#2B3957',
      '#D5DEEE',
      '#4DA6FF',
      '#4DA6FF',
      '#C9D6EE',
      '#FFFFFF'
    ];

    confetti({
      particleCount: 277,
      spread: 75,
      origin: { y: 0.6 },
      colors
    });

    window.setTimeout(() => {
      confetti({
        particleCount: 184,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors
      });
      confetti({
        particleCount: 184,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors
      });
    }, 137);
  };

  // Busca completa para UM documento (CPF ou CNPJ) — usada tanto pelo documento principal quanto
  // por cada documento adicional (botão "+"), em sequência. Devolve os processos achados e o custo
  // real desta rodada; null se cancelada pelo usuário no meio do caminho.
  // `tribunaisForcados`: usado na 2ª chamada (depois que o usuário confirma "continuar buscando" no
  // diálogo pós-1ª-onda) — restringe os alvos a essa lista exata e desliga a divisão em ondas, já que
  // essa já É a continuação da 2ª onda.
  const executarBuscaDocumento = async (
    digits: string,
    tribunaisForcados?: string[]
  ): Promise<{
    processes: any[];
    custo: number;
    tribunaisConsultados: string[];
    tribunaisRestantes: string[];
    descartadosPorPolo: { numero: string; tribunal: string; autor?: string }[];
  } | null> => {
    const phoneDigits = cleanDigits(phoneInput);
    const isBuscaNumero = searchMode === 'numero';
    const cnjParsed = isBuscaNumero ? parseCnj(processNumberInput) : null;
    const scanStartedAt = Date.now();
    const usaInfosimples = isBuscaNumero ? idsInfosimplesEfetivos.length > 0 : true;
    const tjManual = estadoManual ? tribunalByUf(estadoManual) : null;
    const targets = isBuscaNumero
      ? cnjParsed?.tribunalLabel
        ? [cnjParsed.tribunalLabel]
        : []
      : tribunaisForcados ?? ordenarFontes(idsInfosimplesEfetivos, tjManual, extractDdd(phoneDigits));
    // No fluxo multi-tribunal, o DataJud só consegue confirmar um processo já achado pela Infosimples
    // (a API do CNJ não busca por CPF/CNPJ/nome) — mas a sub-fonte já nasce "pending" dentro do card,
    // deixando claro desde o início que as duas fontes vão trabalhar em paralelo assim que houver um
    // número de processo para consultar. No fluxo por número, as duas já têm o número e começam juntas.
    const usaDataJudAgora = isBuscaNumero ? usaDatajudNumero : datajudSel.length > 0;
    targetTribunalRef.current = isBuscaNumero ? cnjParsed?.tribunalLabel || '' : '';

    // Com a economia por estado ligada, quem decide a 1ª onda é o backend (lib/planoVarredura.ts: estado
    // manual > endereço na Lemit > DDD > região fiscal do CPF), e ele pode esperar a Lemit antes de começar.
    // Por isso todos nascem "aguardando"; cada tribunal vira "consultando" quando o evento real de início
    // chega, e o evento 'plano' traz o motivo e põe os tribunais da 1ª onda no topo da lista.
    const aguardaPlano = !isBuscaNumero && !tribunaisForcados && economizarPorDdd;

    const novosItens = targets.map((label): ScanItem => {
      const naPrimeiraOnda = !aguardaPlano;
      return {
        label,
        infosimples: usaInfosimples
          ? naPrimeiraOnda
            ? { status: 'loading', startedAt: scanStartedAt }
            : { status: 'pending' }
          : undefined,
        datajud: usaDataJudAgora
          ? isBuscaNumero
            ? { status: 'loading', startedAt: scanStartedAt }
            : { status: 'pending' }
          : undefined
      };
    });
    // Na 2ª chamada (continuar buscando nos tribunais restantes), mantém os cards da 1ª onda já
    // concluídos na tela, só acrescentando os novos — em vez de apagar tudo e recomeçar do zero.
    setScanItems(prev => (tribunaisForcados ? [...prev, ...novosItens] : novosItens));
    consultaIdRef.current = null;
    setVarreduraIniciadaEm(scanStartedAt);
    if (!tribunaisForcados) setPlanoVarredura(null);

    const res = await authFetch('/api/processos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documento: digits,
        nomeParte: searchMode === 'nome' ? partyNameInput.trim() : '',
        fullName: fullName.trim() || (isBuscaNumero ? 'Consulta por Número' : ''),
        phone: phoneDigits,
        // Só o estado escolhido à mão vai como "state": o DDD segue no phone, e o backend decide entre os sinais.
        state: estadoManual || 'AUTO',
        processNumber: isBuscaNumero ? processNumberInput : '',
        // Fontes de "Onde procurar": ids Infosimples (lista explícita) e endpoints DataJud (null = todos).
        // Na 2ª chamada (tribunaisForcados), restringe aos tribunais restantes e desliga a divisão em
        // ondas no backend — essa chamada já É a continuação da 2ª onda, não deve dividir de novo.
        tribunaisSelecionados: tribunaisForcados ?? idsInfosimplesEfetivos,
        datajudSelecionados: isBuscaNumero
          ? usaDatajudNumero
            ? [aliasDatajudCnj]
            : []
          : datajudSel.length === IDS_TODOS_DATAJUD.length
          ? null
          : datajudSel,
        somenteAutor,
        economizarPorDdd: tribunaisForcados ? false : economizarPorDdd,
        // A continuação da 2ª onda não repete a Lemit: o CPF pesquisado já foi consultado na 1ª chamada.
        usarLemit: tribunaisForcados ? false : usarLemit
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
    readerAtualRef.current = reader;
    const decoder = new TextDecoder();
    let buffer = '';
    let data: any = null;
    const processosRecebidos: any[] = [];

    try {
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
        } else if (evt.type === 'plano') {
          const primeira = new Set<string>(evt.primeiraOnda ?? []);
          if (!tribunaisForcados) {
            setScanItems(prev => [...prev].sort((a, b) => Number(!primeira.has(a.label)) - Number(!primeira.has(b.label))));
          }
          const qtdSegunda = evt.segundaOnda?.length ?? 0;
          setPlanoVarredura(
            evt.motivo ? `${evt.motivo}${qtdSegunda > 0 ? ` Os outros ${qtdSegunda} tribunais só serão consultados se nada for encontrado.` : ''}` : null
          );
        } else if (evt.type === 'processo' && evt.processo?.numero) {
          processosRecebidos.push(evt.processo);
          setProcessosParciais(prev => (prev.some(p => p.numero === evt.processo.numero) ? prev : [...prev, evt.processo]));
        } else if (evt.type === 'progress' && evt.fonte === 'lemit') {
          // Lemit não é um tribunal: fica num quadro próprio da tela de varredura, com o resumo e o custo.
          const r = evt.resumo;
          const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
          const detalhe = evt.found && r
            ? [
                r.nome,
                [plural(r.celulares + r.fixos, 'telefone', 'telefones'), plural(r.emails, 'e-mail', 'e-mails'), plural(r.enderecos, 'endereço', 'endereços')]
                  .concat(r.socios ? [plural(r.socios, 'sócio', 'sócios')] : [])
                  .join(', '),
                r.situacaoCpf ? `situação do CPF: ${r.situacaoCpf}` : null
              ]
                .filter(Boolean)
                .join(' · ')
            : evt.erro;
          const novo: LemitEvento = {
            label: evt.label,
            status: evt.status === 'loading' ? 'loading' : evt.found ? 'ok' : evt.erro ? 'erro' : 'vazio',
            detalhe: detalhe || undefined,
            custo: typeof evt.custo === 'number' ? evt.custo : undefined,
            descoberto: !!evt.descoberto
          };
          setLemitEventos(prev => (prev.some(e => e.label === novo.label) ? prev.map(e => (e.label === novo.label ? novo : e)) : [...prev, novo]));
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
              return { status, erro: evt.erro, erroTecnico: evt.erroTecnico, elapsedMs, custo: typeof evt.custo === 'number' ? evt.custo : undefined };
            };

            // O card do DataJud por um processo achado num tribunal que não tinha varredura própria
            // (não deveria acontecer hoje, mas por segurança) entra dinamicamente se for novo.
            if (!existe) {
              if (evt.status !== 'loading') return prev;
              const novoItem: ScanItem = { label: tribunalLabel, [chave]: novoProgresso(undefined) };
              return [...prev, novoItem];
            }

            let proximo = prev.map((item): ScanItem => {
              if (item.label !== tribunalLabel) return item;
              return { ...item, [chave]: novoProgresso(item[chave]) };
            });

            // Infosimples terminou sem achar nada neste tribunal: o DataJud deste card, se ainda
            // "pending" (esperando um número de processo que nunca vai existir), fecha como "sem achado".
            if (chave === 'infosimples' && evt.status !== 'loading' && !evt.found) {
              proximo = proximo.map((item): ScanItem =>
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
    } catch (streamErr) {
      if (buscaCanceladaRef.current) return null;
      if (!buscaEncerradaRef.current) {
        console.error('[ProcessTracker stream error]', streamErr);
        const err = new Error('A conexão com o servidor foi interrompida durante a busca. Tente novamente em instantes.');
        (err as any).streamInterrompida = true;
        throw err;
      }
    } finally {
      readerAtualRef.current = null;
      if (timerEncerrarRef.current) {
        clearTimeout(timerEncerrarRef.current);
        timerEncerrarRef.current = null;
      }
    }

    if (buscaCanceladaRef.current) return null;
    // Encerrada pelo usuário e o servidor não mandou o 'done' a tempo: resultado com os processos já recebidos.
    if (!data && buscaEncerradaRef.current) {
      data = { processes: processosRecebidos, notFound: processosRecebidos.length === 0, encerradaPeloUsuario: true };
    }
    if (!data) {
      throw new Error('Falha ao processar resposta do servidor.');
    }

    const processesEncontrados: any[] = data.notFound || !data.processes ? [] : data.processes;
    return {
      processes: processesEncontrados,
      custo: typeof data.custoEstimado === 'number' ? data.custoEstimado : 0,
      tribunaisConsultados: data.tribunaisConsultados || [],
      // Só relevante quando a 1ª onda JÁ achou algo (senão o backend já continua sozinho para a 2ª onda) e o
      // usuário não encerrou a busca de propósito.
      tribunaisRestantes:
        !data.encerradaPeloUsuario && processesEncontrados.length > 0 ? (data.tribunaisNaoConsultados as string[] | undefined) ?? [] : [],
      descartadosPorPolo: data.descartadosPorPolo || []
    };
  };

  // Envio do formulário e execução da busca. Documentos adicionais (botão "+")
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
    setDescartadosPorPolo([]);
    buscaCanceladaRef.current = false;
    buscaEncerradaRef.current = false;
    setProcessosParciais([]);
    setLemitEventos([]);
    setTotalDocumentos(documentosDigits.length || 1);
    setDocumentoAtualIdx(0);
    setCustoAcumulado(0);

    try {
      const todosProcessos: any[] = [];
      const todosTribunais = new Set<string>();
      const todosDescartadosPorPolo: { numero: string; tribunal: string; autor?: string }[] = [];
      let custoTotalAcumulado = 0;
      const fila = documentosDigits.length > 0 ? documentosDigits : [digits];

      for (let i = 0; i < fila.length; i++) {
        if (buscaCanceladaRef.current || buscaEncerradaRef.current) break;
        setDocumentoAtualIdx(i);
        const resultado = await executarBuscaDocumento(fila[i]);
        if (!resultado) break; // cancelado no meio desta rodada

        resultado.processes.forEach(p => todosProcessos.push(p));
        resultado.tribunaisConsultados.forEach(t => todosTribunais.add(t));
        resultado.descartadosPorPolo.forEach(d => todosDescartadosPorPolo.push(d));
        custoTotalAcumulado += resultado.custo;
        setCustoAcumulado(custoTotalAcumulado);

        // Economia por DDD já achou algo na 1ª onda, mas sobraram tribunais selecionados que não
        // chegaram a ser consultados — pergunta se o usuário quer continuar buscando neles também.
        if (resultado.tribunaisRestantes.length > 0 && !buscaCanceladaRef.current && !buscaEncerradaRef.current) {
          const continuar = await new Promise<boolean>(resolve => {
            resolverContinuarOndaRef.current = resolve;
            setPerguntaContinuarOnda({ tribunaisRestantes: resultado.tribunaisRestantes });
          });
          setPerguntaContinuarOnda(null);
          if (continuar && !buscaCanceladaRef.current) {
            const resultadoExtra = await executarBuscaDocumento(fila[i], resultado.tribunaisRestantes);
            if (resultadoExtra) {
              resultadoExtra.processes.forEach(p => todosProcessos.push(p));
              resultadoExtra.tribunaisConsultados.forEach(t => todosTribunais.add(t));
              resultadoExtra.descartadosPorPolo.forEach(d => todosDescartadosPorPolo.push(d));
              custoTotalAcumulado += resultadoExtra.custo;
              setCustoAcumulado(custoTotalAcumulado);
            }
          }
        }
      }

      // Cancelada pelo usuário: volta ao formulário sem mostrar resultado parcial — "cancelar" é
      // desistir da busca, não ver o que já tinha sido achado até aquele ponto.
      if (buscaCanceladaRef.current) {
        setSearching(false);
        return;
      }

      setTribunaisConsultados(Array.from(todosTribunais));
      setCustoEstimado(custoTotalAcumulado);
      setDescartadosPorPolo(todosDescartadosPorPolo);
      setProcessandoResultado(true);
      await new Promise(r => setTimeout(r, 900));

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

      // 2. Se encontrou processos, gera automaticamente o resumo por IA
      if (currentCases) {
        void fetchAiSummary(currentCases);
      }
    } catch (err: any) {
      console.error('[ProcessTracker search error]', err);
      const mensagem = err.message || 'Não foi possível consultar os processos no momento. Tente novamente.';
      setFormError(mensagem);
      setHasSearched(false);
      notifications.show({
        title: err.streamInterrompida ? 'Conexão interrompida' : 'Não foi possível concluir a busca',
        message: mensagem,
        color: 'yellow',
        icon: <AlertTriangle size={16} />,
        autoClose: 7000,
        styles: {
          root: { background: 'var(--tt-ink)', border: `1px solid ${BLUE}` },
          title: { color: BLUE_LIGHT },
          description: { color: TEXT },
          icon: { background: BLUE, color: '#FFFFFF' },
          closeButton: { color: MUTED }
        }
      });
    } finally {
      setSearching(false);
      setProcessandoResultado(false);
    }
  };

  // Encerra a varredura sem descartar nada: os tribunais ainda consultando são interrompidos (a 2ª onda e os
  // próximos documentos da fila não começam) e o resultado mostra o que já foi encontrado.
  // A busca roda só depois que o estado da 2ª tentativa entrou no render (handleFinalStepCompleted lê as fontes
  // efetivas do render atual).
  useEffect(() => {
    if (!refazerBusca) return;
    setRefazerBusca(false);
    // vale só para esta busca: a próxima pelo formulário volta ao padrão gratuito
    void handleFinalStepCompleted().finally(() => setInfosimplesSegundaTentativa(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refazerBusca]);

  // Outro número: volta ao padrão (só DataJud).
  useEffect(() => {
    setInfosimplesSegundaTentativa(false);
  }, [processNumberInput]);

  const handleEncerrarEVerResultados = () => {
    if (buscaEncerradaRef.current) return;
    buscaEncerradaRef.current = true;
    if (resolverContinuarOndaRef.current) {
      resolverContinuarOndaRef.current(false);
      resolverContinuarOndaRef.current = null;
      setPerguntaContinuarOnda(null);
    }
    // Dá ao servidor alguns segundos para fechar com o resultado completo; depois disso corta a leitura.
    timerEncerrarRef.current = setTimeout(() => {
      void readerAtualRef.current?.cancel().catch(() => {});
    }, 5000);
    const consultaId = consultaIdRef.current;
    if (!consultaId) return;
    void authFetch('/api/processos/cancelar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consultaId, encerrar: true })
    }).catch(() => {});
  };

  // Cancela a consulta inteira (todos os tribunais do documento atual + os próximos documentos da fila).
  const handleCancelarBuscaInteira = () => {
    buscaCanceladaRef.current = true;
    // Se o diálogo "continuar nos demais tribunais?" estiver aberto aguardando resposta, destrava-o
    // (senão o await ficaria pendurado para sempre, já que o usuário cancelou a busca por outro caminho).
    if (resolverContinuarOndaRef.current) {
      resolverContinuarOndaRef.current(false);
      resolverContinuarOndaRef.current = null;
      setPerguntaContinuarOnda(null);
    }
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

  // Simulador de etapas (ferramenta de desenvolvimento): pula direto para qualquer tela do fluxo de
  // busca com dados fictícios, sem chamar a API — usado para revisar/demonstrar o layout de cada fase.
  const simularScanItemsDemo = (): ScanItem[] => [
    { label: 'TJSP', infosimples: { status: 'found', elapsedMs: 3100 }, datajud: { status: 'found', elapsedMs: 3100 } },
    { label: 'TJSP 2º', infosimples: { status: 'loading', startedAt: Date.now() - 7500 } },
    { label: 'TJSP eproc', infosimples: { status: 'loading', startedAt: Date.now() - 7500 } },
    { label: 'TJRJ', infosimples: { status: 'found', elapsedMs: 2400 }, datajud: { status: 'found', elapsedMs: 2400 } },
    { label: 'TJRJ portal', infosimples: { status: 'loading', startedAt: Date.now() - 7500 } },
    { label: 'TJMG', infosimples: { status: 'not-found', elapsedMs: 7200 } },
    { label: 'TJPR', infosimples: { status: 'not-found', elapsedMs: 6300 } },
    { label: 'TRF3', infosimples: { status: 'error', erro: 'Tempo de resposta excedido', elapsedMs: 9400 } },
    { label: 'TJSC', infosimples: { status: 'cancelled' } },
    { label: 'TJBA', infosimples: { status: 'pending' } },
    { label: 'TJPE', infosimples: { status: 'pending' } },
    { label: 'TJRS', infosimples: { status: 'pending' } },
    { label: 'TJCE', infosimples: { status: 'pending' } },
    { label: 'TJDFT', infosimples: { status: 'pending' } }
  ];

  const simularEtapa = (etapa: 'formulario' | 'varrendo' | 'organizando' | 'nao-encontrado' | 'resultado') => {
    setSearching(false);
    setHasSearched(false);
    setNotFound(false);
    setProcessandoResultado(false);
    setCaseData(null);
    setFormError('');

    switch (etapa) {
      case 'formulario':
        break;
      case 'varrendo':
        setScanItems(simularScanItemsDemo());
        setSearching(true);
        setPlanoVarredura('Começando por TJSP: endereço mais recente na Lemit é em SP. Os outros 13 tribunais só serão consultados se nada for encontrado.');
        setProcessosParciais([{ numero: '1001234-56.2023.8.26.0100', tribunal: 'TJSP', tipo: 'Procedimento Comum Cível' }]);
        setLemitEventos([{ label: 'Lemit · CPF ***.456.789-**', status: 'ok', detalhe: 'Maria Silva · 3 telefones, 1 e-mail, 2 endereços', custo: 0.35 }]);
        break;
      case 'organizando':
        setScanItems(simularScanItemsDemo());
        setSearching(true);
        setProcessandoResultado(true);
        break;
      case 'nao-encontrado':
        setTribunaisConsultados(['TJSP', 'TJRJ', 'TJMG']);
        setCustoEstimado(1.5);
        setHasSearched(true);
        setNotFound(true);
        break;
      case 'resultado': {
        const demoData = buildCaseData();
        setCaseData(demoData);
        setHasSearched(true);
        setTribunaisConsultados(['TJSP', 'TJRJ']);
        setCustoEstimado(2.3);
        void fetchAiSummary(demoData);
        break;
      }
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
            'Olá! Sou o assistente jurídico da TechTie. Pode me contar o que está acontecendo? Se tiver número de processo ou documentos, pode compartilhar aqui também.'
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
        fontFamily: 'var(--font-inter-tight), sans-serif'
      }}
    >
      {/* Container principal */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          padding: 'clamp(20px, 4vw, 40px) clamp(16px, 3vw, 32px)',
          minHeight: '100vh',
          width: '100%',
          maxWidth: 1400,
          margin: '0 auto',
          boxSizing: 'border-box'
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: 24,
            alignItems: 'start',
            width: '100%'
          }}
        >
          {/* COLUNA 1: FLUXO DE CONSULTA (FORMULÁRIO / VARREDURA / RESULTADOS) */}
          <div style={{ minWidth: 0, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* ═════════════════════════════════════════════════════════════════
                FASE 1: FORMULÁRIO DE PESQUISA (TELA ÚNICA)
                ═════════════════════════════════════════════════════════════════ */}
        {!hasSearched && (
          <div style={{ width: '100%', maxWidth: searching ? 900 : 780, animation: 'bf-fadein 0.5s ease both' }}>
            {formError && (
              <div
                style={{
                  background: 'rgba(138,58,58,0.9)',
                  color: 'var(--tt-text)',
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

            {searching && processandoResultado ? (
              <div
                style={{
                  background: 'rgb(var(--bf-ink-rgb) / 0.88)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  padding: '56px 32px',
                  borderRadius: 10,
                  textAlign: 'center',
                  boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                  border: `1px solid ${BORDER}`
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    margin: '0 auto 18px',
                    borderRadius: '50%',
                    border: `3px solid ${BORDER}`,
                    borderTopColor: BLUE,
                    animation: 'bf-spin 0.8s linear infinite'
                  }}
                />
                <h3 style={{ margin: '0 0 8px', fontSize: 18, color: TEXT, fontWeight: 600 }}>
                  Organizando as informações encontradas...
                </h3>
                <p style={{ margin: 0, fontSize: 13.5, color: MUTED }}>
                  Consolidando os processos localizados e preparando o resumo do resultado.
                </p>
              </div>
            ) : searching ? (
              <div
                style={{
                  background: 'rgb(var(--bf-ink-rgb) / 0.88)',
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
                  {searchMode === 'numero' ? 'Realizando nossa pesquisa...' : 'Consultando andamentos processuais...'}
                </h3>
                <p style={{ margin: '0 0 20px', fontSize: 13.5, color: MUTED }}>
                  {searchMode === 'numero'
                    ? 'Consultando os sistemas judiciais para trazer o andamento completo e atualizado.'
                    : `Consultamos os sistemas oficiais dos tribunais. Os processos aparecem abaixo assim que são identificados.`}
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
                  <CronometroVarredura inicio={varreduraIniciadaEm} />
                  <button
                    type="button"
                    onClick={handleEncerrarEVerResultados}
                    title="Interrompe os tribunais que ainda estão consultando e mostra o que já foi encontrado"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'transparent',
                      border: `1px solid ${BLUE}`,
                      color: BLUE_LIGHT,
                      borderRadius: 4,
                      padding: '6px 14px',
                      fontSize: 12,
                      letterSpacing: 0.3,
                      cursor: 'pointer'
                    }}
                  >
                    <ListChecks size={14} strokeWidth={2} />
                    ENCERRAR E VER RESULTADOS
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelarBuscaInteira}
                    className="bf-btn-sec bf-btn-perigo"
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
                        : 'Nenhum registro encontrado para este processo...'
                      : dataJudPendente && tribunalPendente
                      ? `Consultando os sistemas oficiais do ${item?.label || 'tribunal'}...`
                      : dataJudPendente
                      ? 'Consultando registros e andamentos oficiais...'
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
                            background: 'rgb(var(--bf-fg) / 0.08)',
                            overflow: 'hidden',
                            position: 'relative'
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${pct}%`,
                              background: todasConcluidas
                                ? algumEncontrado
                                  ? MOSS_GREEN
                                  : RUBY_RED
                                : algumAtrasado
                                ? WARN
                                : BLUE,
                              borderRadius: 3,
                              transition: 'width 0.4s ease, background-color 0.4s ease'
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
                          background: 'rgb(var(--bf-fg) / 0.08)',
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
                        {doneCount}/{scanItems.length} tribunais consultados · {pct}%
                      </div>
                    </div>
                  );
                })()}

                {planoVarredura && (
                  <p style={{ maxWidth: 560, margin: '-12px auto 16px', fontSize: 12, color: MUTED, textAlign: 'left', lineHeight: 1.5 }}>
                    {planoVarredura}
                  </p>
                )}

                {lemitEventos.length > 0 && (
                  <div
                    style={{
                      maxWidth: 560,
                      margin: '0 auto 14px',
                      textAlign: 'left',
                      border: `1px solid ${BORDER}`,
                      borderRadius: 6,
                      padding: '10px 12px',
                      background: 'rgb(var(--bf-fg) / 0.03)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6
                    }}
                  >
                    {lemitEventos.map(e => (
                      <div key={e.label} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12, color: TEXT, minWidth: 0 }}>
                        <Fingerprint
                          size={13}
                          style={{
                            flexShrink: 0,
                            position: 'relative',
                            top: 2,
                            color: e.status === 'ok' ? MOSS_GREEN : e.status === 'erro' ? WARN : e.status === 'loading' ? BLUE : MUTED
                          }}
                        />
                        <span style={{ minWidth: 0 }}>
                          <strong style={{ fontWeight: 600 }}>{e.label.replace(/^Lemit ·\s*/i, 'Confirmação cadastral · ')}</strong>
                          {e.descoberto ? <span style={{ color: MUTED }}> (documento identificado nos autos)</span> : null}
                          <span style={{ color: MUTED }}>
                            {' · '}
                            {e.status === 'loading'
                              ? 'consultando...'
                              : e.status === 'vazio'
                              ? 'sem dados'
                              : e.detalhe || (e.status === 'erro' ? 'falha na consulta' : 'dados encontrados')}
                            {e.status !== 'loading' && typeof e.custo === 'number' ? ` · ${formatarReais(e.custo)}` : ''}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {processosParciais.length > 0 && (
                  <div
                    style={{
                      maxWidth: 560,
                      margin: '0 auto 18px',
                      textAlign: 'left',
                      border: `1px solid ${MOSS_GREEN}`,
                      borderRadius: 6,
                      padding: '10px 12px',
                      background: 'rgba(61,107,79,0.10)'
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircle2 size={14} style={{ color: MOSS_GREEN }} />
                      Encontrados até agora ({processosParciais.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                      {processosParciais.map(p => (
                        <div key={p.numero} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12, color: TEXT, minWidth: 0 }}>
                          <FileText size={12} style={{ color: MUTED, flexShrink: 0, position: 'relative', top: 1 }} />
                          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{p.numero}</span>
                          <span style={{ color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            · {p.tribunal}
                            {p.tipo ? ` · ${p.tipo}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {scanItems.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      textAlign: 'left',
                      maxWidth: 560,
                      margin: '0 auto'
                    }}
                  >
                    {scanItems.map(item => (
                      <ScanRow key={item.label} item={item} />
                    ))}
                  </div>
                )}
                  </>
                )}
              </div>
            ) : (
              <>
              <MotionConfig reducedMotion="user">
              <motion.form
                initial="oculto"
                animate="visivel"
                variants={formEntradaVariants}
                noValidate
                onSubmit={e => {
                  e.preventDefault();
                  if (formularioValido) void handleFinalStepCompleted();
                }}
                style={{
                  background: 'rgb(var(--bf-surface-rgb) / 0.92)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: `1px solid ${BORDER}`,
                  borderRadius: 14,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                  overflow: 'hidden',
                  textAlign: 'left'
                }}
              >
                <motion.div variants={formEntradaVariants} style={{ padding: 'clamp(20px, 4vw, 26px)', display: 'flex', flexDirection: 'column', gap: 22 }}>
                  <motion.header variants={secaoEntradaVariants}>
                    <div style={{ fontSize: 12, color: BLUE, fontWeight: 600, marginBottom: 6 }}>Nova consulta</div>
                    <h2 style={{ margin: '0 0 6px', fontSize: 'clamp(19px, 3.2vw, 22px)', color: TEXT, fontWeight: 700, letterSpacing: -0.3 }}>
                      {isConsultante || visaoAdvogado ? 'Encontre processos de uma pessoa ou empresa' : 'Consulte um processo pelo número'}
                    </h2>
                    <p style={{ margin: 0, fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>
                      {isConsultante
                        ? 'Você consulta os processos ligados ao seu próprio CPF ou CNPJ.'
                        : 'Informe os dados abaixo. A gente cuida de procurar nos lugares certos.'}
                    </p>
                  </motion.header>

                  {!isConsultante && (
                    <motion.div variants={secaoEntradaVariants}>
                      <h3 style={tituloBlocoStyle}>Como você quer buscar?</h3>
                      <div role="radiogroup" aria-label="Como você quer buscar" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
                        <OpcaoBusca
                          ativa={searchMode === 'numero'}
                          onClick={() => setSearchMode('numero')}
                          icone={<FileText size={15} />}
                          titulo="Por número do processo"
                          subtitulo="Busca gratuita"
                        />
                        <OpcaoBusca
                          ativa={searchMode === 'cpf'}
                          onClick={() => visaoAdvogado && setSearchMode('cpf')}
                          desabilitada={!visaoAdvogado}
                          icone={visaoAdvogado ? <UserRound size={15} /> : <Lock size={15} />}
                          titulo="Por pessoa ou empresa"
                          subtitulo={visaoAdvogado ? 'Nome e CPF ou CNPJ' : 'Disponível para advogados'}
                        />
                        {visaoAdvogado && (
                          <OpcaoBusca
                            ativa={searchMode === 'nome'}
                            onClick={() => isPagante && setSearchMode('nome')}
                            desabilitada={!isPagante}
                            icone={isPagante ? <Search size={15} /> : <Lock size={15} />}
                            titulo="Por nome da parte"
                            subtitulo={isPagante ? 'Sem documento, só o nome' : 'Disponível para assinantes'}
                          />
                        )}
                      </div>
                    </motion.div>
                  )}

                  <motion.div variants={secaoEntradaVariants} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
                    <Revelar aberto={!isConsultante && searchMode === 'numero'} style={{ gridColumn: '1 / -1' }}>
                        <CampoTexto
                          id="campo-cnj"
                          rotulo="Número do processo"
                          valor={processNumberInput}
                          onChange={v => setProcessNumberInput(formatProcessNumber(v))}
                          placeholder="0000000-00.0000.0.00.0000"
                          monoespacado
                          maxLength={25}
                          inputMode="numeric"
                          autoFocus
                          ok={isProcessNumberValid}
                          erro={
                            cleanDigits(processNumberInput).length > 0 && cleanDigits(processNumberInput).length < 20
                              ? `Faltam ${20 - cleanDigits(processNumberInput).length} dígitos (${cleanDigits(processNumberInput).length}/20).`
                              : null
                          }
                          dica={
                            detectedTribunal?.valido
                              ? `Tribunal identificado: ${detectedTribunal.tribunalLabel} (${detectedTribunal.tribunalNome}).`
                              : 'Encontrado em qualquer documento do processo'
                          }
                        />
                    </Revelar>

                    {searchMode === 'nome' ? (
                      <motion.div key="campo-nome-parte" {...trocaSuave} style={{ gridColumn: '1 / -1' }}>
                        <CampoTexto
                          id="campo-nome-parte"
                          rotulo="Nome da parte"
                          valor={partyNameInput}
                          onChange={v => {
                            setPartyNameInput(v);
                            setFullName(v);
                          }}
                          placeholder="Como aparece no processo"
                          autoFocus
                          ok={partyNameInput.trim().length >= 3}
                          dica="Use o nome completo para evitar homônimos"
                        />
                      </motion.div>
                    ) : (
                      <motion.div key="campo-nome" {...trocaSuave} style={{ minWidth: 0 }}>
                      <CampoTexto
                        id="campo-nome"
                        rotulo="Nome completo"
                        opcional={searchMode === 'numero' && !isConsultante}
                        valor={fullName}
                        onChange={setFullName}
                        placeholder="Como aparece no documento"
                        autoFocus={!isConsultante && searchMode === 'cpf'}
                        ok={fullName.trim().length >= 3}
                        dica="Ajuda a confirmar a pessoa certa"
                      />
                      </motion.div>
                    )}

                    <CampoTexto
                      id="campo-documento"
                      rotulo={isConsultante ? 'Seu CPF ou CNPJ' : 'CPF ou CNPJ'}
                      opcional={!isConsultante && searchMode !== 'cpf'}
                      ajuda={isConsultante ? 'Definido no seu cadastro.' : undefined}
                      travado={isConsultante}
                      valor={cpfInput}
                      onChange={v => setCpfInput(formatDocumento(v))}
                      placeholder="000.000.000-00"
                      maxLength={18}
                      inputMode="numeric"
                      disabled={isConsultante}
                      ok={isDocValid}
                      erro={
                        !isDocValid && cpfInputDigits.length >= 11
                          ? cpfInputDigits.length === 11 || cpfInputDigits.length === 14
                            ? `${docLabel} inválido. Confira os números.`
                            : 'O CPF tem 11 dígitos e o CNPJ tem 14.'
                          : null
                      }
                      dica="Só números, a gente formata"
                    />
                  </motion.div>

                  {/* Documentos extras do mesmo titular: só na visão de advogado. */}
                  <Revelar aberto={visaoAdvogado && !isConsultante && searchMode !== 'numero'} style={{ marginTop: -6 }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <AnimatePresence initial={false}>
                      {extraDocsInput.map((doc, i) => {
                        const digits = cleanDigits(doc);
                        const valido = (digits.length === 11 && isValidCpf(digits)) || (digits.length === 14 && isValidCnpj(digits));
                        return (
                          <motion.div
                            key={i}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
                            exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
                            transition={TRANSICAO_SUAVE}
                            style={{ overflow: 'hidden' }}
                          >
                          <div style={{ paddingBottom: 12 }}>
                          <CampoTexto
                            id={`campo-documento-extra-${i}`}
                            rotulo={`Outro documento do titular (${i + 2})`}
                            valor={doc}
                            onChange={v => setExtraDocsInput(prev => prev.map((d, idx) => (idx === i ? formatDocumento(v) : d)))}
                            placeholder="CPF ou CNPJ"
                            maxLength={18}
                            inputMode="numeric"
                            ok={valido}
                            erro={!valido && digits.length >= 11 ? 'Documento inválido. Confira os números.' : null}
                            dica="Roda como uma busca própria, em sequência; o custo soma por documento"
                            acao={
                              <button
                                type="button"
                                className="bf-btn-sec"
                                onClick={() => setExtraDocsInput(prev => prev.filter((_, idx) => idx !== i))}
                                aria-label={`Remover documento ${i + 2}`}
                                style={botaoIconeStyle}
                              >
                                <X size={16} />
                              </button>
                            }
                          />
                          </div>
                          </motion.div>
                        );
                      })}
                      </AnimatePresence>
                      <button type="button" onClick={() => setExtraDocsInput(prev => [...prev, ''])} style={linkAcaoStyle}>
                        <Plus size={14} /> Adicionar outro documento do mesmo titular
                      </button>
                    </div>
                  </Revelar>

                  {/* Escolha manual de fontes (só na visão do advogado; o resumo "Onde vamos procurar" foi removido) */}
                  <motion.div variants={secaoEntradaVariants}>
                    {visaoAdvogado && searchMode !== 'numero' && (
                      <button type="button" onClick={() => setFontesManuaisAbertas(v => !v)} style={linkAcaoStyle}>
                        <SlidersHorizontal size={14} /> {fontesManuaisAbertas ? 'Ocultar escolha de fontes' : 'Escolher fontes manualmente'}
                      </button>
                    )}
                    <Revelar aberto={visaoAdvogado && (fontesManuaisAbertas || searchMode === 'numero')}>
                      <div style={{ paddingTop: 12 }}>
                        <FontesSelector
                          tipoBusca={tipoBusca}
                          detectado={detectedTribunal}
                          infosimplesSel={tipoBusca === 'numero' ? infosimplesNumeroSel : infosimplesSel}
                          onInfosimplesChange={tipoBusca === 'numero' ? setInfosimplesNumeroSel : setInfosimplesSel}
                          datajudSel={datajudSel}
                          onDatajudChange={setDatajudSel}
                          lemitAtivo={usarLemit}
                          onLemitChange={setUsarLemit}
                        />
                      </div>
                    </Revelar>
                  </motion.div>

                  {/* Ajustes opcionais (recolhível) */}
                  <motion.div variants={secaoEntradaVariants} style={{ ...painelStyle, padding: 0 }}>
                    <button
                      type="button"
                      onClick={() => setAjustesAbertos(v => !v)}
                      aria-expanded={ajustesAbertos}
                      aria-controls="ajustes-opcionais"
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        background: 'transparent',
                        border: 'none',
                        color: TEXT,
                        padding: '14px 16px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'inherit'
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>Ajustes opcionais</span>
                        <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: MUTED }}>
                          {visaoAdvogado ? 'Papel no processo, celular, estado inicial e economia' : 'Papel no processo, celular e economia'}
                        </span>
                      </span>
                      <motion.span
                        animate={{ rotate: ajustesAbertos ? 180 : 0 }}
                        transition={TRANSICAO_SUAVE}
                        style={{ display: 'inline-flex', flexShrink: 0, color: MUTED }}
                      >
                        <ChevronDown size={16} />
                      </motion.span>
                    </button>
                    <Revelar aberto={ajustesAbertos} id="ajustes-opcionais">
                      <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div>
                          <span style={rotuloCampoStyle}>Papel no processo</span>
                          <SegmentedControl
                            fullWidth
                            classNames={{ control: 'bf-seg-igual-control', label: 'bf-seg-igual-label' }}
                            value={somenteAutor ? 'autor' : 'qualquer'}
                            onChange={v => setSomenteAutor(v === 'autor')}
                            data={[
                              { label: 'Qualquer papel', value: 'qualquer' },
                              { label: 'Só como autor', value: 'autor' }
                            ]}
                          />
                          <span style={{ display: 'block', marginTop: 6, fontSize: 11.5, color: MUTED }}>
                            {somenteAutor ? 'Oculta processos em que a pessoa é ré ou parte contrária.' : 'Mostra processos em que a pessoa é autora ou ré.'}
                          </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                          <CampoTexto
                            id="campo-celular"
                            rotulo="Celular da pessoa"
                            opcional
                            valor={phoneInput}
                            onChange={v => setPhoneInput(formatPhone(v))}
                            placeholder="(00) 00000-0000"
                            maxLength={15}
                            inputMode="tel"
                            ok={cleanDigits(phoneInput).length >= 10}
                            erro={!isStep4Valid && cleanDigits(phoneInput).length > 0 ? 'Informe o DDD e os 9 dígitos.' : null}
                            dica="O DDD ajuda a começar pelo estado certo"
                          />

                          {visaoAdvogado && tipoBusca !== 'numero' && (
                            <motion.div {...trocaSuave} style={{ minWidth: 0 }}>
                              <label htmlFor="campo-estado" style={rotuloCampoStyle}>
                                Começar pelo estado <span style={seloOpcionalStyle}>opcional</span>
                              </label>
                              <select
                                id="campo-estado"
                                className="bf-input bf-input-sem-icone"
                                value={estadoManual}
                                onChange={e => setEstadoManual(e.target.value)}
                                style={{ color: estadoManual ? TEXT : MUTED }}
                              >
                                <option value="">Automático</option>
                                {ESTADOS_BRASIL.map(est => (
                                  <option key={est.uf} value={est.uf}>
                                    {est.uf} — {est.nome} ({est.tj})
                                  </option>
                                ))}
                              </select>
                              <span style={{ display: 'block', marginTop: 6, fontSize: 11.5, color: MUTED }}>
                                {estadoManual ? `Começa pelo ${tribunalByUf(estadoManual)}` : 'Pelo endereço cadastral, DDD ou região do documento'}
                              </span>
                            </motion.div>
                          )}
                        </div>

                        <Revelar aberto={tipoBusca !== 'numero'} style={{ marginTop: -16 }}>
                          <div style={{ paddingTop: 16 }}>
                          <LinhaSwitch
                            titulo="Economizar"
                            descricao="Começa pelo estado mais provável e só consulta os outros tribunais se nada for encontrado."
                            checked={economizarPorDdd}
                            onChange={setEconomizarPorDdd}
                          />
                          </div>
                        </Revelar>
                      </div>
                    </Revelar>
                  </motion.div>
                </motion.div>

                <motion.footer
                  variants={secaoEntradaVariants}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    flexWrap: 'wrap',
                    padding: '16px clamp(20px, 4vw, 26px)',
                    borderTop: `1px solid ${BORDER}`,
                    background: 'rgb(var(--bf-fg) / 0.02)'
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: MUTED }}>Custo estimado</div>
                    <div style={{ fontSize: 19, color: custoPrevisto === 0 ? '#12A37A' : TEXT, fontWeight: 700 }}>{custoPrevistoLabel}</div>
                  </div>
                  <button
                    type="submit"
                    className="bf-btn-ouro"
                    disabled={!formularioValido}
                    title={pendenciasFormulario.length > 0 ? `Falta: ${pendenciasFormulario.join(', ')}` : undefined}
                    style={{
                      ...primaryButtonStyle,
                      letterSpacing: 0,
                      fontSize: 14,
                      fontWeight: 600,
                      padding: '12px 22px',
                      borderRadius: 8,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      ...(formularioValido
                        ? {}
                        : {
                            background: 'rgb(var(--bf-fg) / 0.03)',
                            color: 'rgb(var(--bf-fg) / 0.4)',
                            border: `1px solid ${INPUT_BORDER}`,
                            boxShadow: 'none',
                            cursor: 'not-allowed'
                          })
                    }}
                  >
                    Pesquisar processos <ArrowRight size={16} />
                  </button>
                </motion.footer>
              </motion.form>
              </MotionConfig>
              </>
            )}
          </div>
        )}

        {/* ═════════════════════════════════════════════════════════════════
            FASE 2: NENHUM PROCESSO ENCONTRADO
            ═════════════════════════════════════════════════════════════════ */}
        {hasSearched && notFound && <DescartadosPorPoloAviso itens={descartadosPorPolo} />}
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
                    background: 'rgb(var(--bf-fg) / 0.08)',
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
              A consulta automática para {searchMode === 'numero' ? `o processo ${processNumberInput || 'informado'}` : searchMode === 'nome' ? `o nome ${partyNameInput || 'informado'}` : `o ${docLabel} ${cpfInput || 'informado'}`} não retornou processos públicos ativos no tribunal consultado ({tribunaisConsultados.join(', ') || estadoManual}).
              Isso não significa que não existam pendências, pois processos em segredo de justiça ou em outros estados exigem verificação especializada.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <button
                onClick={() => setInfoModalOpen(true)}
                className="bf-btn-ouro"
                style={{ ...primaryButtonStyle, padding: '13px 28px', fontWeight: 400, letterSpacing: 1 }}
              >
                PRECISO DE AUXÍLIO JURÍDICO
              </button>
              {searchMode === 'numero' &&
                idsInfosimplesEfetivos.length === 0 &&
                servicosDoNumero.length > 0 &&
                numeroTentadoNaInfosimples !== processNumberInput && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setNotFound(false);
                      setNumeroTentadoNaInfosimples(processNumberInput);
                      setInfosimplesSegundaTentativa(true);
                      setRefazerBusca(true);
                    }}
                    className="bf-btn-sec"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'rgb(var(--bf-fg) / 0.06)',
                      border: `1px solid ${BORDER}`,
                      borderRadius: 4,
                      color: TEXT,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '10px 18px'
                    }}
                  >
                    <Search size={15} strokeWidth={1.8} />
                    Buscar direto no portal do {detectedTribunal?.tribunalLabel ?? 'tribunal'} ·{' '}
                    {formatarReais(custoTotal(servicosDoNumero.map(s => s.service)))}
                  </button>
                  <span style={{ fontSize: 12, color: MUTED, textAlign: 'center', maxWidth: 420 }}>
                    Opcional. Realize uma consulta aprofundada diretamente no sistema eletrônico do tribunal.
                  </span>
                </div>
              )}
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
                  className="bf-btn-sec"
                  style={{
                    background: 'rgb(var(--bf-fg) / 0.08)',
                    border: `1px solid ${BORDER}`,
                    borderRadius: 4,
                    color: 'var(--tt-text)',
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
                  className="bf-btn-sec"
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
        {found && caseData && <DescartadosPorPoloAviso itens={descartadosPorPolo} />}
        {found && caseData && (
          <ProcessResultView
            fullName={fullName || 'Cliente'}
            cpf={cpfInput}
            phone={phoneInput}
            caseData={caseData}
            tribunaisConsultados={tribunaisConsultados}
            fontes={scanItems.map(i => ({ label: i.label, status: statusGeralDoItem(i) }))}
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

        </div>
      </div>

      {/* Diálogo pequeno: economia por DDD já achou algo na 1ª onda, mas sobraram tribunais
          selecionados sem consultar — pergunta se continua ou para por aqui com o que já foi achado. */}
      {perguntaContinuarOnda && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 70,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24
          }}
        >
          <div
            role="dialog"
            aria-label="Continuar buscando nos demais tribunais?"
            style={{
              width: 'min(420px, 100%)',
              background: 'var(--tt-ink)',
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: '24px 26px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.45)'
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 16, color: TEXT, fontWeight: 600 }}>
              Processo encontrado no tribunal do DDD
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
              Já localizamos processos no tribunal do DDD informado. Ainda restam{' '}
              <strong style={{ color: TEXT }}>
                {perguntaContinuarOnda.tribunaisRestantes.length}{' '}
                {perguntaContinuarOnda.tribunaisRestantes.length === 1 ? 'tribunal' : 'tribunais'}
              </strong>{' '}
              selecionado{perguntaContinuarOnda.tribunaisRestantes.length === 1 ? '' : 's'} sem consultar. Quer continuar
              buscando neles também ou ver só o que já foi encontrado?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                className="bf-btn-sec"
                type="button"
                onClick={() => {
                  resolverContinuarOndaRef.current?.(false);
                  resolverContinuarOndaRef.current = null;
                }}
                style={{
                  background: 'transparent',
                  border: `1px solid ${BORDER}`,
                  color: TEXT,
                  padding: '9px 16px',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  borderRadius: 6
                }}
              >
                Ver só o já achado
              </button>
              <button
                type="button"
                onClick={() => {
                  resolverContinuarOndaRef.current?.(true);
                  resolverContinuarOndaRef.current = null;
                }}
                className="bf-btn-ouro"
                style={{
                  background: 'linear-gradient(135deg, #1E7CF2 0%, var(--tt-accent-2) 100%)',
                  border: '1px solid rgb(var(--bf-fg) / 0.4)',
                  color: 'var(--tt-base)',
                  fontWeight: 700,
                  padding: '9px 16px',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  borderRadius: 6,
                  boxShadow: '0 4px 14px rgba(63, 160, 255,0.3)'
                }}
              >
                Continuar buscando
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════
          MODAL DE AJUDA / FALAR COM A IA (+40% LARGURA E ALTURA)
          ═════════════════════════════════════════════════════════════════ */}
      {infoModalOpen && (
        <div
          onClick={() => setInfoModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgb(var(--bf-surface-rgb) / 0.6)',
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
                <div style={{ fontSize: 11, color: BLUE_LIGHT, marginTop: 4 }}>TechTie & Defesa Patrimonial</div>
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
                Como a TechTie atua em processos e cobranças?
              </h3>
              <p style={{ margin: 0, fontSize: 14, color: TEXT, lineHeight: 1.8 }}>
                Mesmo quando um processo ainda não aparece nos registros públicos abertos do tribunal, ordens de penhora, execuções fiscais ou medidas de constrição de bens podem estar em trâmite sigiloso ou em vias de citação.
              </p>
              <div
                style={{
                  background: 'rgb(var(--bf-fg) / 0.04)',
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
                background: 'rgb(var(--bf-fg) / 0.04)',
                borderTop: `1px solid ${BORDER}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <button
                onClick={() => setInfoModalOpen(false)}
                className="bf-btn-sec"
                style={{ background: 'transparent', border: `1px solid ${BORDER}`, color: TEXT, padding: '10px 20px', fontSize: 12, cursor: 'pointer' }}
              >
                FECHAR
              </button>
              <button
                onClick={() => {
                  setInfoModalOpen(false);
                  openChat();
                }}
                className="bf-btn-ouro"
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
          background: 'rgb(var(--bf-surface-rgb) / 0.6)',
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
              <div style={{ fontSize: 11, color: BLUE_LIGHT, marginTop: 3 }}>TechTie</div>
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
                    background: 'rgb(var(--bf-fg) / 0.05)',
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
              background: 'rgb(var(--bf-fg) / 0.04)',
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
              className="bf-btn-ouro"
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

      <DevStageSimulator open={devSimOpen} onOpenChange={setDevSimOpen} onSimular={simularEtapa} />
    </div>
  );
}

/** Botão flutuante "Em desenvolvimento": abre um painel para pular direto para qualquer etapa do layout. */
function DevStageSimulator({
  open,
  onOpenChange,
  onSimular
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSimular: (etapa: 'formulario' | 'varrendo' | 'organizando' | 'nao-encontrado' | 'resultado') => void;
}) {
  const ETAPAS: { etapa: Parameters<typeof onSimular>[0]; label: string }[] = [
    { etapa: 'formulario', label: 'Formulário de pesquisa' },
    { etapa: 'varrendo', label: 'Varrendo bases judiciais' },
    { etapa: 'organizando', label: 'Organizando informações (transição)' },
    { etapa: 'nao-encontrado', label: 'Nenhum processo localizado' },
    { etapa: 'resultado', label: 'Resultado com processos' }
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label="Simular etapas do layout (ferramenta de desenvolvimento)"
        style={{
          position: 'fixed',
          left: 76,
          bottom: 20,
          zIndex: 400,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'rgb(var(--bf-ink-rgb) / 0.92)',
          border: `1px solid ${BORDER}`,
          color: BLUE_LIGHT,
          cursor: 'pointer',
          boxShadow: '0 10px 24px -8px rgba(0,0,0,0.6)'
        }}
      >
        <FlaskConical size={20} strokeWidth={1.8} />
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            left: 76,
            bottom: 72,
            zIndex: 400,
            width: 260,
            background: 'rgb(var(--bf-ink-rgb) / 0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: 14,
            boxShadow: '0 12px 40px rgba(0,0,0,0.45)'
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: 1, color: MUTED, fontWeight: 700, marginBottom: 10 }}>
            EM DESENVOLVIMENTO · SIMULAR ETAPA
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ETAPAS.map(({ etapa, label }) => (
              <button
                key={etapa}
                type="button"
                onClick={() => {
                  onSimular(etapa);
                  onOpenChange(false);
                }}
                style={{
                  textAlign: 'left',
                  background: 'rgb(var(--bf-fg) / 0.05)',
                  border: `1px solid ${BORDER}`,
                  borderRadius: 6,
                  color: TEXT,
                  fontSize: 12,
                  padding: '8px 10px',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease'
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Aviso das fontes que FALHARAM na consulta — diferente de "sem processos": o processo pode existir lá. */
function FontesComErroAviso({ itens }: { itens: ScanItem[] }) {
  const comErro = itens.flatMap(i =>
    [
      i.infosimples?.status === 'error' ? { chave: `${i.label}-infosimples`, label: i.label, erro: i.infosimples.erro } : null,
      i.datajud?.status === 'error' ? { chave: `${i.label}-datajud`, label: `${i.label} (DataJud)`, erro: i.datajud.erro } : null
    ].filter((x): x is { chave: string; label: string; erro: string | undefined } => x !== null)
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
        background: 'rgba(30, 124, 242,0.1)',
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
            <strong style={{ color: TEXT }}>{i.label}:</strong> {i.erro}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Aviso dos processos que a fonte encontrou mas o checkbox "somente autor" descartou (pesquisado é Réu). */
function DescartadosPorPoloAviso({ itens }: { itens: { numero: string; tribunal: string; autor?: string }[] }) {
  if (itens.length === 0) return null;
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
        background: 'rgba(30, 124, 242,0.1)',
        color: TEXT,
        fontSize: 12.5,
        lineHeight: 1.5,
        textAlign: 'left'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 6 }}>
        <AlertTriangle size={15} style={{ color: WARN }} />
        {itens.length} processo(s) encontrado(s), mas ocultado(s) pelo filtro "somente Autor"
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, color: MUTED }}>
        {itens.map(i => (
          <li key={`${i.tribunal}-${i.numero}`}>
            <strong style={{ color: TEXT }}>
              {i.tribunal} ({i.numero}):
            </strong>{' '}
            pesquisado é Réu{i.autor ? ` — Autor: ${i.autor}` : ''}, não Autor.
          </li>
        ))}
      </ul>
    </div>
  );
}

/** % estimado de uma sub-fonte (curva assintótica 1 - e^-x: cresce rápido no início, nunca trava num teto fixo). */
function pctDaSubfonte(progresso: ScanFonteProgresso, tribunal: string, label: string): number {
  if (progresso.status === 'found' || progresso.status === 'not-found' || progresso.status === 'error') return 100;
  if (progresso.status !== 'loading') return 0;
  const liveElapsedMs = progresso.startedAt ? Date.now() - progresso.startedAt : 0;
  const avgMs = getAvgMs(`${tribunal} (${label})`);
  return Math.min(99, Math.round((1 - Math.exp(-liveElapsedMs / avgMs)) * 100));
}

/** Deriva o status geral do tribunal (prioridade found > loading > pending > error > cancelled > not-found). */
function statusGeralDoItem(item: ScanItem): ScanStatus {
  const subfontes = [item.infosimples, item.datajud].filter((f): f is ScanFonteProgresso => !!f);
  return subfontes.some(f => f.status === 'found')
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
}

/** Linha única por tribunal (ponto de status + nome + barra + tempo decorrido), a partir de mockup. */
function ScanRow({ item }: { item: ScanItem }) {
  const subfontes = [item.infosimples, item.datajud].filter((f): f is ScanFonteProgresso => !!f);
  const statusGeral = statusGeralDoItem(item);

  const isOverdue = subfontes.some(f => {
    if (f.status !== 'loading' || !f.startedAt) return false;
    const label = f === item.infosimples ? 'Infosimples' : 'DataJud (CNJ)';
    return Date.now() - f.startedAt > getAvgMs(`${item.label} (${label})`);
  });

  const emAndamento = subfontes.filter(f => f.status === 'loading');
  const pct =
    statusGeral === 'found' ||
    statusGeral === 'not-found' ||
    statusGeral === 'error' ||
    statusGeral === 'cancelled'
      ? 100
      : emAndamento.length > 0
      ? Math.round(
          emAndamento.reduce((sum, f) => {
            const label = f === item.infosimples ? 'Infosimples' : 'DataJud (CNJ)';
            return sum + pctDaSubfonte(f, item.label, label);
          }, 0) / emAndamento.length
        )
      : 0;

  const corPonto =
    statusGeral === 'found'
      ? MOSS_GREEN
      : statusGeral === 'error'
      ? WARN
      : statusGeral === 'not-found' || statusGeral === 'cancelled'
      ? RUBY_RED
      : INPUT_BORDER;

  const corBarra =
    statusGeral === 'found'
      ? MOSS_GREEN
      : statusGeral === 'error'
      ? WARN
      : statusGeral === 'not-found' || statusGeral === 'cancelled'
      ? RUBY_RED
      : isOverdue
      ? WARN
      : BLUE;

  // Tempo decorrido desde o início da sub-fonte mais antiga ainda em andamento (ou, se já concluído,
  // o maior elapsedMs registrado entre as sub-fontes) — exibido em segundos, ex. "3.1s".
  const elapsedMs =
    emAndamento.length > 0
      ? Math.max(...emAndamento.map(f => (f.startedAt ? Date.now() - f.startedAt : 0)))
      : Math.max(0, ...subfontes.map(f => f.elapsedMs ?? 0));
  const elapsedLabel = `${(elapsedMs / 1000).toFixed(1)}s`;
  const custo = subfontes.reduce((soma, f) => soma + (f.custo ?? 0), 0);
  const fonteComErro = statusGeral === 'error' ? [item.infosimples, item.datajud].find(f => f?.erro) : undefined;
  const erro = fonteComErro?.erro;

  return (
    <div
      style={{
        padding: '7px 10px',
        background: 'rgb(var(--bf-ink-rgb) / 0.6)',
        border: `1px solid ${statusGeral === 'error' ? 'rgba(30, 124, 242,0.35)' : BORDER}`,
        borderRadius: 4,
        animation: 'bf-fadein 0.35s ease both'
      }}
    >
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: corPonto, flex: 'none' }} />
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: TEXT,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          width: 130,
          flex: 'none'
        }}
        title={item.label}
      >
        {item.label}
      </span>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgb(var(--bf-fg) / 0.08)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: corBarra,
            borderRadius: 2,
            transition: 'width 0.15s linear, background-color 0.4s ease'
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
          fontSize: 11,
          color: MUTED,
          flex: 'none',
          minWidth: 74,
          textAlign: 'right'
        }}
      >
        <span style={{ color: pct > 0 ? TEXT : MUTED, fontWeight: 600, minWidth: 28, textAlign: 'right' }}>
          {pct}%
        </span>
        <span style={{ opacity: 0.35 }}>·</span>
        <span style={{ minWidth: 32, textAlign: 'right' }}>
          {elapsedLabel}
        </span>
        {custo > 0 && (
          <>
            <span style={{ opacity: 0.35 }}>·</span>
            <span style={{ color: TEXT }}>{formatarReais(custo)}</span>
          </>
        )}
      </div>
    </div>
    {erro && (
        <div title={fonteComErro?.erroTecnico} style={{ marginTop: 5, paddingLeft: 17, fontSize: 11, color: WARN, lineHeight: 1.45, textAlign: 'left' }}>
          {erro}
        </div>
      )}
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
  background: 'linear-gradient(135deg, #1E7CF2 0%, var(--tt-accent-2) 100%)',
  color: 'var(--tt-base)',
  border: 'none',
  padding: '13px 28px',
  fontFamily: 'inherit',
  fontSize: 12.5,
  letterSpacing: 1.5,
  fontWeight: 700,
  borderRadius: 6,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  boxShadow: '0 4px 16px rgba(63, 160, 255,0.35)'
};

/** "1:42 de até 5:00" — tempo decorrido da varredura atual, com dica para encerrar quando passa de 2 minutos. */
function CronometroVarredura({ inicio }: { inicio: number | null }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!inicio) return null;
  const decorrido = Math.min(LIMITE_VARREDURA_S, Math.max(0, Math.floor((agora - inicio) / 1000)));
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  return (
    <span
      title={decorrido > 120 ? 'Tribunais lentos ainda respondendo. Você pode encerrar e ver o que já foi encontrado.' : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: decorrido > 120 ? WARN : MUTED }}
    >
      <Timer size={14} />
      <span>
        <strong style={{ color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{mmss(decorrido)}</strong> de até {mmss(LIMITE_VARREDURA_S)}
      </span>
    </span>
  );
}

/* ── Peças do formulário de pesquisa (tela única) ────────────────────── */
const rotuloCampoStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  fontWeight: 500,
  color: 'rgb(var(--bf-fg) / 0.82)',
  marginBottom: 7
};

const tituloBlocoStyle: React.CSSProperties = { margin: '0 0 10px', fontSize: 14.5, fontWeight: 600, color: TEXT };

const painelStyle: React.CSSProperties = {
  border: `1px solid ${INPUT_BORDER}`,
  borderRadius: 10,
  padding: '14px 16px',
  background: 'rgb(var(--bf-fg) / 0.02)'
};

const linkAcaoStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  alignSelf: 'flex-start',
  background: 'transparent',
  border: 'none',
  padding: 0,
  color: BLUE_LIGHT,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit'
};

/** Cartão de escolha do modo de busca ("Por pessoa ou empresa" / "Por número do processo"). */
function OpcaoBusca({
  ativa,
  onClick,
  icone,
  titulo,
  subtitulo,
  desabilitada
}: {
  ativa: boolean;
  onClick: () => void;
  icone: React.ReactNode;
  titulo: string;
  subtitulo: string;
  desabilitada?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativa}
      aria-disabled={desabilitada}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 14px',
        borderRadius: 10,
        border: `1px solid ${ativa ? 'rgba(30, 124, 242,0.6)' : INPUT_BORDER}`,
        background: ativa ? 'rgba(30, 124, 242,0.10)' : 'transparent',
        color: TEXT,
        textAlign: 'left',
        cursor: desabilitada ? 'not-allowed' : 'pointer',
        opacity: desabilitada ? 0.55 : 1,
        fontFamily: 'inherit',
        transition: 'border-color 0.2s ease, background 0.2s ease'
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 30,
          height: 30,
          borderRadius: 8,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: ativa ? 'rgba(30, 124, 242,0.22)' : 'rgb(var(--bf-fg) / 0.06)',
          color: ativa ? BLUE_LIGHT : MUTED
        }}
      >
        {icone}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{titulo}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: MUTED }}>{subtitulo}</span>
      </span>
    </button>
  );
}

const seloOpcionalStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 500,
  color: MUTED,
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: '0 7px',
  lineHeight: '16px'
};

function iconeCampoStyle(comErro: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    left: 14,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    color: comErro ? DANGER : MUTED,
    pointerEvents: 'none'
  };
}

const botaoIconeStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 48,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: `1px solid ${INPUT_BORDER}`,
  borderRadius: 8,
  color: TEXT,
  cursor: 'pointer'
};

/**
 * Campo de texto do formulário: rótulo (com selo "opcional" e dica), ícone à esquerda, ícone de status à
 * direita (verde quando válido, vermelho com erro) e texto de apoio embaixo, que vira a mensagem de erro.
 */
function CampoTexto({
  id,
  rotulo,
  opcional,
  ajuda,
  travado,
  icone,
  monoespacado,
  valor,
  onChange,
  placeholder,
  maxLength,
  inputMode,
  disabled,
  autoFocus,
  ok,
  erro,
  dica,
  acao
}: {
  id: string;
  rotulo: string;
  opcional?: boolean;
  ajuda?: string;
  travado?: boolean;
  icone?: React.ReactNode;
  /** Fonte monoespaçada (números longos como o CNJ). */
  monoespacado?: boolean;
  valor: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  maxLength?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  disabled?: boolean;
  autoFocus?: boolean;
  ok?: boolean;
  erro?: string | null;
  dica?: string;
  acao?: React.ReactNode;
}) {
  const estado = erro ? 'erro' : ok ? 'ok' : undefined;
  const textoApoio = erro || dica;
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={id} style={rotuloCampoStyle}>
        {rotulo}
        {opcional && <span style={seloOpcionalStyle}>opcional</span>}
        {ajuda && (
          <Tooltip label={ajuda} withArrow multiline w={260}>
            <span style={{ display: 'inline-flex', color: MUTED, cursor: 'help' }}>{travado ? <Lock size={13} /> : <Info size={13} />}</span>
          </Tooltip>
        )}
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          {icone && (
            <span aria-hidden style={iconeCampoStyle(!!erro)}>
              {icone}
            </span>
          )}
          <input
            id={id}
            type="text"
            className={`bf-input${icone ? '' : ' bf-input-sem-icone'}`}
            style={monoespacado ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 14 } : undefined}
            data-estado={estado}
            aria-invalid={!!erro}
            aria-describedby={textoApoio ? `${id}-apoio` : undefined}
            value={valor}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            inputMode={inputMode}
            disabled={disabled}
            autoFocus={autoFocus}
            autoComplete="off"
          />
          {estado && (
            <span aria-hidden style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', pointerEvents: 'none' }}>
              {erro ? <AlertCircle size={16} color={DANGER} /> : <CheckCircle2 size={16} color="#12A37A" />}
            </span>
          )}
        </div>
        {acao}
      </div>
      {textoApoio && (
        <span id={`${id}-apoio`} style={{ display: 'block', marginTop: 6, fontSize: 11.5, lineHeight: 1.45, color: erro ? DANGER : MUTED }}>
          {textoApoio}
        </span>
      )}
    </div>
  );
}

const TRANSICAO_SUAVE = { duration: 0.32, ease: [0.22, 0.8, 0.24, 1] as const };

/** Entrada do formulário: as seções sobem em sequência. */
const formEntradaVariants: Variants = {
  oculto: {},
  visivel: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } }
};
const secaoEntradaVariants: Variants = {
  oculto: { opacity: 0, y: 12 },
  visivel: { opacity: 1, y: 0, transition: TRANSICAO_SUAVE }
};

/** Fade + leve subida quando um bloco aparece ou troca de conteúdo (chave diferente). */
const trocaSuave = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: TRANSICAO_SUAVE
};

/**
 * Abre/fecha um bloco animando a altura. O overflow só fica oculto durante a animação, para não cortar
 * o anel de foco dos campos depois de aberto.
 */
function Revelar({ aberto, id, style, children }: { aberto: boolean; id?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {aberto && (
        <motion.div
          key="conteudo"
          id={id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
          exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
          transition={TRANSICAO_SUAVE}
          style={{ overflow: 'hidden', ...style }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Opção liga/desliga com título e explicação, clicável na linha inteira. */
function LinhaSwitch({ titulo, descricao, checked, onChange }: { titulo: string; descricao: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: '12px 14px',
        borderRadius: 8,
        border: `1px solid ${checked ? 'rgba(30, 124, 242,0.45)' : INPUT_BORDER}`,
        background: checked ? 'rgba(30, 124, 242,0.07)' : 'rgb(var(--bf-fg) / 0.03)',
        cursor: 'pointer',
        transition: 'border-color 0.2s ease, background 0.2s ease'
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, color: TEXT, fontWeight: 600 }}>{titulo}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: MUTED, lineHeight: 1.45 }}>{descricao}</span>
      </span>
      <Switch checked={checked} onChange={e => onChange(e.currentTarget.checked)} color={BLUE} styles={{ track: { cursor: 'pointer' } }} />
    </label>
  );
}
