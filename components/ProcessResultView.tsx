'use client';

import { authFetch } from '@/lib/authFetch';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatChatMessageHtml, formatDateLabel } from '@/lib/format';
import type { CaseData, LegalProcess } from '@/lib/mockProcesses';
import { Bell, BellRing, Download, Maximize2, RefreshCw, Search, Send, X } from 'lucide-react';
import AiSummaryLoadingBar from './AiSummaryLoadingBar';

const GOLD = '#e8d5b0';
const GOLD_SOFT = 'rgba(214,178,110,0.12)';
const ORANGE = '#e0a052';
const BLUE = '#7aa7d9';
const TEXT = '#ffffff';
const MUTED = 'rgba(229,231,235,0.7)';
const BORDER = 'rgba(255,255,255,0.12)';
const GLASS = 'rgba(20,20,22,0.55)';
const INNER = 'rgba(255,255,255,0.035)';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** Resultado de um tribunal na varredura (vem dos cards de progresso do ProcessTracker). */
export type FonteResultado = { label: string; status: 'found' | 'not-found' | 'error' | 'cancelled' | 'pending' | 'loading' };

type StatusProcesso = 'andamento' | 'pausado' | 'encerrado';

const STATUS_META: Record<StatusProcesso, { label: string; color: string }> = {
  andamento: { label: 'Em andamento', color: BLUE },
  pausado: { label: 'Pausado', color: GOLD },
  encerrado: { label: 'Encerrado', color: 'rgba(229,231,235,0.55)' }
};

const FASES = [
  { titulo: 'Pedido feito', desc: 'O processo começou' },
  { titulo: 'Análise do juiz', desc: 'As partes se manifestam' },
  { titulo: 'Decisão', desc: 'O juiz decide quem tem razão' },
  { titulo: 'Pagamento', desc: 'Quem perdeu cumpre a decisão' },
  { titulo: 'Encerrado', desc: 'Processo arquivado' }
];

/** Termos jurídicos comuns, explicados em português simples; exibidos só os que aparecem no processo. */
const GLOSSARIO: { termo: string; regex: RegExp; explicacao: string }[] = [
  { termo: 'Precatório', regex: /precat[óo]ri/i, explicacao: 'Fila oficial que o governo usa para pagar quem ganhou processos contra ele. O pagamento segue a ordem da fila.' },
  { termo: 'RPV', regex: /\bRPV\b|requisi[çc][ãa]o de pequeno valor/i, explicacao: 'Forma mais rápida de o governo pagar valores menores que ele deve por decisão judicial.' },
  { termo: 'Cumprimento de sentença', regex: /cumprimento de senten/i, explicacao: 'Fase em que quem ganhou cobra o que a decisão mandou pagar.' },
  { termo: 'Execução', regex: /execu[çc][ãa]o/i, explicacao: 'Processo para cobrar uma dívida que já é reconhecida.' },
  { termo: 'Suspenso / sobrestado', regex: /suspens|sobrest/i, explicacao: 'O processo fica parado por um tempo, aguardando algo acontecer.' },
  { termo: 'Distribuído por dependência', regex: /depend[êe]ncia/i, explicacao: 'O processo foi ligado a outro mais antigo sobre o mesmo assunto.' },
  { termo: 'Trânsito em julgado', regex: /tr[âa]nsit/i, explicacao: 'A decisão virou definitiva: não cabe mais recurso.' },
  { termo: 'Citação', regex: /cita[çc][ãa]o|citad/i, explicacao: 'Aviso oficial à outra parte de que existe um processo contra ela.' },
  { termo: 'Conclusos', regex: /conclus/i, explicacao: 'O processo foi entregue ao juiz para ele analisar e decidir.' },
  { termo: 'Sentença', regex: /senten[çc]a/i, explicacao: 'Decisão do juiz que resolve o pedido na primeira instância.' },
  { termo: 'Acórdão', regex: /ac[óo]rd[ãa]o/i, explicacao: 'Decisão tomada por um grupo de desembargadores, em recurso.' },
  { termo: 'Fazenda Pública', regex: /fazenda p[úu]blica/i, explicacao: 'Nome usado na Justiça para o governo (Estado, Município ou União).' },
  { termo: 'Juizado Especial', regex: /juizado/i, explicacao: 'Justiça mais simples e rápida, para causas de menor valor.' },
  { termo: 'Penhora', regex: /penhor/i, explicacao: 'Bloqueio de bens ou dinheiro para garantir o pagamento de uma dívida.' },
  { termo: 'Arquivamento', regex: /arquiv/i, explicacao: 'O processo foi guardado; em regra, não há mais nada a fazer nele.' }
];

