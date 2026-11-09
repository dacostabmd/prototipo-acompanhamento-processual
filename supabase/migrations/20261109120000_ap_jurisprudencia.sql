-- Base de jurisprudência (Frente E): acórdãos e decisões de tribunais com ementa, busca semântica (pgvector)
-- e textual (tsvector 'portuguese'). Fonte do MVP: Dados Abertos do STJ (espelhos de acórdãos, licença CC-BY).
-- Aditiva e idempotente. Leitura para usuários autenticados; escrita só via service role (ingestão).

create extension if not exists vector;

create table if not exists public.ap_jurisprudencia (
  id uuid primary key default gen_random_uuid(),
  fonte text not null default 'stj',                -- origem da ingestão ('stj', ...)
  id_externo text not null,                         -- id do registro na fonte (único por fonte)
  tribunal text not null,                           -- 'STJ', 'STF', 'TJSP'...
  tipo text not null default 'acordao',             -- 'acordao' | 'decisao_monocratica' | 'sumula' | 'tese' ...
  classe text,                                      -- ex.: 'AgInt no AREsp'
  numero text,                                      -- número do processo na fonte (só dígitos quando possível)
  relator text,
  orgao_julgador text,
  data_julgamento date,
  data_publicacao date,
  ementa text not null,
  texto text,                                       -- trecho complementar (tese, informações complementares, resultado), limitado
  fonte_url text,                                   -- link oficial para o inteiro teor
  metadata jsonb not null default '{}'::jsonb,      -- campos extras da fonte (registro, tese, tema, legislação...)
  embedding vector(1536),                           -- text-embedding-3-small (igual ao RAG de documentos)
  tsv tsvector generated always as (
    setweight(to_tsvector('portuguese'::regconfig, coalesce(ementa, '')), 'A') ||
    setweight(to_tsvector('portuguese'::regconfig, coalesce(classe, '')), 'B') ||
    setweight(to_tsvector('portuguese'::regconfig, coalesce(relator, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  constraint ap_jurisprudencia_fonte_id_externo_key unique (fonte, id_externo)
);

-- Busca textual
create index if not exists ap_jurisprudencia_tsv_idx
  on public.ap_jurisprudencia using gin (tsv);

-- Busca semântica (cosseno)
create index if not exists ap_jurisprudencia_embedding_hnsw_idx
  on public.ap_jurisprudencia using hnsw (embedding vector_cosine_ops);

-- Filtros por tribunal e período
create index if not exists ap_jurisprudencia_tribunal_data_idx
  on public.ap_jurisprudencia (tribunal, data_julgamento desc);
create index if not exists ap_jurisprudencia_data_idx
  on public.ap_jurisprudencia (data_julgamento desc);

-- RLS: base pública para leitura por autenticados; sem policy de escrita (só service role, que ignora RLS).
alter table public.ap_jurisprudencia enable row level security;

drop policy if exists ap_jurisprudencia_select_autenticados on public.ap_jurisprudencia;
create policy ap_jurisprudencia_select_autenticados on public.ap_jurisprudencia
  for select to authenticated
  using (true);

-- Busca semântica. Só considera linhas com embedding.
create or replace function public.match_jurisprudencia (
  query_embedding vector(1536),
  match_count int default 20,
  filtro_tribunal text default null,
  ano_min int default null
)
returns table (
  id uuid,
  tribunal text,
  tipo text,
  classe text,
  numero text,
  relator text,
  orgao_julgador text,
  data_julgamento date,
  data_publicacao date,
  ementa text,
  fonte_url text,
  fonte text,
  similarity float
)
language sql
stable
set search_path = public, extensions
as $$
  select
    j.id, j.tribunal, j.tipo, j.classe, j.numero, j.relator, j.orgao_julgador,
    j.data_julgamento, j.data_publicacao, j.ementa, j.fonte_url, j.fonte,
    (1 - (j.embedding <=> query_embedding))::float as similarity
  from public.ap_jurisprudencia j
  where j.embedding is not null
    and (filtro_tribunal is null or j.tribunal = filtro_tribunal)
    and (ano_min is null or j.data_julgamento >= make_date(ano_min, 1, 1))
  order by j.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 100);
$$;

-- Busca textual: termos da consulta combinados com OU (consultas em linguagem natural raramente casam
-- todos os termos), ordenados por ts_rank_cd. Stop words e stemming ficam por conta da config 'portuguese'.
create or replace function public.buscar_jurisprudencia_texto (
  consulta text,
  match_count int default 20,
  filtro_tribunal text default null,
  ano_min int default null
)
returns table (
  id uuid,
  tribunal text,
  tipo text,
  classe text,
  numero text,
  relator text,
  orgao_julgador text,
  data_julgamento date,
  data_publicacao date,
  ementa text,
  fonte_url text,
  fonte text,
  rank float
)
language sql
stable
set search_path = public, extensions
as $$
  with q as (
    select nullif(replace(plainto_tsquery('portuguese'::regconfig, consulta)::text, '&', '|'), '')::tsquery as tsq
  )
  select
    j.id, j.tribunal, j.tipo, j.classe, j.numero, j.relator, j.orgao_julgador,
    j.data_julgamento, j.data_publicacao, j.ementa, j.fonte_url, j.fonte,
    ts_rank_cd(j.tsv, q.tsq)::float as rank
  from public.ap_jurisprudencia j, q
  where q.tsq is not null
    and j.tsv @@ q.tsq
    and (filtro_tribunal is null or j.tribunal = filtro_tribunal)
    and (ano_min is null or j.data_julgamento >= make_date(ano_min, 1, 1))
  order by rank desc, j.data_julgamento desc nulls last
  limit least(greatest(match_count, 1), 100);
$$;

-- As RPCs são chamadas pelo servidor (service role); usuários autenticados também podem consultá-las.
revoke all on function public.match_jurisprudencia(vector, int, text, int) from public, anon;
revoke all on function public.buscar_jurisprudencia_texto(text, int, text, int) from public, anon;
grant execute on function public.match_jurisprudencia(vector, int, text, int) to authenticated, service_role;
grant execute on function public.buscar_jurisprudencia_texto(text, int, text, int) to authenticated, service_role;
