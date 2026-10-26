-- Monitoramento contínuo de novas distribuições processuais por CPF/CNPJ (Fase 5 do Roadmap JusConsulta)
-- Permite que clientes e bancas sejam alertados imediatamente no WhatsApp assim que uma nova ação
-- judicial for distribuída contra ou a favor de um documento cadastrado em qualquer tribunal do país.

create table if not exists public.ap_monitoramento_documentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  documento text not null, -- 11 dígitos para CPF, 14 dígitos para CNPJ (somente números)
  tipo text not null check (tipo in ('cpf', 'cnpj')),
  nome_titular text,
  ativo boolean not null default true,
  notificar_whatsapp boolean not null default true,
  notificar_email boolean not null default true,
  processos_conhecidos_cnjs jsonb not null default '[]'::jsonb, -- lista de CNJs já notificados
  ultima_varredura_em timestamptz,
  proxima_varredura_em timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (user_id, documento)
);

create index if not exists ap_monit_doc_proxima_varredura_idx 
  on public.ap_monitoramento_documentos (proxima_varredura_em) 
  where ativo;

alter table public.ap_monitoramento_documentos enable row level security;

create policy ap_monit_doc_owner on public.ap_monitoramento_documentos
  for all to authenticated using (user_id = (select auth.uid()));

comment on table public.ap_monitoramento_documentos is
  'Varredura de novas ações judiciais distribuídas por CPF/CNPJ com alertas automáticos no WhatsApp.';
