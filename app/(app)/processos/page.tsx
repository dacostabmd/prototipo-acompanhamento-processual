'use client';

import { useEffect, useMemo, useState } from 'react';
import { Table, TextInput, Select } from '@mantine/core';
import { Gavel, Search } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useProfile } from '@/lib/useProfile';

interface Processo {
  id: string;
  numero_cnj: string;
  tribunal: string | null;
  classe: string | null;
  parte_passiva: string | null;
  ultima_movimentacao_em: string | null;
  created_at: string;
}

interface Filtros {
  numero: string;
  tribunal: string | null;
  classe: string | null;
  parteContraria: string;
  ultimaMovimentacao: string;
}

const FILTROS_VAZIOS: Filtros = { numero: '', tribunal: null, classe: null, parteContraria: '', ultimaMovimentacao: '' };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

export default function Processos() {
  const [lista, setLista] = useState<Processo[] | null>(null);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const { profile } = useProfile();
  const isConsultante = profile.role === 'cliente';

  useEffect(() => {
    authFetch('/api/processos/listar')
      .then(res => res.json())
      .then(data => setLista(data.processos ?? []))
      .catch(() => setLista([]));
  }, []);

  const opcoesTribunal = useMemo(
    () => Array.from(new Set((lista ?? []).map(p => p.tribunal).filter((v): v is string => !!v))).sort(),
    [lista]
  );
  const opcoesClasse = useMemo(
    () => Array.from(new Set((lista ?? []).map(p => p.classe).filter((v): v is string => !!v))).sort(),
    [lista]
  );

  const listaFiltrada = useMemo(() => {
    if (!lista) return [];
    const numero = filtros.numero.trim().toLowerCase();
    const parte = filtros.parteContraria.trim().toLowerCase();
    const data = filtros.ultimaMovimentacao.trim().toLowerCase();
    return lista.filter(p => {
      if (numero && !p.numero_cnj.toLowerCase().includes(numero)) return false;
      if (filtros.tribunal && p.tribunal !== filtros.tribunal) return false;
      if (filtros.classe && p.classe !== filtros.classe) return false;
      if (parte && !(p.parte_passiva ?? '').toLowerCase().includes(parte)) return false;
      if (data && !fmt(p.ultima_movimentacao_em).toLowerCase().includes(data)) return false;
      return true;
    });
  }, [lista, filtros]);

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-10">
      <h1 className="text-3xl font-bold tracking-tight text-white">{isConsultante ? 'Processos acompanhados' : 'Meus processos'}</h1>
      <p className="mt-2 text-white/60">
        {isConsultante
          ? 'Processos ligados ao seu CPF/CNPJ, localizados nas suas consultas.'
          : 'Processos localizados nas suas pesquisas.'}
      </p>

      <div className="mt-8 overflow-x-auto rounded-3xl border border-white/10 bg-white/5 shadow-sm backdrop-blur-md">
        {lista === null && <p className="p-6 text-sm text-white/60">Carregando…</p>}
        {lista?.length === 0 && <p className="p-6 text-sm text-white/60">Nenhum processo pesquisado ainda. Faça uma consulta para vê-lo aqui.</p>}
        {!!lista?.length && (
          <div className="min-w-[820px] p-5">
            <div className="grid grid-cols-5 gap-3">
              <TextInput
                placeholder="Filtrar número..."
                leftSection={<Search size={14} />}
                value={filtros.numero}
                onChange={e => setFiltros(f => ({ ...f, numero: e.currentTarget.value }))}
              />
              <Select
                placeholder="Todos os tribunais"
                data={opcoesTribunal}
                clearable
                value={filtros.tribunal}
                onChange={v => setFiltros(f => ({ ...f, tribunal: v }))}
              />
              <Select
                placeholder="Todas as classes"
                data={opcoesClasse}
                clearable
                value={filtros.classe}
                onChange={v => setFiltros(f => ({ ...f, classe: v }))}
              />
              <TextInput
                placeholder="Filtrar parte contrária..."
                leftSection={<Search size={14} />}
                value={filtros.parteContraria}
                onChange={e => setFiltros(f => ({ ...f, parteContraria: e.currentTarget.value }))}
              />
              <TextInput
                placeholder="Filtrar últ. mov. (dd/mm/aaaa)..."
                leftSection={<Search size={14} />}
                value={filtros.ultimaMovimentacao}
                onChange={e => setFiltros(f => ({ ...f, ultimaMovimentacao: e.currentTarget.value }))}
              />
            </div>

            <Table mt="md" verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="!text-white/60">Número</Table.Th>
                  <Table.Th className="!text-white/60">Tribunal</Table.Th>
                  <Table.Th className="!text-white/60">Classe</Table.Th>
                  <Table.Th className="!text-white/60">Parte contrária</Table.Th>
                  <Table.Th className="!text-white/60">Últ. mov.</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {listaFiltrada.map(p => (
                  <Table.Tr key={p.id}>
                    <Table.Td className="!text-white font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <Gavel size={16} strokeWidth={1.8} className="text-white/40" />
                        {p.numero_cnj}
                      </span>
                    </Table.Td>
                    <Table.Td className="!text-white/70">{p.tribunal ?? '—'}</Table.Td>
                    <Table.Td className="!text-white/70">{p.classe ?? '—'}</Table.Td>
                    <Table.Td className="!text-white/70">{p.parte_passiva ?? '—'}</Table.Td>
                    <Table.Td className="!text-white/70">{fmt(p.ultima_movimentacao_em)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            {listaFiltrada.length === 0 && (
              <p className="mt-4 text-center text-sm text-white/60">Nenhum processo corresponde aos filtros aplicados.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
