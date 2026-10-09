'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Tabs,
  Modal,
  Drawer,
  TextInput,
  Select,
  NumberInput,
  Textarea,
  Badge,
  SegmentedControl,
  Pagination,
  ActionIcon
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  Plus,
  Gavel,
  Scale,
  Landmark,
  Users as UsersIcon,
  Shield,
  HeartHandshake,
  Briefcase,
  Wallet,
  LifeBuoy,
  AlertTriangle,
  MessageCircle,
  Send,
  Search,
  LayoutGrid,
  Table2,
  History,
  FileText,
  Trash2
} from 'lucide-react';
import { motion } from 'motion/react';
import { authFetch } from '@/lib/authFetch';
import { useSharedProfile } from '@/components/ProfileProvider';
import PageLoader from '@/components/PageLoader';
import { ESTADOS_BRASIL } from '@/lib/ddd';
import {
  LIMIAR_DIAS_ATENCAO,
  type CrmDepartamento,
  type CrmEtapa,
  type CrmItem,
  type CrmItemHistoricoEntrada,
  type CrmPipeline,
  type CrmResponsavel,
  type PipelineId,
  type WhatsappMensagem
} from '@/lib/crm';
import CrmTable from './_components/CrmTable';

const TEXT = '#fefefa';
const MUTED = 'rgba(254,254,250,0.6)';
const BORDER = 'rgba(255,255,255,0.12)';
const GOLD = '#c4a86f';
const DANGER = '#ee8c72';

const ICONE_PIPELINE: Record<string, typeof Gavel> = {
  andamento_processual: Gavel,
  trabalhista: Briefcase,
  tributario: Landmark,
  vara_familiar: HeartHandshake,
  criminal: Shield,
  previdenciario: Scale,
  processo_estrategico: UsersIcon,
  cobranca_financeiro: Wallet,
  relacionamento_cliente: LifeBuoy
};

interface PipelinesResposta {
  departamentos: CrmDepartamento[];
  pipelines: CrmPipeline[];
  etapas: CrmEtapa[];
  departamentosGerenciaveis: string[];
}

