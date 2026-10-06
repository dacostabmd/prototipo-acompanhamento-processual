'use client';

import { useEffect, useMemo, useState } from 'react';
import { Table, TextInput, Select } from '@mantine/core';
import { Gavel, History, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { authFetch } from '@/lib/authFetch';
import { useSharedProfile } from '@/components/ProfileProvider';
import type { ConsultaHistorico } from '@/lib/historicoConsultas';

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

const fmtDataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const fmtReais = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ROTULO_TIPO: Record<ConsultaHistorico['tipo_busca'], string> = { cpf: 'CPF', cnpj: 'CNPJ', nome: 'Nome', numero: 'Processo' };

/** CPF/CNPJ vêm só com dígitos; nº do processo e nome já vêm prontos para exibir. */
function fmtTermo(c: ConsultaHistorico): string {
  const d = c.termo;
  if (c.tipo_busca === 'cpf' && /^\d{11}$/.test(d)) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (c.tipo_busca === 'cnpj' && /^\d{14}$/.test(d)) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

interface HistoricoResposta {
  consultas: ConsultaHistorico[];
  /** 'todos' (admin/owner), 'proprio' ou 'indisponivel' (cliente: sem histórico). */
  escopo: 'todos' | 'proprio' | 'indisponivel';
  erro?: string;
}

export default function Processos() {
  const [lista, setLista] = useState<Processo[] | null>(null);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [historico, setHistorico] = useState<HistoricoResposta | null>(null);
  const { profile } = useSharedProfile();
  const isConsultante = profile.role === 'cliente';

  useEffect(() => {
    authFetch('/api/processos/listar')
      .then(res => res.json())
      .then(data => setLista(data.processos ?? []))
      .catch(() => setLista([]));
  }, []);

  useEffect(() => {
    authFetch('/api/processos/historico')
      .then(res => res.json())
      .then((data: HistoricoResposta) => setHistorico(data))
      .catch(() => setHistorico({ consultas: [], escopo: 'proprio', erro: 'Histórico indisponível no momento.' }));
  }, []);

  const totalGasto = useMemo(() => (historico?.consultas ?? []).reduce((soma, c) => soma + c.custo_cobrado, 0), [historico]);

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
                {listaFiltrada.map((p, index) => (
                  <Table.Tr
                    key={p.id}
                    renderRoot={(props) => (
                      <motion.tr
                        {...props}
                        initial={{ opacity: 0, x: -24 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          duration: 0.45,
                          delay: Math.min(index * 0.045, 0.8),
                          ease: [0.22, 1, 0.36, 1],
                        }}
                      />
                    )}
                  >
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

      {historico && historico.escopo !== 'indisponivel' && (
        <div className="mt-8 overflow-x-auto rounded-3xl border border-white/10 bg-white/5 shadow-sm backdrop-blur-md">
          <div className="min-w-[760px] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-white">
                <History size={18} strokeWidth={1.8} className="text-white/50" />
                Histórico de consultas
              </h2>
              {historico.consultas.length > 0 && (
                <p className="text-sm text-white/60">
                  {historico.consultas.length} consulta(s) · gasto total{' '}
                  <span className="font-semibold text-white">{fmtReais(totalGasto)}</span>
                </p>
              )}
            </div>
            <p className="mt-1 text-xs text-white/50">
              {historico.escopo === 'todos'
                ? 'Quem consultou, quem ou qual processo foi consultado e quanto cada consulta custou (todos os usuários).'
                : 'Suas consultas: o que foi consultado e quanto cada uma custou.'}
            </p>

            {historico.erro && <p className="mt-4 text-sm text-white/60">{historico.erro}</p>}
            {!historico.erro && historico.consultas.length === 0 && (
              <p className="mt-4 text-sm text-white/60">Nenhuma consulta registrada ainda.</p>
            )}

            {historico.consultas.length > 0 && (
              <Table mt="md" verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th className="!text-white/60">Data</Table.Th>
                    {historico.escopo === 'todos' && <Table.Th className="!text-white/60">Quem consultou</Table.Th>}
                    <Table.Th className="!text-white/60">Consultado</Table.Th>
                    <Table.Th className="!text-white/60">Tribunais</Table.Th>
                    <Table.Th className="!text-white/60">Processos</Table.Th>
                    <Table.Th className="!text-white/60">Custo</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {historico.consultas.map(c => (
                    <Table.Tr key={c.id}>
                      <Table.Td className="!whitespace-nowrap !text-white/70">{fmtDataHora(c.created_at)}</Table.Td>
                      {historico.escopo === 'todos' && (
                        <Table.Td className="!text-white/70">
                          <div className="text-white">{c.usuario_nome || c.usuario_email || '—'}</div>
                          {c.usuario_nome && c.usuario_email && <div className="text-xs text-white/50">{c.usuario_email}</div>}
                        </Table.Td>
                      )}
                      <Table.Td className="!text-white">
                        <div className="font-medium">
                          <span className="mr-1.5 text-xs font-semibold text-white/50">{ROTULO_TIPO[c.tipo_busca]}</span>
                          {fmtTermo(c)}
                        </div>
                        {c.nome_parte && c.tipo_busca !== 'nome' && <div className="text-xs text-white/50">{c.nome_parte}</div>}
                      </Table.Td>
                      <Table.Td className="!text-white/70" title={c.tribunais.join(', ')}>
                        {c.tribunais.length > 3
                          ? `${c.tribunais.slice(0, 3).join(', ')} +${c.tribunais.length - 3}`
                          : c.tribunais.join(', ') || '—'}
                      </Table.Td>
                      <Table.Td className="!text-white/70">{c.total_processos}</Table.Td>
                      <Table.Td className="!whitespace-nowrap !text-white" title={`Estimado antes da busca: ${fmtReais(c.custo_estimado)}`}>
                        {fmtReais(c.custo_cobrado)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
