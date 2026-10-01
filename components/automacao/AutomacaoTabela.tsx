'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Group, NumberInput, Pagination, Select, Table, TextInput } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Play, Search } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { ESFERA_LABEL, STATUS_LABEL, type AutomacaoDeal, type AutomacaoRegra } from '@/lib/automacao';
import ModalDetalheDeal from './ModalDetalheDeal';

interface Props {
  regra: AutomacaoRegra;
}

interface Filtros {
  esfera: string | null;
  valorMin: number | '';
  valorMax: number | '';
  busca: string;
}

const FILTROS_VAZIOS: Filtros = { esfera: null, valorMin: '', valorMax: '', busca: '' };
const PAGE_SIZE = 10;

const STATUS_COR: Record<AutomacaoDeal['status'], string> = {
  pendente: 'gray',
  processando: 'blue',
  enriquecido: 'teal',
  sem_processo: 'yellow',
  erro: 'red'
};

const fmtValor = (v: number | null) => (v !== null ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');
const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

export default function AutomacaoTabela({ regra }: Props) {
  const [page, setPage] = useState(1);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [filtrosAplicados, setFiltrosAplicados] = useState<Filtros>(FILTROS_VAZIOS);
  const [deals, setDeals] = useState<AutomacaoDeal[] | null>(null);
  const [total, setTotal] = useState(0);
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState<{ atual: number; meta: number } | null>(null);
  const [dealSelecionado, setDealSelecionado] = useState<AutomacaoDeal | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  const carregarDeals = useCallback(async () => {
    const params = new URLSearchParams({ regraId: regra.id, page: String(page), pageSize: String(PAGE_SIZE) });
    if (filtrosAplicados.esfera) params.set('esfera', filtrosAplicados.esfera);
    if (filtrosAplicados.valorMin !== '') params.set('valorMin', String(filtrosAplicados.valorMin));
    if (filtrosAplicados.valorMax !== '') params.set('valorMax', String(filtrosAplicados.valorMax));
    if (filtrosAplicados.busca.trim()) params.set('busca', filtrosAplicados.busca.trim());

    const res = await authFetch(`/api/automacao/deals?${params.toString()}`);
    const data = await res.json();
    setDeals(data.deals ?? []);
    setTotal(data.total ?? 0);
  }, [regra.id, page, filtrosAplicados]);

  useEffect(() => {
    carregarDeals();
  }, [carregarDeals]);

  const aplicarFiltros = () => {
    setFiltrosAplicados(filtros);
    setPage(1);
  };

  const buscarProximos = async () => {
    setProcessando(true);
    setProgresso({ atual: 0, meta: regra.tamanhoLote });
    try {
      const res = await authFetch('/api/automacao/processar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regraId: regra.id })
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      let atual = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const linhas = buffer.split('\n');
        buffer = linhas.pop() ?? '';
        for (const linha of linhas) {
          if (!linha.trim()) continue;
          const evento = JSON.parse(linha);
          if (evento.type === 'progress' && evento.dealId) {
            atual += 1;
            setProgresso({ atual, meta: regra.tamanhoLote });
          }
        }
      }
    } finally {
      setProcessando(false);
      setProgresso(null);
      setPage(1);
      await carregarDeals();
    }
  };

  const abrirDetalhe = (deal: AutomacaoDeal) => {
    setDealSelecionado(deal);
    openModal();
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <Select
          placeholder="Todas as esferas"
          data={Object.entries(ESFERA_LABEL).map(([value, label]) => ({ value, label }))}
          clearable
          value={filtros.esfera}
          onChange={v => setFiltros(f => ({ ...f, esfera: v }))}
        />
        <NumberInput
          placeholder="Valor mínimo"
          value={filtros.valorMin}
          onChange={v => setFiltros(f => ({ ...f, valorMin: v === '' ? '' : Number(v) }))}
          decimalScale={2}
        />
        <NumberInput
          placeholder="Valor máximo"
          value={filtros.valorMax}
          onChange={v => setFiltros(f => ({ ...f, valorMax: v === '' ? '' : Number(v) }))}
          decimalScale={2}
        />
        <TextInput
          placeholder="Buscar processo ou título..."
          leftSection={<Search size={14} />}
          value={filtros.busca}
          onChange={e => setFiltros(f => ({ ...f, busca: e.currentTarget.value }))}
        />
        <Button variant="filled" onClick={aplicarFiltros}>
          Filtrar
        </Button>
      </div>

      <Group justify="space-between" mt="md">
        <Button leftSection={<Play size={16} />} onClick={buscarProximos} loading={processando}>
          {processando && progresso ? `Processando ${progresso.atual}/${progresso.meta}...` : `Buscar próximos ${regra.tamanhoLote}`}
        </Button>
        <Badge color="gray" variant="light">
          {total} deal(s) processado(s)
        </Badge>
      </Group>

      <div className="mt-4 overflow-x-auto">
        {deals === null && <p className="p-6 text-sm text-white/60">Carregando…</p>}
        {deals?.length === 0 && (
          <p className="p-6 text-sm text-white/60">Nenhum deal processado ainda nesta regra — clique em &quot;Buscar&quot; para começar.</p>
        )}
        {!!deals?.length && (
          <div className="min-w-[860px]">
            <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="!text-white/60">Deal</Table.Th>
                  <Table.Th className="!text-white/60">Nº processo</Table.Th>
                  <Table.Th className="!text-white/60">Tribunal</Table.Th>
                  <Table.Th className="!text-white/60">Esfera</Table.Th>
                  <Table.Th className="!text-white/60">Valor</Table.Th>
                  <Table.Th className="!text-white/60">Status</Table.Th>
                  <Table.Th className="!text-white/60">Atualização</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {deals.map(deal => (
                  <Table.Tr key={deal.id} onClick={() => abrirDetalhe(deal)} style={{ cursor: 'pointer' }}>
                    <Table.Td className="!text-white font-medium">
                      {deal.dealTitulo ?? `Deal #${deal.dealId}`}
                    </Table.Td>
                    <Table.Td className="!text-white/70">{deal.numeroCnjFormatado ?? '—'}</Table.Td>
                    <Table.Td className="!text-white/70">{deal.tribunalLabel ?? '—'}</Table.Td>
                    <Table.Td className="!text-white/70">{deal.esfera ? ESFERA_LABEL[deal.esfera] : '—'}</Table.Td>
                    <Table.Td className="!text-white/70">{fmtValor(deal.valorDeal)}</Table.Td>
                    <Table.Td>
                      <Badge color={STATUS_COR[deal.status]} variant="light">
                        {STATUS_LABEL[deal.status]}
                      </Badge>
                    </Table.Td>
                    <Table.Td className="!text-white/70">{fmtData(deal.processadoEm)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            {deals.length === 0 && filtrosAplicados !== FILTROS_VAZIOS && (
              <p className="mt-4 text-center text-sm text-white/60">Nenhum deal corresponde aos filtros aplicados.</p>
            )}
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
        <Group justify="center" mt="md">
          <Pagination total={Math.ceil(total / PAGE_SIZE)} value={page} onChange={setPage} />
        </Group>
      )}

      <ModalDetalheDeal opened={modalOpened} onClose={closeModal} deal={dealSelecionado} />
    </div>
  );
}