interface ItensResposta {
  itens: CrmItem[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 25;

const fmtReais = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function NovoItemModal({
  aberto,
  onFechar,
  pipeline,
  etapas,
  onCriado
}: {
  aberto: boolean;
  onFechar: () => void;
  pipeline: CrmPipeline | null;
  etapas: CrmEtapa[];
  onCriado: (item: CrmItem) => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [clienteNome, setClienteNome] = useState('');
  const [clienteDocumento, setClienteDocumento] = useState('');
  const [uf, setUf] = useState<string | null>(null);
  const [valorCausa, setValorCausa] = useState<number | ''>('');
  const [situacaoFinanceira, setSituacaoFinanceira] = useState<string | null>(null);
  const [etapaId, setEtapaId] = useState<string | null>(etapas[0]?.id ?? null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setTitulo('');
      setClienteNome('');
      setClienteDocumento('');
      setUf(null);
      setValorCausa('');
      setSituacaoFinanceira(null);
      setEtapaId(etapas[0]?.id ?? null);
    }
  }, [aberto, etapas]);

  async function salvar() {
    if (!pipeline || !etapaId || !titulo.trim()) return;
    setSalvando(true);
    try {
      const res = await authFetch('/api/crm/itens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipelineId: pipeline.id,
          etapaId,
          titulo: titulo.trim(),
          clienteNome: clienteNome.trim() || null,
          clienteDocumento: clienteDocumento.trim() || null,
          uf: uf || null,
          valorCausa: valorCausa === '' ? null : valorCausa,
          situacaoFinanceira: situacaoFinanceira || null
        })
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onCriado(data.item as CrmItem);
      notifications.show({ color: 'green', title: 'Item criado', message: titulo });
      onFechar();
    } catch {
      notifications.show({ color: 'red', title: 'Erro', message: 'Não foi possível criar o item.' });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal opened={aberto} onClose={onFechar} title={`Novo processo · ${pipeline?.nome ?? ''}`} centered>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TextInput label="Título" required value={titulo} onChange={e => setTitulo(e.currentTarget.value)} />
        <TextInput label="Cliente" value={clienteNome} onChange={e => setClienteNome(e.currentTarget.value)} />
        <TextInput label="CPF/CNPJ" value={clienteDocumento} onChange={e => setClienteDocumento(e.currentTarget.value)} />
        <div style={{ display: 'flex', gap: 12 }}>
          <Select
            label="UF"
            style={{ width: 160 }}
            data={ESTADOS_BRASIL.map(e => ({ value: e.uf, label: e.uf }))}
            value={uf}
            onChange={setUf}
            clearable
          />
          <NumberInput
            label="Valor da causa"
            style={{ flex: 1 }}
            value={valorCausa}
            onChange={v => setValorCausa(typeof v === 'number' ? v : '')}
            prefix="R$ "
            thousandSeparator="."
            decimalSeparator=","
          />
        </div>
        <Select
          label="Situação financeira"
          data={[{ value: 'adimplente', label: 'Adimplente' }, { value: 'inadimplente', label: 'Inadimplente' }]}
          value={situacaoFinanceira}
          onChange={setSituacaoFinanceira}
          clearable
        />
        <Select
          label="Etapa inicial"
          data={etapas.map(e => ({ value: e.id, label: e.nome }))}
          value={etapaId}
          onChange={setEtapaId}
        />
        <button
          onClick={salvar}
          disabled={salvando || !titulo.trim()}
          style={{
            marginTop: 8,
            padding: '10px 16px',
            borderRadius: 8,
            border: `1px solid ${GOLD}`,
            background: 'rgba(196,168,111,0.12)',
            color: GOLD,
            cursor: salvando ? 'default' : 'pointer',
            fontWeight: 600
          }}
        >
          {salvando ? 'Salvando…' : 'Criar processo'}
        </button>
      </div>
    </Modal>
  );
}

function NovoFunilModal({
  aberto,
  onFechar,
  departamentos,
  onCriado
}: {
  aberto: boolean;
  onFechar: () => void;
  departamentos: CrmDepartamento[];
  onCriado: (pipeline: CrmPipeline, etapas: CrmEtapa[]) => void;
}) {
  const [nome, setNome] = useState('');
  const [departamentoId, setDepartamentoId] = useState<string | null>(departamentos[0]?.id ?? null);
  const [etapas, setEtapas] = useState<string[]>(['Elaborar Processo', 'Em Andamento', 'Concluído']);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setNome('');
      setDepartamentoId(departamentos[0]?.id ?? null);
      setEtapas(['Elaborar Processo', 'Em Andamento', 'Concluído']);
    }
  }, [aberto, departamentos]);

  async function salvar() {
    const etapasValidas = etapas.map(e => e.trim()).filter(Boolean);
    if (!nome.trim() || !departamentoId || etapasValidas.length === 0) return;
    setSalvando(true);
    try {
      const res = await authFetch('/api/crm/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          departamentoId,
          etapas: etapasValidas.map((etapaNome, index) => ({
            nome: etapaNome,
            ehFinal: index === etapasValidas.length - 1
          }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erro');
      onCriado(data.pipeline as CrmPipeline, data.etapas as CrmEtapa[]);
      notifications.show({ color: 'green', title: 'Funil criado', message: nome });
      onFechar();
    } catch (e) {
      notifications.show({ color: 'red', title: 'Erro', message: e instanceof Error ? e.message : 'Não foi possível criar o funil.' });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal opened={aberto} onClose={onFechar} title="Novo funil" centered>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TextInput label="Nome do funil" required value={nome} onChange={e => setNome(e.currentTarget.value)} />
        <Select
          label="Departamento"
          data={departamentos.map(d => ({ value: d.id, label: d.nome }))}
          value={departamentoId}
          onChange={setDepartamentoId}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: TEXT, marginBottom: 6 }}>Etapas (em ordem)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {etapas.map((etapa, index) => (
              <div key={index} style={{ display: 'flex', gap: 6 }}>
                <TextInput
                  style={{ flex: 1 }}
                  placeholder={`Etapa ${index + 1}`}
                  value={etapa}
                  onChange={e => setEtapas(prev => prev.map((v, i) => (i === index ? e.currentTarget.value : v)))}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  disabled={etapas.length <= 1}
                  onClick={() => setEtapas(prev => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setEtapas(prev => [...prev, ''])}
            style={{
              marginTop: 8,
              padding: '6px 10px',
              borderRadius: 6,
              border: `1px dashed ${BORDER}`,
              background: 'transparent',
              color: MUTED,
              cursor: 'pointer',
              fontSize: 12.5
            }}
          >
            + Adicionar etapa
          </button>
        </div>
        <button
          onClick={salvar}
          disabled={salvando || !nome.trim() || !departamentoId}
          style={{
            marginTop: 8,
            padding: '10px 16px',
            borderRadius: 8,
            border: `1px solid ${GOLD}`,
            background: 'rgba(196,168,111,0.12)',
            color: GOLD,
            cursor: salvando ? 'default' : 'pointer',
            fontWeight: 600
          }}
        >
          {salvando ? 'Criando…' : 'Criar funil'}
        </button>
      </div>
    </Modal>
  );
}

function ConversasWhatsapp({ itemId }: { itemId: string }) {
  const [mensagens, setMensagens] = useState<WhatsappMensagem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [texto, setTexto] = useState('');
  const [numero, setNumero] = useState('');
  const [enviando, setEnviando] = useState(false);

  function carregar() {
    setCarregando(true);
    authFetch(`/api/whatsapp/mensagens?itemId=${itemId}`)
      .then(res => res.json())
      .then(data => setMensagens(data.mensagens ?? []))
      .catch(() => setMensagens([]))
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  async function enviar() {
    if (!texto.trim() || !numero.trim()) return;
    setEnviando(true);
    try {
      const res = await authFetch('/api/whatsapp/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero: numero.trim(), texto: texto.trim(), itemId })
      });
      const data = await res.json();
      if (data.mensagem) setMensagens(prev => [...prev, data.mensagem as WhatsappMensagem]);
      if (!res.ok || !data.enviado) {
        notifications.show({ color: 'red', title: 'Falha ao enviar', message: data.erro ?? 'Serviço de WhatsApp indisponível.' });
      } else {
        setTexto('');
        notifications.show({ color: 'green', title: 'Mensagem enviada', message: numero });
      }
    } catch {
      notifications.show({ color: 'red', title: 'Erro', message: 'Não foi possível enviar a mensagem.' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <TextInput
        label="Número de WhatsApp (destinatário)"
        placeholder="5511999998888"
        value={numero}
        onChange={e => setNumero(e.currentTarget.value)}
      />

      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: 10,
          maxHeight: 260,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: 'rgba(255,255,255,0.02)'
        }}
      >
        {carregando && <div style={{ color: MUTED, fontSize: 12.5 }}>Carregando conversas…</div>}
        {!carregando && mensagens.length === 0 && <div style={{ color: MUTED, fontSize: 12.5 }}>Nenhuma mensagem ainda.</div>}
        {mensagens.map(m => (
          <div
            key={m.id}
            style={{
              alignSelf: m.direcao === 'enviada' ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
              background: m.direcao === 'enviada' ? 'rgba(196,168,111,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${m.direcao === 'enviada' ? 'rgba(196,168,111,0.35)' : BORDER}`,
              borderRadius: 8,
              padding: '6px 10px'
            }}
          >
            <div style={{ color: TEXT, fontSize: 13 }}>{m.texto}</div>
            <div style={{ color: MUTED, fontSize: 10.5, marginTop: 2, display: 'flex', gap: 6 }}>
              <span>{new Date(m.createdAt).toLocaleString('pt-BR')}</span>
              {m.status === 'falhou' && <span style={{ color: DANGER }}>falhou</span>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Textarea
          placeholder="Escreva uma mensagem…"
          autosize
          minRows={1}
          maxRows={4}
          style={{ flex: 1 }}
          value={texto}
          onChange={e => setTexto(e.currentTarget.value)}
        />
        <button
          onClick={enviar}
          disabled={enviando || !texto.trim() || !numero.trim()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 14px',
            borderRadius: 8,
            border: `1px solid ${GOLD}`,
            background: 'rgba(196,168,111,0.12)',
            color: GOLD,
            cursor: enviando ? 'default' : 'pointer',
            fontWeight: 600,
            fontSize: 13
          }}
        >
          <Send size={14} /> Enviar
        </button>
      </div>
    </div>
  );
}

function HistoricoEtapas({ itemId, etapas }: { itemId: string; etapas: CrmEtapa[] }) {
  const [historico, setHistorico] = useState<CrmItemHistoricoEntrada[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    setCarregando(true);
    authFetch(`/api/crm/itens/${itemId}/historico`)
      .then(res => res.json())
      .then(data => setHistorico(data.historico ?? []))
      .catch(() => setHistorico([]))
      .finally(() => setCarregando(false));
  }, [itemId]);

  const nomeEtapa = (id: string | null) => etapas.find(e => e.id === id)?.nome ?? (id ? id : '—');

  if (carregando) return <div style={{ color: MUTED, fontSize: 12.5 }}>Carregando histórico…</div>;
  if (historico.length === 0) return <div style={{ color: MUTED, fontSize: 12.5 }}>Nenhuma movimentação de etapa registrada ainda.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {historico.map(h => (
        <div key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12.5 }}>
          <span style={{ color: MUTED, minWidth: 130 }}>{new Date(h.movidoEm).toLocaleString('pt-BR')}</span>
          <span style={{ color: TEXT }}>
            {h.etapaAnteriorId ? `${nomeEtapa(h.etapaAnteriorId)} → ${nomeEtapa(h.etapaNovaId)}` : `Criado em "${nomeEtapa(h.etapaNovaId)}"`}
          </span>
        </div>
      ))}
    </div>
  );
}

function DrawerDetalheItem({
  item,
  etapas,
  onFechar,
  onMoverEtapa
}: {
  item: CrmItem | null;
  etapas: CrmEtapa[];
  onFechar: () => void;
  onMoverEtapa: (item: CrmItem, novaEtapaId: string) => void;
}) {
  return (
    <Drawer opened={Boolean(item)} onClose={onFechar} position="right" size="lg" title={item?.titulo ?? ''}>
      {item && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ color: MUTED, fontSize: 11.5, textTransform: 'uppercase' }}>Cliente</div>
              <div style={{ color: TEXT, fontSize: 14 }}>{item.clienteNome || '—'}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontSize: 11.5, textTransform: 'uppercase' }}>CPF/CNPJ</div>
              <div style={{ color: TEXT, fontSize: 14 }}>{item.clienteDocumento || '—'}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontSize: 11.5, textTransform: 'uppercase' }}>UF</div>
              <div style={{ color: TEXT, fontSize: 14 }}>{item.uf || '—'}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontSize: 11.5, textTransform: 'uppercase' }}>Valor da causa</div>
              <div style={{ color: TEXT, fontSize: 14 }}>{item.valorCausa != null ? fmtReais(item.valorCausa) : '—'}</div>
            </div>
            {item.situacaoFinanceira && (
              <div>
                <div style={{ color: MUTED, fontSize: 11.5, textTransform: 'uppercase' }}>Situação financeira</div>
                <Badge size="sm" variant="outline" color={item.situacaoFinanceira === 'inadimplente' ? 'red' : 'teal'}>
                  {item.situacaoFinanceira === 'inadimplente' ? 'Inadimplente' : 'Adimplente'}
                </Badge>
              </div>
            )}
          </div>

          <Select
            label="Etapa"
            data={etapas.map(e => ({ value: e.id, label: e.nome }))}
            value={item.etapaId}
            onChange={v => v && onMoverEtapa(item, v)}
          />

          {item.processoId && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: TEXT, fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                <FileText size={15} /> Processo vinculado
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                <div>
                  <div style={{ color: MUTED, fontSize: 11 }}>CNJ</div>
                  <div style={{ color: TEXT, fontFamily: 'monospace' }}>{item.numeroCnj || '—'}</div>
                </div>
                <div>
                  <div style={{ color: MUTED, fontSize: 11 }}>Tribunal</div>
                  <div style={{ color: TEXT }}>{item.tribunal || '—'}</div>
                </div>
                <div>
                  <div style={{ color: MUTED, fontSize: 11 }}>Classe</div>
                  <div style={{ color: TEXT }}>{item.classe || '—'}</div>
                </div>
                <div>
                  <div style={{ color: MUTED, fontSize: 11 }}>Status</div>
                  <div style={{ color: TEXT }}>{item.statusProcesso || '—'}</div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ color: MUTED, fontSize: 11 }}>Assunto</div>
                  <div style={{ color: TEXT }}>{item.assunto || '—'}</div>
                </div>
              </div>
            </div>
          )}

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: TEXT, fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
              <History size={15} /> Histórico de etapas
            </div>
            <HistoricoEtapas itemId={item.id} etapas={etapas} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: TEXT, fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
              <MessageCircle size={15} /> Conversas (WhatsApp interno)
            </div>
            <ConversasWhatsapp itemId={item.id} />
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default function CrmPage() {
  useSharedProfile();
  const [dados, setDados] = useState<PipelinesResposta | null>(null);
  const [pipelineAtivo, setPipelineAtivo] = useState<PipelineId | null>(null);
  const [itens, setItens] = useState<CrmItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [carregandoItens, setCarregandoItens] = useState(false);
  const [modalNovoAberto, setModalNovoAberto] = useState(false);
  const [modalFunilAberto, setModalFunilAberto] = useState(false);
  const [itemDetalhe, setItemDetalhe] = useState<CrmItem | null>(null);
  const [visualizacao, setVisualizacao] = useState<'kanban' | 'tabela'>('tabela');

  const [busca, setBusca] = useState('');
  const [buscaDebounced] = useDebouncedValue(busca, 400);
  const [filtroResponsavel, setFiltroResponsavel] = useState<string | null>(null);
  const [filtroUf, setFiltroUf] = useState<string | null>(null);
  const [filtroSituacao, setFiltroSituacao] = useState<string | null>(null);
  const [responsaveis, setResponsaveis] = useState<CrmResponsavel[]>([]);

  function carregarPipelines() {
    authFetch('/api/crm/pipelines')
      .then(res => res.json())
      .then((data: PipelinesResposta) => {
        setDados(data);
        setPipelineAtivo(prev => prev ?? data.pipelines[0]?.id ?? null);
      })
      .catch(() => setDados({ departamentos: [], pipelines: [], etapas: [], departamentosGerenciaveis: [] }));
  }

  useEffect(() => {
    carregarPipelines();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [pipelineAtivo, buscaDebounced, filtroResponsavel, filtroUf, filtroSituacao]);

  useEffect(() => {
    if (!pipelineAtivo) return;
    setCarregandoItens(true);
    const params = new URLSearchParams({ pipelineId: pipelineAtivo, page: String(page), pageSize: String(PAGE_SIZE) });
    if (buscaDebounced.trim()) params.set('busca', buscaDebounced.trim());
    if (filtroResponsavel) params.set('responsavelId', filtroResponsavel);
    if (filtroUf) params.set('uf', filtroUf);
    if (filtroSituacao) params.set('situacaoFinanceira', filtroSituacao);

    authFetch(`/api/crm/itens?${params.toString()}`)
      .then(res => res.json())
      .then((data: ItensResposta) => {
        setItens(data.itens ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {
        setItens([]);
        setTotal(0);
      })
      .finally(() => setCarregandoItens(false));
  }, [pipelineAtivo, page, buscaDebounced, filtroResponsavel, filtroUf, filtroSituacao]);

  const pipeline = useMemo(() => dados?.pipelines.find(p => p.id === pipelineAtivo) ?? null, [dados, pipelineAtivo]);

  useEffect(() => {
    if (!pipeline) {
      setResponsaveis([]);
      return;
    }
    authFetch(`/api/crm/responsaveis?departamentoId=${pipeline.departamentoId}`)
      .then(res => res.json())
      .then(data => setResponsaveis(data.responsaveis ?? []))
      .catch(() => setResponsaveis([]));
  }, [pipeline]);

  const etapasDoPipeline = useMemo(
    () => (dados?.etapas ?? []).filter(e => e.pipelineId === pipelineAtivo),
    [dados, pipelineAtivo]
  );

  const podeCriarFunil = (dados?.departamentosGerenciaveis.length ?? 0) > 0;

  async function moverEtapa(item: CrmItem, novaEtapaId: string) {
    setItens(prev => prev.map(i => (i.id === item.id ? { ...i, etapaId: novaEtapaId } : i)));
    try {
      const res = await authFetch(`/api/crm/itens/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etapaId: novaEtapaId })
      });
      if (!res.ok) throw new Error();
    } catch {
      setItens(prev => prev.map(i => (i.id === item.id ? { ...i, etapaId: item.etapaId } : i)));
      notifications.show({ color: 'red', title: 'Erro', message: 'Não foi possível mover o item.' });
    }
  }

  if (!dados) {
    return <PageLoader label="Carregando CRM…" />;
  }

  if (dados.pipelines.length === 0) {
    return (
      <div style={{ padding: 24, color: MUTED }}>
        Você ainda não tem acesso a nenhum pipeline do CRM. Peça a um administrador para te incluir em um departamento.
      </div>
    );
  }

  const comAlerta = itens.filter(i => (i.diasSemMovimentacao ?? 0) >= LIMIAR_DIAS_ATENCAO).length;
  const valorTotal = itens.reduce((acc, i) => acc + (i.valorCausa ?? 0), 0);
  const adimplentesCount = itens.filter(i => i.situacaoFinanceira === 'adimplente').length;
  const pctAdimplentes = itens.length > 0 ? Math.round((adimplentesCount / itens.length) * 100) : 0;
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ padding: '28px 32px 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: GOLD }}>
            Departamento Jurídico
          </div>
          <h1 style={{ margin: '4px 0 0', fontSize: 28, lineHeight: '34px', letterSpacing: '0.03em', fontWeight: 600, color: TEXT }}>
            {pipeline?.nome ?? ''}
          </h1>
        </div>
        <button
          onClick={() => setModalNovoAberto(true)}
          disabled={!pipeline}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 10,
            border: 'none',
            background: GOLD,
            color: '#232323',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer'
          }}
        >
          <Plus size={16} strokeWidth={2.4} />
          Novo processo
        </button>
      </div>

      <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
        <Metrica label="Processos" valor={String(total)} />
        <Metrica label="Com alerta (nesta página)" valor={String(comAlerta)} cor={DANGER} icone={<AlertTriangle size={16} strokeWidth={2.2} />} />
        <Metrica label="Valor total das causas (nesta página)" valor={fmtReais(valorTotal)} />
        <Metrica label="Adimplentes (nesta página)" valor={`${pctAdimplentes}%`} />
      </div>

      <Tabs value={pipelineAtivo} onChange={v => v && v !== '__novo_funil__' && setPipelineAtivo(v)}>
        <Tabs.List>
          {dados.pipelines.map(p => {
            const Icone = ICONE_PIPELINE[p.id] ?? Gavel;
            return (
              <Tabs.Tab key={p.id} value={p.id} leftSection={<Icone size={15} />}>
                {p.nome}
              </Tabs.Tab>
            );
          })}
          {podeCriarFunil && (
            <Tabs.Tab value="__novo_funil__" onClick={() => setModalFunilAberto(true)} leftSection={<Plus size={15} />}>
              Novo funil
            </Tabs.Tab>
          )}
        </Tabs.List>
      </Tabs>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <TextInput
          placeholder="Buscar por CNJ, nome ou CPF"
          leftSection={<Search size={15} />}
          variant="filled"
          style={{ flex: 1, minWidth: 240 }}
          value={busca}
          onChange={e => setBusca(e.currentTarget.value)}
        />
        <Select
          placeholder="Responsável"
          variant="filled"
          data={responsaveis.map(r => ({ value: r.id, label: r.nome }))}
          value={filtroResponsavel}
          onChange={setFiltroResponsavel}
          clearable
          style={{ width: 180 }}
        />
        <Select
          placeholder="UF"
          variant="filled"
          data={ESTADOS_BRASIL.map(e => ({ value: e.uf, label: e.uf }))}
          value={filtroUf}
          onChange={setFiltroUf}
          clearable
          style={{ width: 110 }}
        />
        <Select
          placeholder="Situação"
          variant="filled"
          data={[{ value: 'adimplente', label: 'Adimplente' }, { value: 'inadimplente', label: 'Inadimplente' }]}
          value={filtroSituacao}
          onChange={setFiltroSituacao}
          clearable
          style={{ width: 150 }}
        />
        <SegmentedControl
          value={visualizacao}
          onChange={v => setVisualizacao(v as 'kanban' | 'tabela')}
          transitionDuration={250}
          data={[
            { label: <IconLabel icon={<LayoutGrid size={14} />} label="Kanban" />, value: 'kanban' },
            { label: <IconLabel icon={<Table2 size={14} />} label="Tabela" />, value: 'tabela' }
          ]}
        />
      </div>

      {carregandoItens ? (
        <div style={{ color: MUTED, padding: 24 }}>Carregando itens…</div>
      ) : visualizacao === 'tabela' ? (
        <>
          <CrmTable itens={itens} etapas={etapasDoPipeline} responsaveis={responsaveis} onAbrirItem={setItemDetalhe} />
          {totalPaginas > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Pagination value={page} onChange={setPage} total={totalPaginas} color="brand" />
            </div>
          )}
        </>
      ) : (
        <KanbanView
          etapas={etapasDoPipeline}
          itens={itens}
          onAbrirItem={setItemDetalhe}
        />
      )}

      <NovoItemModal
        aberto={modalNovoAberto}
        onFechar={() => setModalNovoAberto(false)}
        pipeline={pipeline}
        etapas={etapasDoPipeline}
        onCriado={item => {
          setItens(prev => [item, ...prev]);
          setTotal(prev => prev + 1);
        }}
      />

      <NovoFunilModal
        aberto={modalFunilAberto}
        onFechar={() => setModalFunilAberto(false)}
        departamentos={(dados.departamentos ?? []).filter(d => dados.departamentosGerenciaveis.includes(d.id))}
        onCriado={(novoPipeline, novasEtapas) => {
          setDados(prev =>
            prev
              ? { ...prev, pipelines: [...prev.pipelines, novoPipeline], etapas: [...prev.etapas, ...novasEtapas] }
              : prev
          );
          setPipelineAtivo(novoPipeline.id);
        }}
      />

      <DrawerDetalheItem
        item={itemDetalhe}
        etapas={etapasDoPipeline}
        onFechar={() => setItemDetalhe(null)}
        onMoverEtapa={(item, novaEtapaId) => {
          moverEtapa(item, novaEtapaId);
          setItemDetalhe(prev => (prev && prev.id === item.id ? { ...prev, etapaId: novaEtapaId } : prev));
        }}
      />
    </div>
  );
}

function Metrica({ label, valor, cor, icone }: { label: string; valor: string; cor?: string; icone?: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 22, fontWeight: 600, color: cor ?? TEXT }}>
        {icone}
        {valor}
      </div>
    </div>
  );
}

function IconLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {icon}
      {label}
    </span>
  );
}

function KanbanView({
  etapas,
  itens,
  onAbrirItem
}: {
  etapas: CrmEtapa[];
  itens: CrmItem[];
  onAbrirItem: (item: CrmItem) => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${etapas.length}, minmax(230px, 1fr))`,
        gap: 12,
        overflowX: 'auto',
        paddingBottom: 8
      }}
    >
      {etapas.map(etapa => {
        const itensDaEtapa = itens.filter(i => i.etapaId === etapa.id);
        return (
          <div key={etapa.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 230 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: etapa.cor ?? GOLD, display: 'inline-block' }} />
              <span style={{ color: TEXT, fontWeight: 600, fontSize: 13 }}>{etapa.nome}</span>
              <span style={{ color: MUTED, fontSize: 12 }}>({itensDaEtapa.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {itensDaEtapa.map(item => (
                <CardItem key={item.id} item={item} etapa={etapa} onClick={() => onAbrirItem(item)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CardItem({ item, etapa, onClick }: { item: CrmItem; etapa: CrmEtapa | undefined; onClick: () => void }) {
  const emAtencao = (item.diasSemMovimentacao ?? 0) >= LIMIAR_DIAS_ATENCAO;
  return (
    <motion.div
      layout
      onClick={onClick}
      whileHover={{ y: -2 }}
      style={{
        border: `1px solid ${emAtencao ? 'rgba(238,140,114,0.4)' : BORDER}`,
        borderLeft: `3px solid ${etapa?.cor ?? GOLD}`,
        borderRadius: 10,
        padding: '10px 12px',
        background: 'rgba(255,255,255,0.03)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      <div style={{ fontWeight: 600, color: TEXT, fontSize: 14 }}>{item.titulo}</div>
      {item.clienteNome && <div style={{ fontSize: 12.5, color: MUTED }}>{item.clienteNome}</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
        {item.uf && <Badge size="xs" variant="outline" color="gray">{item.uf}</Badge>}
        {item.valorCausa != null && (
          <Badge size="xs" variant="outline" color="gray">
            {fmtReais(item.valorCausa)}
          </Badge>
        )}
        {item.situacaoFinanceira && (
          <Badge size="xs" variant="outline" color={item.situacaoFinanceira === 'inadimplente' ? 'red' : 'teal'}>
            {item.situacaoFinanceira === 'inadimplente' ? 'Inadimplente' : 'Adimplente'}
          </Badge>
        )}
      </div>
      {item.diasSemMovimentacao != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: emAtencao ? DANGER : MUTED, marginTop: 2 }}>
          {emAtencao && <AlertTriangle size={12} />}
          {item.diasSemMovimentacao === 0 ? 'Movimentou hoje' : `${item.diasSemMovimentacao} dia(s) sem movimentação`}
        </div>
      )}
    </motion.div>
  );
}
