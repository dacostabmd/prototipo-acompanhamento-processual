'use client';

import { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Badge, Button, Group, Pagination, Select, Table, Tooltip, TextInput } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Eye, Plus, Search } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { ESFERA_LABEL, STATUS_ENRIQUECIMENTO_LABEL, type CrmEtapa, type CrmItem, type CrmPipeline, type CrmPipelineCampo, type CrmTipoCampo } from '@/lib/crm';
import ModalDetalheItem from './ModalDetalheItem';
import ModalNovoItem from './ModalNovoItem';

interface Props {
  pipeline: CrmPipeline;
  etapas: CrmEtapa[];
  campos: CrmPipelineCampo[];
  tipos: CrmTipoCampo[];
}

const PAGE_SIZE = 10;
const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

export default function CrmTabela({ pipeline, etapas, campos, tipos }: Props) {
  const [page, setPage] = useState(1);
  const [etapaFiltro, setEtapaFiltro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [itens, setItens] = useState<CrmItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [itemSelecionado, setItemSelecionado] = useState<CrmItem | null>(null);
  const [modalDetalheOpened, { open: openDetalhe, close: closeDetalhe }] = useDisclosure(false);
  const [modalNovoOpened, { open: openNovo, close: closeNovo }] = useDisclosure(false);

  const carregarItens = useCallback(async () => {
    const params = new URLSearchParams({ pipelineId: pipeline.id, page: String(page), pageSize: String(PAGE_SIZE) });
    if (etapaFiltro) params.set('etapaId', etapaFiltro);
    if (buscaAplicada.trim()) params.set('busca', buscaAplicada.trim());

    const res = await authFetch(`/api/crm/itens?${params.toString()}`);
    const data = await res.json();
    setItens(data.itens ?? []);
    setTotal(data.total ?? 0);
  }, [pipeline.id, page, etapaFiltro, buscaAplicada]);

  useEffect(() => {
    carregarItens();
  }, [carregarItens]);

  const etapaNome = (id: string) => etapas.find(e => e.id === id)?.nome ?? '—';

  const abrirDetalhe = (item: CrmItem) => {
    setItemSelecionado(item);
    openDetalhe();
  };

  const onItemCriado = (item: CrmItem) => {
    setItens(prev => [item, ...(prev ?? [])]);
    setTotal(t => t + 1);
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Select
          placeholder="Todas as etapas"
          data={etapas.map(e => ({ value: e.id, label: e.nome }))}
          clearable
          value={etapaFiltro}
          onChange={setEtapaFiltro}
        />
        <TextInput
          placeholder="Buscar por título ou processo..."
          leftSection={<Search size={14} />}
          value={busca}
          onChange={e => setBusca(e.currentTarget.value)}
        />
        <Button variant="filled" onClick={() => { setBuscaAplicada(busca); setPage(1); }}>
          Filtrar
        </Button>
        <Button leftSection={<Plus size={16} />} onClick={openNovo} variant="light">
          Novo item
        </Button>
      </div>

      <Group justify="flex-end" mt="md">
        <Badge color="gray" variant="light">
          {total} item(ns)
        </Badge>
      </Group>

      <div className="relative mt-4 overflow-x-auto">
        {itens === null && <p className="p-6 text-sm text-white/60">Carregando…</p>}
        {itens?.length === 0 && (
          <p className="p-6 text-sm text-white/60">Nenhum item ainda neste pipeline — clique em &quot;Novo item&quot; para começar.</p>
        )}
        {!!itens?.length && (
          <div className="min-w-[860px]">
            <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="!text-white/60">Item</Table.Th>
                  <Table.Th className="!text-white/60">Etapa</Table.Th>
                  <Table.Th className="!text-white/60">Nº processo</Table.Th>
                  <Table.Th className="!text-white/60">Esfera</Table.Th>
                  <Table.Th className="!text-white/60">Status</Table.Th>
                  <Table.Th className="!text-white/60">Criado em</Table.Th>
                  <Table.Th className="!text-white/60">Ações</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {itens.map(item => (
                  <Table.Tr key={item.id}>
                    <Table.Td className="!text-white font-medium">{item.titulo}</Table.Td>
                    <Table.Td className="!text-white/70">{etapaNome(item.etapaId)}</Table.Td>
                    <Table.Td className="!text-white/70">{item.numeroCnjFormatado ?? '—'}</Table.Td>
                    <Table.Td className="!text-white/70">{item.esfera ? ESFERA_LABEL[item.esfera] : '—'}</Table.Td>
                    <Table.Td>
                      <Badge
                        size="sm"
                        color={item.statusEnriquecimento === 'enriquecido' ? 'green' : item.statusEnriquecimento === 'erro' ? 'red' : 'gray'}
                        variant="light"
                      >
                        {STATUS_ENRIQUECIMENTO_LABEL[item.statusEnriquecimento]}
                      </Badge>
                    </Table.Td>
                    <Table.Td className="!text-white/70">{fmtData(item.createdAt)}</Table.Td>
                    <Table.Td>
                      <Tooltip label="Ver detalhes">
                        <ActionIcon variant="subtle" onClick={() => abrirDetalhe(item)} aria-label="Ver detalhes" className="bf-neon-btn">
                          <Eye size={16} strokeWidth={2.2} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
        <Group justify="center" mt="md">
          <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page} onChange={setPage} />
        </Group>
      )}

      <ModalDetalheItem opened={modalDetalheOpened} onClose={closeDetalhe} item={itemSelecionado} campos={campos} tipos={tipos} />
      <ModalNovoItem
        opened={modalNovoOpened}
        onClose={closeNovo}
        pipelineId={pipeline.id}
        etapas={etapas}
        campos={campos}
        tipos={tipos}
        onSalvo={onItemCriado}
      />
    </div>
  );
}
