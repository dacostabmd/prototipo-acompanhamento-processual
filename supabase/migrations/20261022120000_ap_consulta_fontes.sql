-- Registro por serviço consultado: uma linha por chamada (Infosimples, DataJud, Lemit) de cada busca.
-- Base para medir a taxa real de acerto e de falha de cada fonte e quanto cada sinal de estado (Lemit, DDD,
-- região fiscal do CPF) acerta o tribunal — o que permitirá trocar as regras fixas de lib/planoVarredura.ts
-- por pesos medidos. Não guarda CPF/nome: só a consulta (consulta_id) e o resultado de cada fonte.
-- Escrita só pelo servidor (service role); leitura só admin/owner.

create table if not exists public.ap_consulta_fontes (
  id               uuid primary key default gen_random_uuid(),
  consulta_id      uuid not null,
  user_id          uuid references auth.users(id) on delete set null,
  tipo_busca       text not null check (tipo_busca in ('cpf', 'cnpj', 'nome', 'numero')),
  fonte            text not null check (fonte in ('infosimples', 'datajud', 'lemit')),
  -- Serviço Infosimples (ex.: tribunal/tjsp/primeiro-grau), alias DataJud ou 'pessoa'/'empresa' na Lemit.
  servico          text,
  tribunal         text,
  -- 1 = 1ª onda (tribunal prioritário ou todos), 2 = 2ª onda; null para DataJud/Lemit.
  onda             smallint,
  achou            boolean not null default false,
  qtd_processos    integer not null default 0,
  custo            numeric(10,2) not null default 0,
  duracao_ms       integer,
  codigo           integer,
  erro_origem      text,
  erro_categoria   text,
  -- Sinais de estado da busca e qual regra decidiu a 1ª onda (repetidos em cada linha da mesma consulta).
  sinais           jsonb not null default '{}'::jsonb,
  prioridade_origem text,
  created_at       timestamptz not null default now()
);

create index if not exists ap_consulta_fontes_consulta_idx on public.ap_consulta_fontes (consulta_id);
create index if not exists ap_consulta_fontes_servico_idx on public.ap_consulta_fontes (fonte, servico, created_at desc);

alter table public.ap_consulta_fontes enable row level security;

create policy ap_consulta_fontes_read on public.ap_consulta_fontes
  for select to authenticated using (public.ap_is_admin());
