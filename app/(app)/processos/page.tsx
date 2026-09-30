'use client';

import { useEffect, useState } from 'react';
import { Fingerprint, Gavel } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';

interface Processo {
  id: string;
  hash: string | null;
  numero_cnj: string;
  tribunal: string | null;
  classe: string | null;
  parte_passiva: string | null;
  ultima_movimentacao_em: string | null;
  created_at: string;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

export default function Processos() {
  const [lista, setLista] = useState<Processo[] | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return setLista([]);
    supabase
      .from('ap_processos_pesquisados')
      .select('id,hash,numero_cnj,tribunal,classe,parte_passiva,ultima_movimentacao_em,created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => setLista((data as Processo[]) ?? []));
  }, []);

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-10">
      <h1 className="text-3xl font-bold tracking-tight text-white">Meus processos</h1>
      <p className="mt-2 text-white/60">Processos localizados nas suas pesquisas, cada um com um hash identificador.</p>

      <div className="mt-8 overflow-x-auto rounded-3xl border border-white/10 bg-white/5 shadow-sm backdrop-blur-md">
        {lista === null && <p className="p-6 text-sm text-white/60">Carregando…</p>}
        {lista?.length === 0 && <p className="p-6 text-sm text-white/60">Nenhum processo pesquisado ainda. Faça uma consulta para vê-lo aqui.</p>}
        {!!lista?.length && (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-white/10 bg-white/5 text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="px-5 py-3">Hash</th>
                <th className="px-5 py-3">Número</th>
                <th className="px-5 py-3">Tribunal</th>
                <th className="px-5 py-3">Classe</th>
                <th className="px-5 py-3">Parte contrária</th>
                <th className="px-5 py-3">Últ. mov.</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(p => (
                <tr key={p.id} className="border-b border-white/10 last:border-0">
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-white/60" title={p.hash ?? ''}>
                      <Fingerprint size={16} strokeWidth={1.8} />
                      {p.hash ? `${p.hash.slice(0, 8)}…${p.hash.slice(-4)}` : '—'}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-medium text-white">
                    <span className="inline-flex items-center gap-1.5">
                      <Gavel size={16} strokeWidth={1.8} className="text-white/40" />
                      {p.numero_cnj}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-white/70">{p.tribunal ?? '—'}</td>
                  <td className="px-5 py-3 text-white/70">{p.classe ?? '—'}</td>
                  <td className="px-5 py-3 text-white/70">{p.parte_passiva ?? '—'}</td>
                  <td className="px-5 py-3 text-white/70">{fmt(p.ultima_movimentacao_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
