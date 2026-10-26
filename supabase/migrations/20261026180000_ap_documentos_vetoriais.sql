-- Ativação da extensão pgvector e tabela de documentos vetoriais (Fase 4 do Roadmap Prosec)
-- Permite busca semântica em petições, sentenças, decisões e intimações indexadas.

create extension if not exists vector;

create table if not exists public.ap_documentos_vetoriais (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid references public.ap_processos(id) on delete cascade,
  numero_cnj text not null,
  tipo_documento text not null default 'outro', -- 'sentenca', 'liminar', 'peticao_inicial', 'intimacao', 'contestacao', 'acordao'
  titulo text,
  conteudo_texto text not null,
  chunk_index integer not null default 0,
  embedding vector(1536), -- text-embedding-3-small da OpenAI
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Índice por CNJ para filtros diretos por processo
create index if not exists ap_doc_vetoriais_cnj_idx 
  on public.ap_documentos_vetoriais (numero_cnj);

-- Índice vetorial HNSW para busca por similaridade de cosseno ultrarrápida
create index if not exists ap_doc_embedding_hnsw_idx 
  on public.ap_documentos_vetoriais 
  using hnsw (embedding vector_cosine_ops);

-- Função de busca por similaridade semântica
create or replace function match_documentos_processo (
  query_embedding vector(1536),
  filter_cnj text default null,
  match_threshold float default 0.65,
  match_count int default 5
)
returns table (
  id uuid,
  processo_id uuid,
  numero_cnj text,
  tipo_documento text,
  titulo text,
  conteudo_texto text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    ap_documentos_vetoriais.id,
    ap_documentos_vetoriais.processo_id,
    ap_documentos_vetoriais.numero_cnj,
    ap_documentos_vetoriais.tipo_documento,
    ap_documentos_vetoriais.titulo,
    ap_documentos_vetoriais.conteudo_texto,
    1 - (ap_documentos_vetoriais.embedding <=> query_embedding) as similarity
  from public.ap_documentos_vetoriais
  where (filter_cnj is null or ap_documentos_vetoriais.numero_cnj = filter_cnj)
    and (1 - (ap_documentos_vetoriais.embedding <=> query_embedding)) > match_threshold
  order by ap_documentos_vetoriais.embedding <=> query_embedding
  limit match_count;
end;
$$;