const textoDoProcesso = (p: LegalProcess) =>
  [p.tipo, p.assunto, p.tribunal, p.varaForo, p.reu, p.parteContraria, ...p.movimentos.flatMap(m => [m.titulo, m.descricao])]
    .filter(Boolean)
    .join(' ');

const movimentosOrdenados = (p: LegalProcess) => [...p.movimentos].sort((a, b) => b.data.localeCompare(a.data));

function statusDoProcesso(p: LegalProcess): StatusProcesso {
  const recentes = movimentosOrdenados(p).slice(0, 3).map(m => `${m.titulo} ${m.descricao}`).join(' ');
  if (/arquivad|arquivamento|baixa definitiva|extin[çt]/i.test(recentes)) return 'encerrado';
  if (/suspens|sobrest/i.test(recentes)) return 'pausado';
  return 'andamento';
}

function faseDoProcesso(p: LegalProcess, status: StatusProcesso): number {
  if (status === 'encerrado') return 4;
  const texto = textoDoProcesso(p);
  if (/precat|\bRPV\b|requisi[çc]|cumprimento de senten|alvar[áa]|pagamento/i.test(texto)) return 3;
  if (/senten[çc]a|ac[óo]rd[ãa]o|julgad|procedente/i.test(texto)) return 2;
  if (/contesta|cita[çc]|despacho|audi[êe]ncia|conclus|manifesta/i.test(texto)) return 1;
  return 0;
}

/** Título em linguagem simples a partir da classe processual. */
function tituloSimples(p: LegalProcess): string {
  const tipo = p.tipo || '';
  const contraGoverno = /fazenda|estado|munic[íi]pio|uni[ãa]o|inss|previd/i.test(`${p.parteContraria} ${p.reu ?? ''}`);
  if (/cumprimento de senten/i.test(tipo)) return 'Cobrança de valor já ganho';
  if (/execu[çc][ãa]o/i.test(tipo)) return 'Cobrança de dívida';
  if (/juizado/i.test(`${tipo} ${p.varaForo ?? ''}`)) return contraGoverno ? 'Pedido contra o governo no Juizado' : 'Ação no Juizado Especial';
  if (/procedimento comum|ordin[áa]ri/i.test(tipo)) return contraGoverno ? 'Ação contra o governo' : 'Ação comum';
  return tipo || 'Processo';
}

function proximoPasso(fase: number, status: StatusProcesso): string {
  if (status === 'encerrado') return 'Nada. O processo foi encerrado e arquivado.';
  if (status === 'pausado' && fase === 3) return 'Aguardar o pagamento ser liberado. Isso costuma levar meses ou anos.';
  if (status === 'pausado') return 'Aguardar o motivo da pausa ser resolvido para o processo voltar a andar.';
  if (fase === 3) return 'Aguardar a outra parte pagar o valor definido pela Justiça.';
  if (fase === 2) return 'Aguardar a decisão ser cumprida ou eventual recurso da outra parte.';
  if (fase === 1) return 'Aguardar o juiz analisar o pedido e as manifestações das partes.';
  return 'Aguardar a outra parte ser avisada e responder ao pedido.';
}

