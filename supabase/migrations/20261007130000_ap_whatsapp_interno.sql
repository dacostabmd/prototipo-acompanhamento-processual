-- Fase 4 do CRM jurídico: comunicação interna via WhatsApp (Baileys), para advogados/departamentos
-- conversarem de dentro do CRM. NÃO é o alerta de movimentação ao cliente final (esse já existe por
-- e-mail via Resend, Fases 2/3, e não usa Baileys). O serviço Baileys em si roda fora deste banco,
-- em processo Node separado no VPS do escritório (ver whatsapp-service/ na raiz do repo) — esta
-- migration só cria o que o Next.js (Prosec) precisa para registrar e exibir o histórico de
-- mensagens trocadas.
--
-- ATENÇÃO: ap_chat_mensagens JÁ EXISTE no banco e é o chat jurídico com IA (role user/assistant/
-- system, fontes_citadas, tokens_utilizados) — não tem nenhuma relação com WhatsApp. A tabela nova
-- abaixo (ap_whatsapp_mensagens) é propositalmente distinta e não reaproveita nada daquela.
--
-- Número de WhatsApp do usuário: optou-se por uma COLUNA em ap_perfis (whatsapp_interno) em vez de
-- uma tabela separada ap_whatsapp_contatos(user_id, numero). Justificativa: é uma relação 1:1 (cada
-- membro da equipe tem no máximo um número de WhatsApp interno cadastrado), o mesmo padrão já usado
-- para outros dados de contato do perfil (telefone, email) nas migrations anteriores — uma tabela à
-- parte só se justificaria se um usuário pudesse ter vários números, o que não é o caso aqui.

alter table public.ap_perfis
  add column if not exists whatsapp_interno text;

-- ── Histórico de mensagens de WhatsApp interno ───────────────────────────────────────────────
create table public.ap_whatsapp_mensagens (
  id                uuid primary key default gen_random_uuid(),
  remetente_id      uuid references auth.users(id) on delete set null,
  destinatario_id   uuid references auth.users(id) on delete set null,
  numero_whatsapp   text,
  item_id           uuid references public.ap_crm_itens(id) on delete set null,
  texto             text not null,
  direcao           text not null check (direcao in ('enviada', 'recebida')),
  status            text not null default 'pendente' check (status in ('pendente', 'enviado', 'falhou', 'recebido')),
  created_at        timestamptz not null default now()
);

create index ap_whatsapp_mensagens_item_idx on public.ap_whatsapp_mensagens (item_id, created_at desc);
create index ap_whatsapp_mensagens_remetente_idx on public.ap_whatsapp_mensagens (remetente_id, created_at desc);
create index ap_whatsapp_mensagens_destinatario_idx on public.ap_whatsapp_mensagens (destinatario_id, created_at desc);
create index ap_whatsapp_mensagens_numero_idx on public.ap_whatsapp_mensagens (numero_whatsapp);

alter table public.ap_whatsapp_mensagens enable row level security;

-- Leitura: participante da conversa (remetente OU destinatário) ou admin/owner. Mensagens de/para um
-- número externo ao sistema (destinatario_id nulo) só ficam visíveis para o remetente e para
-- admin/owner — não há um "segundo participante" interno para incluir na regra.
create policy ap_whatsapp_mensagens_read on public.ap_whatsapp_mensagens
  for select to authenticated using (
    remetente_id = (select auth.uid())
    or destinatario_id = (select auth.uid())
    or public.ap_is_admin()
  );

-- Escrita só pelo servidor (service role, ignora RLS): tanto o envio manual (app/api/whatsapp/enviar)
-- quanto o recebimento via webhook (app/api/whatsapp/webhook) passam por getAdminClient(), nunca pelo
-- client anon/autenticado direto do navegador. Não há policy de insert/update para 'authenticated'
-- de propósito.
