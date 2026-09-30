-- Preferências do novo fluxo de busca (Passos "Onde procurar" e "Avisos" do stepper).
-- Uma linha por usuário; sobrescrita a cada nova consulta via upsert (user_id como PK).
-- Ativação de cobrança real ainda não existe: os campos abaixo só registram a intenção do
-- usuário, sem gateway de pagamento por trás (ver roadmap.json).
create table public.ap_preferencias_consulta (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tribunais_selecionados jsonb, -- null = todos os tribunais (padrão)
  avisar_movimentacao boolean not null default false,
  canal_aviso text check (canal_aviso in ('email', 'whatsapp', 'ambos', 'nenhum')) default 'nenhum',
  resumo_linguagem_simples boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.ap_preferencias_consulta enable row level security;
create policy ap_pref_consulta_owner on public.ap_preferencias_consulta
  for select to authenticated using (user_id = (select auth.uid()));
