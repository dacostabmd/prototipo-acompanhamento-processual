'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { IconGavel, IconId, IconMail, IconPhone, IconUser } from '@tabler/icons-react';
import { getSupabase } from '@/lib/supabase';

interface Dados {
  nome: string;
  email: string;
  cpf: string;
  telefone: string;
  total: number;
}

const fmtCpf = (v: string) => (v.length === 11 ? v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : v);
const fmtTel = (v: string) =>
  v.length === 11 ? v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3') : v.length === 10 ? v.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3') : v;

export default function Perfil() {
  const [d, setD] = useState<Dados>({ nome: '', email: '', cpf: '', telefone: '', total: 0 });

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      if (!u) return;
      const [perfil, procs] = await Promise.all([
        supabase.from('ap_perfis').select('nome,cpf,telefone').eq('id', u.id).maybeSingle(),
        supabase.from('ap_processos_pesquisados').select('id', { count: 'exact', head: true })
      ]);
      setD({
        nome: perfil.data?.nome ?? u.user_metadata?.full_name ?? u.user_metadata?.name ?? '',
        email: u.email ?? '',
        cpf: perfil.data?.cpf ?? '',
        telefone: perfil.data?.telefone ?? '',
        total: procs.count ?? 0
      });
    })();
  }, []);

  const campos: { icon: ComponentType<{ size?: number; stroke?: number }>; label: string; valor: string }[] = [
    { icon: IconUser, label: 'Nome', valor: d.nome },
    { icon: IconMail, label: 'E-mail', valor: d.email },
    { icon: IconId, label: 'CPF', valor: fmtCpf(d.cpf) },
    { icon: IconPhone, label: 'Telefone', valor: fmtTel(d.telefone) },
    { icon: IconGavel, label: 'Processos', valor: d.total ? String(d.total) : '0' }
  ];

  return (
    <div className="mx-auto max-w-2xl p-6 sm:p-10">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Meu perfil</h1>
      <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <dl className="grid gap-5 text-sm">
          {campos.map(({ icon: Icon, label, valor }) => (
            <div key={label} className="flex items-center gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <Icon size={20} stroke={1.7} />
              </span>
              <div>
                <dt className="text-slate-500">{label}</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{valor || '—'}</dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
