-- Histórico de consultas: quem consultou, o que consultou (CPF/CNPJ, nome da parte ou nº do processo) e quanto
-- a consulta custou. Escrita só pelo servidor (service role, ignora RLS) em app/api/processos/route.ts.
-- Diferente de ap_consultas (guarda só o hash do termo), aqui o termo fica em claro por decisão do produto:
-- a tela "Meus processos" mostra qual CPF/processo foi consultado. Leitura: o usuário vê as próprias
-- consultas; admin/owner veem as de todos (ap_is_admin() aceita os dois papéis).

create table if not exists public.ap_historico_consultas (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  -- Cópia de quem consultou no momento da consulta: o histórico sobrevive à exclusão do usuário.
  usuario_nome     text,
  usuario_email    text,
  tipo_busca       text not null check (tipo_busca in ('cpf', 'cnpj', 'nome', 'numero')),
  -- CPF/CNPJ (só dígitos), nº CNJ formatado ou nome da parte, conforme tipo_busca.
  termo            text not null,
  nome_parte       text,
  tribunais        text[] not null default '{}',
  total_processos  integer not null default 0,
  -- O que a tela mostrou antes da busca (soma dos preços de tabela dos serviços consultados).
  custo_estimado   numeric(10,2) not null default 0,
  -- O que a Infosimples informou como preço de cada resposta (header.price); respostas sem retorno contam 0.
  custo_cobrado    numeric(10,2) not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists ap_historico_consultas_tempo_idx on public.ap_historico_consultas (created_at desc);
create index if not exists ap_historico_consultas_user_idx  on public.ap_historico_consultas (user_id, created_at desc);

alter table public.ap_historico_consultas enable row level security;

drop policy if exists ap_historico_consultas_read on public.ap_historico_consultas;
create policy ap_historico_consultas_read on public.ap_historico_consultas
  for select to authenticated using (user_id = (select auth.uid()) or public.ap_is_admin());
