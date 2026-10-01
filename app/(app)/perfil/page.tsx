'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { User, Mail, CreditCard, Phone, Gavel, Lock, type LucideIcon } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { formatDocumento } from '@/lib/format';

interface Dados {
  nome: string;
  email: string;
  cpf: string;
  telefone: string;
  total: number;
  role: string;
  documento: string;
  documentoTipo: string;
}

const fmtCpf = (v: string) => (v.length === 11 ? v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : v);
const fmtTel = (v: string) =>
  v.length === 11 ? v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3') : v.length === 10 ? v.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3') : v;

export default function Perfil() {
  const [d, setD] = useState<Dados>({ nome: '', email: '', cpf: '', telefone: '', total: 0, role: 'advogado', documento: '', documentoTipo: '' });

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      if (!u) return;
      const [perfil, procs] = await Promise.all([
        supabase.from('ap_perfis').select('nome,cpf,telefone,role,documento,documento_tipo').eq('id', u.id).maybeSingle(),
        supabase.from('ap_processos_pesquisados').select('id', { count: 'exact', head: true })
      ]);
      setD({
        nome: perfil.data?.nome ?? u.user_metadata?.full_name ?? u.user_metadata?.name ?? '',
        email: u.email ?? '',
        cpf: perfil.data?.cpf ?? '',
        telefone: perfil.data?.telefone ?? '',
        total: procs.count ?? 0,
        role: perfil.data?.role ?? 'advogado',
        documento: perfil.data?.documento ?? '',
        documentoTipo: perfil.data?.documento_tipo ?? ''
      });
    })();
  }, []);

  const isConsultante = d.role === 'cliente';

  const campos: { icon: LucideIcon; label: string; valor: string; locked?: boolean }[] = [
    { icon: User, label: 'Nome', valor: d.nome },
    { icon: Mail, label: 'E-mail', valor: d.email },
    isConsultante
      ? { icon: Lock, label: d.documentoTipo === 'cnpj' ? 'CNPJ (fixo)' : 'CPF (fixo)', valor: formatDocumento(d.documento), locked: true }
      : { icon: CreditCard, label: 'CPF', valor: fmtCpf(d.cpf) },
    { icon: Phone, label: 'Telefone', valor: fmtTel(d.telefone) },
    { icon: Gavel, label: 'Processos', valor: d.total ? String(d.total) : '0' }
  ];

  return (
    <div className="mx-auto max-w-2xl p-6 sm:p-10">
      <h1 className="text-3xl font-bold tracking-tight text-white">Meu perfil</h1>
      <p className="mt-2 text-white/60">
        {d.role === 'broker'
          ? 'Conta Broker (Ativos & Precatórios)'
          : isConsultante
          ? 'Conta Consulta Avulsa'
          : d.role === 'admin'
          ? 'Conta Administrador'
          : 'Conta Advogado'}
      </p>
      <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-sm backdrop-blur-md">
        <dl className="grid gap-5 text-sm">
          {campos.map(({ icon: Icon, label, valor, locked }) => (
            <div key={label} className="flex items-center gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
                <Icon size={20} strokeWidth={1.8} />
              </span>
              <div>
                <dt className="text-white/60">{label}</dt>
                <dd className="mt-0.5 font-medium text-white">{valor || '—'}</dd>
                {locked && <dd className="mt-0.5 text-xs text-white/40">Não pode ser alterado</dd>}
              </div>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
