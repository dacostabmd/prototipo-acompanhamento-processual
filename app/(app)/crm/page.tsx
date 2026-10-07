'use client';

import { useEffect, useMemo, useState } from 'react';
import { Tabs, Modal, TextInput, Select, NumberInput, Textarea, Badge } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Plus, Gavel, Scale, Landmark, Users as UsersIcon, Shield, HeartHandshake, Briefcase, Wallet, LifeBuoy, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { authFetch } from '@/lib/authFetch';
import { useSharedProfile } from '@/components/ProfileProvider';
import {
  LIMIAR_DIAS_ATENCAO,
  type CrmDepartamento,
  type CrmEtapa,
  type CrmItem,
  type CrmPipeline,
  type PipelineId
} from '@/lib/crm';

const TEXT = '#ffffff';
const MUTED = 'rgba(229,231,235,0.75)';
const BORDER = 'rgba(255,255,255,0.12)';
const BLUE = '#c4a86f';

const ICONE_PIPELINE: Record<PipelineId, typeof Gavel> = {
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
}

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
    <Modal opened={aberto} onClose={onFechar} title={`Novo item · ${pipeline?.nome ?? ''}`} centered>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TextInput label="Título" required value={titulo} onChange={e => setTitulo(e.currentTarget.value)} />
        <TextInput label="Cliente" value={clienteNome} onChange={e => setClienteNome(e.currentTarget.value)} />
        <TextInput label="CPF/CNPJ" value={clienteDocumento} onChange={e => setClienteDocumento(e.currentTarget.value)} />
        <div style={{ display: 'flex', gap: 12 }}>
          <TextInput label="UF" maxLength={2} style={{ width: 80 }} value={uf ?? ''} onChange={e => setUf(e.currentTarget.value.toUpperCase())} />
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
            border: `1px solid ${BLUE}`,
            background: 'rgba(196,168,111,0.12)',
            color: BLUE,
            cursor: salvando ? 'default' : 'pointer',
            fontWeight: 600
          }}
        >
          {salvando ? 'Salvando…' : 'Criar item'}
        </button>
      </div>
    </Modal>
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
        border: `1px solid ${emAtencao ? 'rgba(248,113,113,0.4)' : BORDER}`,
        borderLeft: `3px solid ${etapa?.cor ?? BLUE}`,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: emAtencao ? '#f87171' : MUTED, marginTop: 2 }}>
          {emAtencao && <AlertTriangle size={12} />}
          {item.diasSemMovimentacao === 0 ? 'Movimentou hoje' : `${item.diasSemMovimentacao} dia(s) sem movimentação`}
        </div>
      )}
    </motion.div>
  );
}

export default function CrmPage() {
  const { profile } = useSharedProfile();
  const [dados, setDados] = useState<PipelinesResposta | null>(null);
  const [pipelineAtivo, setPipelineAtivo] = useState<PipelineId | null>(null);
  const [itens, setItens] = useState<CrmItem[]>([]);
  const [carregandoItens, setCarregandoItens] = useState(false);
  const [modalNovoAberto, setModalNovoAberto] = useState(false);

  useEffect(() => {
    authFetch('/api/crm/pipelines')
      .then(res => res.json())
      .then((data: PipelinesResposta) => {
        setDados(data);
        if (data.pipelines.length > 0) setPipelineAtivo(data.pipelines[0].id);
      })
      .catch(() => setDados({ departamentos: [], pipelines: [], etapas: [] }));
  }, []);

  useEffect(() => {
    if (!pipelineAtivo) return;
    setCarregandoItens(true);
    authFetch(`/api/crm/itens?pipelineId=${pipelineAtivo}`)
      .then(res => res.json())
      .then(data => setItens(data.itens ?? []))
      .catch(() => setItens([]))
      .finally(() => setCarregandoItens(false));
  }, [pipelineAtivo]);

  const etapasDoPipeline = useMemo(
    () => (dados?.etapas ?? []).filter(e => e.pipelineId === pipelineAtivo),
    [dados, pipelineAtivo]
  );

  const pipeline = useMemo(() => dados?.pipelines.find(p => p.id === pipelineAtivo) ?? null, [dados, pipelineAtivo]);

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
    return <div style={{ padding: 24, color: MUTED }}>Carregando CRM…</div>;
  }

  if (dados.pipelines.length === 0) {
    return (
      <div style={{ padding: 24, color: MUTED }}>
        Você ainda não tem acesso a nenhum pipeline do CRM. Peça a um administrador para te incluir em um departamento.
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ color: TEXT, fontSize: 22, fontWeight: 700, margin: 0 }}>CRM Jurídico</h1>
          <p style={{ color: MUTED, fontSize: 13, margin: '4px 0 0' }}>
            Pipelines por departamento, espelhando o fluxo real do escritório.
          </p>
        </div>
        <button
          onClick={() => setModalNovoAberto(true)}
          disabled={!pipeline}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 8,
            border: `1px solid ${BLUE}`,
            background: 'rgba(196,168,111,0.12)',
            color: BLUE,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13
          }}
        >
          <Plus size={16} /> Novo item
        </button>
      </div>

      <Tabs value={pipelineAtivo} onChange={v => setPipelineAtivo(v as PipelineId)}>
        <Tabs.List>
          {dados.pipelines.map(p => {
            const Icone = ICONE_PIPELINE[p.id] ?? Gavel;
            return (
              <Tabs.Tab key={p.id} value={p.id} leftSection={<Icone size={15} />}>
                {p.nome}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </Tabs>

      {carregandoItens ? (
        <div style={{ color: MUTED, padding: 24 }}>Carregando itens…</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${etapasDoPipeline.length}, minmax(230px, 1fr))`,
            gap: 12,
            overflowX: 'auto',
            paddingBottom: 8
          }}
        >
          {etapasDoPipeline.map(etapa => {
            const itensDaEtapa = itens.filter(i => i.etapaId === etapa.id);
            return (
              <div key={etapa.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 230 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: etapa.cor ?? BLUE, display: 'inline-block' }} />
                  <span style={{ color: TEXT, fontWeight: 600, fontSize: 13 }}>{etapa.nome}</span>
                  <span style={{ color: MUTED, fontSize: 12 }}>({itensDaEtapa.length})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {itensDaEtapa.map(item => (
                    <CardItem
                      key={item.id}
                      item={item}
                      etapa={etapa}
                      onClick={() => {
                        const proxima = etapasDoPipeline[(etapasDoPipeline.findIndex(e => e.id === etapa.id) + 1) % etapasDoPipeline.length];
                        if (proxima) moverEtapa(item, proxima.id);
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NovoItemModal
        aberto={modalNovoAberto}
        onFechar={() => setModalNovoAberto(false)}
        pipeline={pipeline}
        etapas={etapasDoPipeline}
        onCriado={item => setItens(prev => [item, ...prev])}
      />
    </div>
  );
}
