'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

interface Evento {
  id: string;
  tipo: string;
  assunto: string | null;
  numero_cnj: string | null;
  ocorrido_em: string;
}

const ROTULO: Record<string, string> = {
  login: 'Login',
  logout: 'Logout',
  signup: 'Cadastro',
  consulta: 'Consulta de processo',
  resumo_ia: 'Resumo por IA',
  chat_ia: 'Chat com IA',
  lead: 'Contato com advogado',
  page_view: 'Página visualizada'
};

export default function Historico() {
  const [eventos, setEventos] = useState<Evento[] | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return setEventos([]);
    supabase
      .from('ap_eventos')
      .select('id,tipo,assunto,numero_cnj,ocorrido_em')
      .order('ocorrido_em', { ascending: false })
      .limit(50)
      .then(({ data }) => setEventos((data as Evento[]) ?? []));
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-10">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Atividade</h1>
      <p className="mt-2 text-slate-500">Seus acessos e consultas mais recentes.</p>
      <div className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {eventos === null && <p className="p-6 text-sm text-slate-500">Carregando…</p>}
        {eventos?.length === 0 && <p className="p-6 text-sm text-slate-500">Nenhuma atividade registrada ainda.</p>}
        {eventos?.map(e => (
          <div key={e.id} className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-4 last:border-0">
            <div>
              <p className="font-medium text-slate-900">{ROTULO[e.tipo] ?? e.tipo}</p>
              {(e.assunto || e.numero_cnj) && <p className="text-sm text-slate-500">{[e.assunto, e.numero_cnj].filter(Boolean).join(' · ')}</p>}
            </div>
            <time className="shrink-0 text-sm text-slate-400">{new Date(e.ocorrido_em).toLocaleString('pt-BR')}</time>
          </div>
        ))}
      </div>
    </div>
  );
}
