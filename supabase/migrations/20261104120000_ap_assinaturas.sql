-- Assinaturas do Plano Pro cobradas pelo Asaas. Uma linha por usuário (a assinatura vigente ou a última).
-- Escrita só pelo servidor (service role): app/api/pagamentos/*. O usuário só lê a própria linha.
-- Tabela separada de ap_perfis de propósito: a policy "dono" de ap_perfis libera UPDATE da linha, e os ids do
-- gateway não podem ser editáveis pelo usuário (trocar o id da assinatura permitiria cancelar a de outra pessoa).

create table if not exists public.ap_assinaturas (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  gateway             text not null default 'asaas',
  cliente_id          text,
  assinatura_id       text unique,
  status              text not null default 'pendente'
                      check (status in ('pendente', 'ativa', 'inadimplente', 'cancelada')),
  metodo              text check (metodo in ('pix', 'cartao')),
  valor               numeric(10,2),
  ultimo_pagamento_id text,
  proximo_vencimento  date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists ap_assinaturas_cliente_idx on public.ap_assinaturas (cliente_id);

alter table public.ap_assinaturas enable row level security;

drop policy if exists ap_assinaturas_read on public.ap_assinaturas;
create policy ap_assinaturas_read on public.ap_assinaturas
  for select to authenticated using (user_id = (select auth.uid()) or public.ap_is_admin());
