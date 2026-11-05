-- Tradução em linguagem simples de cada movimentação, gerada por IA sob demanda e guardada como cache
-- (o texto do tribunal não muda, então traduz uma vez só).
alter table public.ap_movimentacoes
  add column if not exists traducao_leiga text,
  add column if not exists traducao_modelo text,
  add column if not exists traducao_em timestamptz;