function valorEmNumero(v: string): number {
  const limpo = (v || '').replace(/[^\d,]/g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : 0;
}

function formatarValorCurto(n: number): string {
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (n >= 1_000) return `R$ ${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "TJSP · 7ª Vara..." -> "TJSP" */
const siglaTribunal = (t: string) => (t || '').split(/\s*[·\-–]\s*/)[0].trim();

function mascararDocumento(doc: string): string {
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return `CPF ${d.slice(0, 3)}.***.***-${d.slice(9)}`;
  if (d.length === 14) return `CNPJ ${d.slice(0, 2)}.***.***/****-${d.slice(12)}`;
  return doc;
}

/**
 * Separa o polo ("Fulano; Ciclano, Advogado: Beltrano") em pessoas e advogado(s). Polos com dezenas
 * de autores chegam num texto só; a lista permite mostrar só o primeiro + "e mais N".
 */
function separarAdvogado(texto?: string): { pessoas: string[]; advogado?: string } {
  if (!texto) return { pessoas: [] };
  const [parte, ...resto] = texto.split(/,?\s*Advogad[oa]s?\s*:\s*/i);
  const pessoas = parte
    .split(/\s*[;\n|]\s*|,\s+(?=[A-ZÀ-Ý]{2,}\s)/)
    .map(n => n.trim())
    .filter(Boolean);
  return { pessoas, advogado: resto.join(', ').trim() || undefined };
}

interface ProcessResultViewProps {
  fullName: string;
  cpf: string;
  phone: string;
  caseData: CaseData;
  tribunaisConsultados: string[];
  fontes?: FonteResultado[];
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
  caseData,
  tribunaisConsultados,
  fontes = [],
  aiSummary,
  aiSummaryLoading,
  onRefreshAiSummary,
  onNewSearch,
  aiModel = 'claude-haiku-4-5',
  chatTone = 'Acolhedor'
}: ProcessResultViewProps) {
  const [monitorados, setMonitorados] = useState<Set<string>>(new Set());
  const [processoSelecionadoIdx, setProcessoSelecionadoIdx] = useState(0);
  const [movimentacoesAbertas, setMovimentacoesAbertas] = useState(false);
  const [buscaFeitaEm] = useState(() =>
    new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  );

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatExpandido, setChatExpandido] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const chatModalBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // block: 'nearest' restringe o scroll ao container do chat (overflowY próprio), em vez de
    // rolar a página inteira até esse ponto. O mesmo chat aparece no cartão e no modal ampliado.
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    chatModalBottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [chatMessages, chatLoading, chatExpandido]);

  useEffect(() => {
    if (!chatExpandido && !movimentacoesAbertas) return;
    const fecharComEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setChatExpandido(false);
      setMovimentacoesAbertas(false);
    };
    window.addEventListener('keydown', fecharComEsc);
    return () => window.removeEventListener('keydown', fecharComEsc);
  }, [chatExpandido, movimentacoesAbertas]);

  const primeiroNome = fullName.split(' ')[0] || 'Cliente';

  // Status/fase/título derivados das movimentações; a lista é agrupada em ativos x encerrados.
  const processos = useMemo(
    () =>
      caseData.processes.map((p, idx) => {
        const status = statusDoProcesso(p);
        return { p, idx, status, fase: faseDoProcesso(p, status), titulo: tituloSimples(p) };
      }),
    [caseData.processes]
  );
  const ativos = processos.filter(x => x.status !== 'encerrado');
  const encerrados = processos.filter(x => x.status === 'encerrado');
  const selecionado = processos[processoSelecionadoIdx] ?? processos[0];

  const tribunaisComProcesso = Array.from(new Set(caseData.processes.map(p => siglaTribunal(p.tribunal)).filter(Boolean)));
  const valorTotal = caseData.processes.reduce((s, p) => s + valorEmNumero(p.valorCausa), 0);
  const conferidosDataJud = caseData.processes.filter(p => p.enriquecidoDataJud || p.origem === 'ambos' || p.origem === 'datajud').length;

  const fontesEncontradas = fontes.filter(f => f.status === 'found');
  const fontesVazias = fontes.filter(f => f.status === 'not-found');
  const fontesFalhas = fontes.filter(f => f.status === 'error' || f.status === 'cancelled');
  const totalTribunais = fontes.length || tribunaisConsultados.length;

  const sendChatMessage = async (texto?: string) => {
    const msg = (texto ?? chatInput).trim();
    if (!msg || chatLoading) return;
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

  const renderChatCorpo = (bottomRef: React.RefObject<HTMLDivElement | null>, grande: boolean) => (
    <>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: grande ? 16 : 0 }}>
        {chatMessages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {['Quando ele deve receber?', 'O que acontece agora?', 'O que significa cada movimentação?'].map(q => (
              <button key={q} type="button" className="prv-sugestao" onClick={() => void sendChatMessage(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        {chatMessages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div
              style={{
                maxWidth: '88%',
                padding: '9px 13px',
                fontSize: grande ? 13.5 : 12.5,
                lineHeight: 1.6,
                borderRadius: 6,
                background: msg.role === 'user' ? GOLD_SOFT : 'rgba(255,255,255,0.06)',
                color: TEXT,
                border: `1px solid ${msg.role === 'user' ? 'rgba(214,178,110,0.35)' : BORDER}`
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
        {chatLoading && <div style={{ fontSize: 12, color: MUTED, animation: 'bf-blink 1.4s ease-in-out infinite' }}>Analisando o processo...</div>}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: 'flex', gap: 8, padding: grande ? 12 : '12px 0 0', borderTop: grande ? `1px solid ${BORDER}` : 'none' }}>
        <input
          type="text"
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void sendChatMessage()}
          placeholder="Escreva sua dúvida"
          className="prv-input"
        />
        <button type="button" onClick={() => void sendChatMessage()} aria-label="Enviar" className="prv-btn prv-btn-gold bf-btn-ouro" style={{ padding: '8px 12px' }}>
          <Send size={14} />
        </button>
      </div>
    </>
  );

  const sel = selecionado;
  const selP = sel?.p;
  const autor = separarAdvogado(selP?.autor);
  const reu = separarAdvogado(selP?.reu || selP?.parteContraria);
  const glossario = selP ? GLOSSARIO.filter(g => g.regex.test(textoDoProcesso(selP))).slice(0, 5) : [];
  const monitorado = selP ? monitorados.has(selP.numero) : false;

  return (
    <div className="prv-root" style={{ width: '100%', maxWidth: 1200, margin: '0 auto 48px', animation: 'bf-fadein 0.6s ease both', textAlign: 'left' }}>
      <style>{CSS}</style>

      {/* ── Cabeçalho ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div className="prv-eyebrow">Resultado da busca</div>
          <h1 style={{ margin: '4px 0 2px', fontSize: 24, fontWeight: 700, color: TEXT, overflowWrap: 'anywhere' }}>{fullName}</h1>
          <div style={{ fontSize: 12, color: MUTED }}>
            {cpf ? `${mascararDocumento(cpf)} · ` : ''}busca feita em {buscaFeitaEm}
          </div>
        </div>
        <div className="prv-no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="prv-btn bf-btn-sec" onClick={() => window.print()}>
            <Download size={14} /> Baixar relatório em PDF
          </button>
          <button type="button" className="prv-btn prv-btn-gold bf-btn-ouro" onClick={onNewSearch}>
            <Search size={14} /> Nova busca
          </button>
        </div>
      </div>

      {/* ── Em resumo ── */}
      <section className="prv-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span className="prv-eyebrow">Em resumo</span>
          <button
            type="button"
            className="prv-link prv-no-print"
            onClick={onRefreshAiSummary}
            disabled={aiSummaryLoading}
            title="Gerar o resumo novamente"
          >
            <RefreshCw size={12} /> {aiSummaryLoading ? 'Gerando...' : 'Recriar'}
          </button>
        </div>
        {aiSummaryLoading ? (
          <AiSummaryLoadingBar />
        ) : aiSummary ? (
          <div className="prv-resumo" dangerouslySetInnerHTML={{ __html: formatSummaryHtml(aiSummary) }} />
        ) : (
          <p className="prv-resumo" style={{ margin: 0 }}>
            Encontramos {caseData.totalProcessos} processo(s) ligado(s) a {primeiroNome}
            {tribunaisComProcesso.length > 0 ? `, em ${tribunaisComProcesso.join(', ')}` : ''}.
          </p>
        )}

        <div className="prv-stats">
          <Stat label="Processos encontrados" valor={String(caseData.totalProcessos)} nota={`em ${tribunaisComProcesso.length} tribunal(is)${tribunaisComProcesso.length ? ` (${tribunaisComProcesso.join(', ')})` : ''}`} />
          <Stat
            label="Ainda em andamento"
            valor={String(ativos.length)}
            nota={(() => {
              const pausados = ativos.filter(a => a.status === 'pausado').length;
              return pausados ? `${pausados} deles está pausado` : 'nenhum pausado';
            })()}
          />
          <Stat label={`Papel de ${primeiroNome}`} valor={`Autor em ${caseData.totalProcessos}`} nota="é quem pede, não quem é cobrado" />
          <Stat label="Valor pedido, somado" valor={valorTotal ? formatarValorCurto(valorTotal) : '—'} nota="não é o valor a receber; veja abaixo" />
        </div>
      </section>

      {/* ── Onde procuramos ── */}
      {totalTribunais > 0 && (
        <section className="prv-card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>Onde procuramos</div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                Consultamos {totalTribunais} tribunal(is).
                {fontesFalhas.length > 0 &&
                  ` ${fontesFalhas.length} deles estavam fora do ar ou lentos, então o resultado pode estar incompleto.`}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {fontes.length === 0 &&
              tribunaisConsultados.map(t => (
                <Chip key={t} color={MUTED}>
                  {t}
                </Chip>
              ))}
            {fontesEncontradas.map(f => {
              const qtd = caseData.processes.filter(p => siglaTribunal(p.tribunal).toUpperCase() === siglaTribunal(f.label).toUpperCase()).length;
              return (
                <Chip key={f.label} color={GOLD} destaque>
                  {f.label} · {qtd ? `${qtd} processo(s)` : 'encontrado'}
                </Chip>
              );
            })}
            {fontesVazias.map(f => (
              <Chip key={f.label} color={MUTED}>
                {f.label} · nada encontrado
              </Chip>
            ))}
            {fontesFalhas.length > 0 && (
              <Chip color={ORANGE}>{juntarLista(fontesFalhas.map(f => f.label))} · sem resposta</Chip>
            )}
            {conferidosDataJud > 0 && (
              <Chip color={BLUE}>
                Base oficial conferida · {conferidosDataJud} de {caseData.totalProcessos}
              </Chip>
            )}
          </div>
        </section>
      )}

      {/* ── Lista + detalhe ── */}
      <div className="prv-split">
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          {[
            { titulo: `Ainda em andamento (${ativos.length})`, itens: ativos },
            { titulo: `Já encerrados (${encerrados.length})`, itens: encerrados }
          ]
            .filter(g => g.itens.length > 0)
            .map(grupo => (
              <div key={grupo.titulo} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTED }}>{grupo.titulo}</div>
                {grupo.itens.map(item => {
                  const ativo = item.idx === sel?.idx;
                  return (
                    <button
                      key={`${item.p.numero}-${item.idx}`}
                      type="button"
                      onClick={() => setProcessoSelecionadoIdx(item.idx)}
                      className={`prv-item${ativo ? ' prv-item-ativo' : ''}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: TEXT, lineHeight: 1.35 }}>{item.titulo}</span>
                        <StatusBadge status={item.status} />
                      </div>
                      <div className="prv-clamp" style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>
                        Contra {item.p.parteContraria || 'parte não informada'}
                        {item.p.valorCausa ? ` · ${item.p.valorCausa}` : ''}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'rgba(229,231,235,0.5)', marginTop: 3, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                        {item.p.numero}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
        </aside>

        {sel && selP && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {/* Cabeçalho do processo */}
            <section className="prv-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <StatusBadge status={sel.status} />
                  <h2 style={{ margin: '8px 0 2px', fontSize: 19, fontWeight: 700, color: TEXT }}>{sel.titulo}</h2>
                  <div style={{ fontSize: 11.5, color: MUTED, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{selP.numero}</div>
                </div>
                <button
                  type="button"
                  className={`prv-btn bf-btn-sec prv-no-print${monitorado ? ' prv-btn-ativo' : ''}`}
                  onClick={() =>
                    setMonitorados(prev => {
                      const novo = new Set(prev);
                      if (novo.has(selP.numero)) novo.delete(selP.numero);
                      else novo.add(selP.numero);
                      return novo;
                    })
                  }
                >
                  {monitorado ? <BellRing size={14} /> : <Bell size={14} />}
                  {monitorado ? 'Avisaremos quando andar' : 'Avisar quando andar'}
                </button>
              </div>

              <p style={{ margin: '14px 0', fontSize: 14, lineHeight: 1.7, color: TEXT }}>
                {primeiroNome} é quem pede neste processo
                {selP.parteContraria ? `, contra ${selP.parteContraria}` : ''}.{' '}
                {sel.status === 'pausado'
                  ? `O processo está pausado e está na fase de ${FASES[sel.fase].titulo.toLowerCase()}.`
                  : sel.status === 'encerrado'
                    ? 'O processo já foi encerrado.'
                    : `O processo segue em andamento, na fase de ${FASES[sel.fase].titulo.toLowerCase()}.`}
              </p>

              <div className="prv-duo">
                <div className="prv-inner">
                  <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 4 }}>Isso é um risco para {primeiroNome}?</div>
                  <div style={{ fontSize: 13, color: GOLD, fontWeight: 700, lineHeight: 1.5 }}>
                    Nenhum risco direto. Aqui {primeiroNome} é quem pede.
                  </div>
                </div>
                <div className="prv-inner">
                  <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 4 }}>O que deve acontecer agora</div>
                  <div style={{ fontSize: 13, color: GOLD, fontWeight: 700, lineHeight: 1.5 }}>{proximoPasso(sel.fase, sel.status)}</div>
                </div>
              </div>
            </section>

            {/* Fase */}
            <section className="prv-card">
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 14 }}>Em que fase está</div>
              <div className="prv-fases">
                {FASES.map((f, i) => {
                  const feito = i <= sel.fase;
                  return (
                    <div key={f.titulo} style={{ minWidth: 0 }}>
                      <div style={{ height: 4, borderRadius: 2, background: feito ? GOLD : 'rgba(255,255,255,0.14)', marginBottom: 8 }} />
                      <div style={{ fontSize: 12, fontWeight: 700, color: feito ? TEXT : MUTED }}>{f.titulo}</div>
                      <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.4 }}>{f.desc}</div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Envolvidos + dados */}
            <div className="prv-duo">
              <section className="prv-card">
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 12 }}>Quem está envolvido</div>
                <div style={{ fontSize: 11, color: MUTED }}>Do lado de {primeiroNome} (quem pede)</div>
                <ListaPessoas key={`a-${selP.numero}`} pessoas={autor.pessoas.length ? autor.pessoas : [fullName]} />
                {autor.advogado && <TextoLimitado prefixo="Advogado: " texto={autor.advogado} />}
                <div style={{ height: 1, background: BORDER, margin: '12px 0' }} />
                <div style={{ fontSize: 11, color: MUTED }}>Do outro lado (quem é cobrado)</div>
                <ListaPessoas key={`r-${selP.numero}`} pessoas={reu.pessoas.length ? reu.pessoas : ['Não informado']} />
                {reu.advogado && <TextoLimitado prefixo="Representado por: " texto={reu.advogado} />}
              </section>

              <section className="prv-card">
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 12 }}>Dados do processo</div>
                <DadoLinha label="Onde corre" valor={[siglaTribunal(selP.tribunal), selP.varaForo || selP.orgaoJulgadorDataJud].filter(Boolean).join(' · ') || '—'} />
                <DadoLinha label="Começou em" valor={selP.distribuicao || '—'} />
                <DadoLinha label="Tipo (termo técnico)" valor={selP.tipo || '—'} />
                <DadoLinha label="Valor da causa" valor={selP.valorCausa || 'Não informado'} />
                <p style={{ margin: '10px 0 0', fontSize: 11, color: MUTED, lineHeight: 1.5 }}>
                  Valor da causa é o valor informado quando o processo começou. O valor final, se houver, é definido pelo juiz e pode ser diferente.
                </p>
              </section>
            </div>

            {/* Movimentações */}
            <section className="prv-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Últimas movimentações, traduzidas</div>
                {selP.movimentos.length > 3 && (
                  <button type="button" className="prv-link prv-no-print" onClick={() => setMovimentacoesAbertas(true)}>
                    Ver todas
                  </button>
                )}
              </div>
              {selP.movimentos.length === 0 && <p style={{ margin: '8px 0 0', fontSize: 12.5, color: MUTED }}>Nenhuma movimentação encontrada.</p>}
              {movimentosOrdenados(selP)
                .slice(0, 3)
                .map((m, i) => (
                  <MovimentoLinha key={i} data={m.data} titulo={m.titulo} descricao={m.descricao} />
                ))}
            </section>

            {/* Glossário + chat */}
            <div className="prv-duo">
              <section className="prv-card">
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 12 }}>Palavras deste processo</div>
                {glossario.length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: MUTED }}>Nenhum termo técnico a explicar.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {glossario.map(g => (
                    <div key={g.termo}>
                      <div style={{ fontSize: 12.5, color: GOLD, fontWeight: 700 }}>{g.termo}</div>
                      <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>{g.explicacao}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="prv-card prv-no-print" style={{ display: 'flex', flexDirection: 'column', height: 360 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Ficou com dúvida?</div>
                  <button type="button" className="prv-icon-btn" onClick={() => setChatExpandido(true)} title="Ampliar chat" aria-label="Ampliar chat">
                    <Maximize2 size={14} />
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, margin: '2px 0 12px' }}>
                  Pergunte em português comum. A resposta usa só os dados deste processo.
                </div>
                {renderChatCorpo(chatBottomRef, false)}
              </section>
            </div>
          </div>
        )}
      </div>

      {chatExpandido && (
        <div className="prv-overlay" onClick={() => setChatExpandido(false)}>
          <div
            role="dialog"
            aria-label="Tire dúvidas com a IA"
            onClick={e => e.stopPropagation()}
            className="prv-modal"
            style={{ width: 'max(60vw, min(100vw - 24px, 560px))', height: '70vh' }}
          >
            <div className="prv-modal-header">
              <span>Ficou com dúvida?</span>
              <button type="button" className="prv-icon-btn" onClick={() => setChatExpandido(false)} aria-label="Fechar chat ampliado">
                <X size={16} />
              </button>
            </div>
            {renderChatCorpo(chatModalBottomRef, true)}
          </div>
        </div>
      )}

      {movimentacoesAbertas && selP && (
        <div className="prv-overlay" onClick={() => setMovimentacoesAbertas(false)}>
          <div
            role="dialog"
            aria-label="Movimentações do processo"
            onClick={e => e.stopPropagation()}
            className="prv-modal"
            style={{ width: 'min(640px, 100%)', maxHeight: '75vh' }}
          >
            <div className="prv-modal-header">
              <div style={{ minWidth: 0 }}>
                <div>Todas as movimentações</div>
                <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 400, overflowWrap: 'anywhere' }}>{selP.numero}</div>
              </div>
              <button type="button" className="prv-icon-btn" onClick={() => setMovimentacoesAbertas(false)} aria-label="Fechar movimentações">
                <X size={16} />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 18px 16px' }}>
              {movimentosOrdenados(selP).map((m, i) => (
                <MovimentoLinha key={i} data={m.data} titulo={m.titulo} descricao={m.descricao} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, valor, nota }: { label: string; valor: string; nota: string }) {
  return (
    <div className="prv-inner">
      <div style={{ fontSize: 11, color: MUTED }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: TEXT, margin: '4px 0 2px', overflowWrap: 'anywhere' }}>{valor}</div>
      <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.4 }}>{nota}</div>
    </div>
  );
}

function Chip({ children, color, destaque }: { children: React.ReactNode; color: string; destaque?: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color,
        border: `1px solid ${destaque ? color : BORDER}`,
        background: destaque ? GOLD_SOFT : 'rgba(255,255,255,0.03)',
        borderRadius: 4,
        padding: '4px 9px'
      }}
    >
      {children}
    </span>
  );
}

function StatusBadge({ status }: { status: StatusProcesso }) {
  const meta = STATUS_META[status];
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 700,
        color: meta.color,
        border: `1px solid ${meta.color}`,
        borderRadius: 4,
        padding: '2px 7px',
        whiteSpace: 'nowrap',
        flexShrink: 0
      }}
    >
      {meta.label}
    </span>
  );
}

function DadoLinha({ label, valor }: { label: string; valor: string }) {
  return (
    <div style={{ padding: '6px 0', borderTop: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 11, color: MUTED }}>{label}</div>
      <div style={{ fontSize: 12.5, color: TEXT, fontWeight: 600, marginTop: 2, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{valor}</div>
    </div>
  );
}

/** Primeira pessoa do polo + "e mais N pessoas", com opção de ver a lista inteira (rolável). */
function ListaPessoas({ pessoas }: { pessoas: string[] }) {
  const [aberta, setAberta] = useState(false);
  const extras = pessoas.length - 1;
  return (
    <div style={{ marginTop: 2 }}>
      {aberta ? (
        <ul style={{ margin: 0, paddingLeft: 16, maxHeight: 180, overflowY: 'auto', fontSize: 12.5, color: TEXT, lineHeight: 1.6 }}>
          {pessoas.map((n, i) => (
            <li key={i} style={{ overflowWrap: 'anywhere' }}>{n}</li>
          ))}
        </ul>
      ) : (
        <div className="prv-clamp" style={{ fontSize: 13, color: TEXT, fontWeight: 600, lineHeight: 1.45 }}>
          {pessoas[0]}
          {extras > 0 && <span style={{ color: MUTED, fontWeight: 400 }}> e mais {extras} {extras === 1 ? 'pessoa' : 'pessoas'}</span>}
        </div>
      )}
      {extras > 0 && (
        <button type="button" className="prv-link" style={{ marginTop: 4, fontSize: 11.5 }} onClick={() => setAberta(v => !v)}>
          {aberta ? 'Mostrar menos' : 'Ver todas'}
        </button>
      )}
    </div>
  );
}

/** Texto longo (ex.: lista de advogados) cortado em 2 linhas, com opção de expandir. */
function TextoLimitado({ prefixo, texto }: { prefixo: string; texto: string }) {
  const [aberto, setAberto] = useState(false);
  const longo = texto.length > 90;
  return (
    <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
      <div className={aberto ? undefined : 'prv-clamp'} style={{ overflowWrap: 'anywhere' }}>
        {prefixo}
        {texto}
      </div>
      {longo && (
        <button type="button" className="prv-link" style={{ fontSize: 11.5 }} onClick={() => setAberto(v => !v)}>
          {aberto ? 'Mostrar menos' : 'Ver tudo'}
        </button>
      )}
    </div>
  );
}

/** Título sem as reticências de corte ("Em tendo a ..."), para comparar com o início do teor. */
const semReticencias = (t: string) => t.replace(/\s*(\.\.\.|…)\s*$/, '').trim();

function MovimentoLinha({ data, titulo, descricao }: { data: string; titulo: string; descricao: string }) {
  // O teor do tribunal costuma ser longo e repetir o título: fica recolhido e só abre a pedido.
  const [teorAberto, setTeorAberto] = useState(false);
  const temTeor = !!descricao && descricao !== titulo && descricao.trim() !== semReticencias(titulo);
  return (
    <div className="prv-mov">
      <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: 'nowrap' }}>{formatDateLabel(data)}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: TEXT, fontWeight: 600, lineHeight: 1.45 }}>{titulo}</div>
        {temTeor && (
          <>
            {teorAberto && (
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{descricao}</div>
            )}
            <button
              type="button"
              className="prv-link prv-no-print"
              style={{ fontSize: 11.5, marginTop: 4 }}
              onClick={() => setTeorAberto(v => !v)}
              aria-expanded={teorAberto}
            >
              {teorAberto ? 'Ocultar teor' : 'Ver teor completo'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const juntarLista = (itens: string[]) => (itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`);

function formatSummaryHtml(raw: string): string {
  if (!raw) return '';
  const text = raw.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return text
    .split(/\n\s*\n/)
    .map(block => `<p style="margin:0 0 10px;">${block.trim().replace(/\n/g, '<br />')}</p>`)
    .join('');
}

const CSS = `
.prv-eyebrow { font-size: 10.5px; letter-spacing: 1.2px; text-transform: uppercase; font-weight: 700; color: ${GOLD}; }
.prv-card { background: ${GLASS}; border: 1px solid ${BORDER}; border-radius: 8px; padding: 18px 20px; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); min-width: 0; }
.prv-inner { background: ${INNER}; border: 1px solid ${BORDER}; border-radius: 6px; padding: 12px 14px; min-width: 0; }
.prv-resumo { font-size: 15px; line-height: 1.7; color: ${TEXT}; font-weight: 600; }
.prv-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
.prv-split { display: grid; grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); gap: 16px; align-items: start; }
.prv-duo { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.prv-fases { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.prv-mov { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 12px; padding: 12px 0; border-top: 1px solid ${BORDER}; }
.prv-mov:first-of-type { border-top: none; }
.prv-btn { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 1px solid ${BORDER}; color: ${TEXT}; padding: 9px 14px; font-size: 12.5px; font-weight: 600; border-radius: 6px; cursor: pointer; transition: border-color .2s, background .2s; }
.prv-btn:hover { border-color: ${GOLD}; }
.prv-btn-gold { background: ${GOLD}; border-color: ${GOLD}; color: #15161a; }
.prv-btn-gold:hover { background: #e8d5b0; }
.prv-btn-ativo { border-color: ${GOLD}; background: ${GOLD_SOFT}; color: ${GOLD}; }
.prv-link { display: inline-flex; align-items: center; gap: 4px; background: none; border: none; padding: 0; color: ${GOLD}; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.prv-link:disabled { cursor: not-allowed; opacity: .6; }
.prv-icon-btn { background: none; border: none; padding: 4px; margin: -4px; color: ${MUTED}; cursor: pointer; display: inline-flex; }
.prv-icon-btn:hover { color: ${TEXT}; }
.prv-item { text-align: left; width: 100%; background: ${GLASS}; border: 1px solid ${BORDER}; border-radius: 8px; padding: 12px 14px; cursor: pointer; transition: border-color .2s, background .2s; }
.prv-item:hover { border-color: rgba(214,178,110,0.5); }
.prv-item-ativo { border-color: ${GOLD}; background: ${GOLD_SOFT}; }
.prv-sugestao { text-align: left; background: ${INNER}; border: 1px solid ${BORDER}; border-radius: 6px; padding: 9px 12px; font-size: 12.5px; color: ${TEXT}; cursor: pointer; }
.prv-sugestao:hover { border-color: ${GOLD}; }
.prv-input { flex: 1; min-width: 0; padding: 9px 12px; font-size: 12.5px; border: 1px solid ${BORDER}; border-radius: 6px; background: rgba(255,255,255,0.06); color: ${TEXT}; outline: none; }
.prv-input:focus { border-color: ${GOLD}; }
.prv-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.prv-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 60; display: flex; align-items: center; justify-content: center; padding: 12px; }
.prv-modal { background: #15161a; border: 1px solid ${BORDER}; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; }
.prv-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 18px; border-bottom: 1px solid ${BORDER}; font-size: 13px; font-weight: 700; color: ${TEXT}; flex-shrink: 0; }
@media (max-width: 900px) {
  .prv-split { grid-template-columns: 1fr; }
  .prv-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .prv-duo { grid-template-columns: 1fr; }
  .prv-fases { grid-template-columns: 1fr; }
  .prv-card { padding: 16px; }
  .prv-mov { grid-template-columns: 1fr; gap: 2px; }
}
@media print {
  .prv-no-print { display: none !important; }
  .prv-card, .prv-item { backdrop-filter: none; -webkit-backdrop-filter: none; break-inside: avoid; }
}
`;
