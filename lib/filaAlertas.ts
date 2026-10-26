import type { SupabaseClient } from '@supabase/supabase-js';
import type { Movement } from '@/lib/mockProcesses';
import type { ResumoAndamento } from '@/lib/resumoAndamento';
import { enviarAlertaMovimentacao } from '@/lib/email';
import { enviarAlertaWhatsApp } from '@/lib/whatsapp';
import { gerarTokenDescadastro, urlPaginaDescadastro, urlUmCliqueDescadastro } from '@/lib/descadastro';
import { avaliarPrioridadeSmartDigest } from '@/lib/smartDigest';

/**
 * Fila de alertas de andamento (ap_alertas_pendentes). O cron de reconsulta ENFILEIRA (1 linha por
 * usuário x canal, com o conteúdo congelado em `conteudo`) e o worker ENVIA. Separar as duas pontas
 * dá retry sem reconsultar o tribunal e permite mover o worker para fila/cron próprios depois
 * (Vercel Queues ou pg_cron) sem mexer no enfileiramento.
 *
 * Status:
 *   pendente  -> ainda não tentado, ou canal sem credenciais no servidor (espera até expirar)
 *   enviado   -> entregue ao provedor
 *   falhou    -> falha transitória; nova tentativa até MAX_TENTATIVAS
 *   ignorado  -> não vai sair: usuário sem contato, erro definitivo, substituído por alerta mais novo ou expirado
 */

const MAX_TENTATIVAS = 3;
const VALIDADE_ALERTA_MS = 3 * 24 * 60 * 60 * 1000; // depois disso o aviso perdeu o sentido
const LIMITE_POR_EXECUCAO = 200;
const CONCORRENCIA = 5;

export type CanalAlerta = 'email' | 'whatsapp';

export interface ConteudoAlerta {
  numeroCnj: string;
  tribunal?: string | null;
  movimentos: Pick<Movement, 'data' | 'titulo' | 'descricao'>[];
  resumo: Pick<ResumoAndamento, 'resumo' | 'significado' | 'proximoPasso' | 'urgencia'> | null;
}

export interface ResultadoFila {
  enviados: number;
  falhas: number;
  ignorados: number;
  aguardandoConfiguracao: number;
  expirados: number;
  restantes: number;
}

interface AlertaFila {
  id: string;
  processo_id: string;
  user_id: string;
  canal: CanalAlerta;
  tentativas: number;
  conteudo: ConteudoAlerta | null;
}

/**
 * Enfileira o alerta para todos os usuários que monitoram o processo, nos canais que cada um ligou
 * (ap_processos_monitorados), respeitando a sensibilidade escolhida (Smart Digest, Todas ou Urgências),
 * e grava a notificação do app (ap_notificacoes) para todos eles.
 */
export async function enfileirarAlertas(db: SupabaseClient, processoId: string, conteudo: ConteudoAlerta): Promise<number> {
  const { data: monitoramentos, error } = await db
    .from('ap_processos_monitorados')
    .select('user_id, notificar_email, notificar_whatsapp, tags')
    .eq('processo_id', processoId);
  if (error) {
    console.error('[filaAlertas] falha ao ler monitoramentos:', error.message);
    return 0;
  }

  const linhas: { processo_id: string; user_id: string; canal: CanalAlerta; status: 'pendente'; conteudo: ConteudoAlerta }[] = [];
  const notificacoes: { user_id: string; processo_id: string; titulo: string; mensagem: string }[] = [];
  const mensagemApp = conteudo.resumo
    ? `${conteudo.resumo.resumo} Próximo passo: ${conteudo.resumo.proximoPasso}`
    : conteudo.movimentos.map(m => m.titulo).slice(0, 3).join('; ');

  // Avaliação inteligente de relevância anti-spam
  const avaliacao = avaliarPrioridadeSmartDigest(conteudo.movimentos, conteudo.resumo);

  for (const m of monitoramentos ?? []) {
    const userId = m.user_id as string;
    const tagSensibilidade = (m.tags as string[] | null)?.find(t => t.startsWith('sensibilidade:'))?.replace('sensibilidade:', '');
    const sensibilidade = (tagSensibilidade === 'todas' || tagSensibilidade === 'urgentes_apenas') ? tagSensibilidade : 'smart_digest';

    // Grava no feed interno do app
    notificacoes.push({ user_id: userId, processo_id: processoId, titulo: `Seu processo ${conteudo.numeroCnj} teve uma movimentação`, mensagem: mensagemApp });

    // Regra de sensibilidade para WhatsApp (Anti-spam)
    let enviarWhatsapp = false;
    if (m.notificar_whatsapp) {
      if (sensibilidade === 'todas') {
        enviarWhatsapp = true;
      } else if (sensibilidade === 'urgentes_apenas') {
        enviarWhatsapp = avaliacao.urgencia === 'alta';
      } else {
        // smart_digest (padrão): urgências e liminares imediatas; rotina semanal
        enviarWhatsapp = avaliacao.prioridade === 'imediata';
      }
    }

    // Regra para e-mail
    let enviarEmail = false;
    if (m.notificar_email) {
      if (sensibilidade === 'urgentes_apenas') {
        enviarEmail = avaliacao.urgencia === 'alta';
      } else {
        enviarEmail = true;
      }
    }

    if (enviarEmail) linhas.push({ processo_id: processoId, user_id: userId, canal: 'email', status: 'pendente', conteudo });
    if (enviarWhatsapp) linhas.push({ processo_id: processoId, user_id: userId, canal: 'whatsapp', status: 'pendente', conteudo });
  }

  if (notificacoes.length > 0) {
    const ins = await db.from('ap_notificacoes').insert(notificacoes);
    if (ins.error) console.error('[filaAlertas] falha ao gravar notificações do app:', ins.error.message);
  }
  if (linhas.length === 0) return 0;

  const substituidos = await db
    .from('ap_alertas_pendentes')
    .update({ status: 'ignorado', erro: 'Substituído por um alerta mais recente do mesmo processo.' })
    .eq('processo_id', processoId)
    .in('user_id', [...new Set(linhas.map(l => l.user_id))])
    .in('status', ['pendente', 'falhou']);
  if (substituidos.error) console.error('[filaAlertas] falha ao marcar alertas substituídos:', substituidos.error.message);

  const { error: erroInsert } = await db.from('ap_alertas_pendentes').insert(linhas);
  if (erroInsert) {
    console.error('[filaAlertas] falha ao enfileirar alertas:', erroInsert.message);
    return 0;
  }
  return linhas.length;
}

/** Contato do usuário, lido uma vez por execução do worker (vários alertas do mesmo usuário). */
async function carregarContato(
  db: SupabaseClient,
  userId: string,
  cache: Map<string, { email: string | null; telefone: string | null }>
) {
  const emCache = cache.get(userId);
  if (emCache) return emCache;
  const { data: perfil } = await db.from('ap_perfis').select('email, telefone').eq('id', userId).maybeSingle();
  let email: string | null = (perfil?.email as string | null) ?? null;
  if (!email) {
    const { data } = await db.auth.admin.getUserById(userId);
    email = data?.user?.email ?? null;
  }
  const contato = { email, telefone: (perfil?.telefone as string | null) ?? null };
  cache.set(userId, contato);
  return contato;
}

type Desfecho = 'enviado' | 'falhou' | 'ignorado' | 'aguardando';

async function enviarUm(
  db: SupabaseClient,
  alerta: AlertaFila,
  contatos: Map<string, { email: string | null; telefone: string | null }>
): Promise<Desfecho> {
  const agora = new Date().toISOString();
  const atualizar = (campos: Record<string, unknown>) =>
    db.from('ap_alertas_pendentes').update({ ...campos, ultima_tentativa_em: agora }).eq('id', alerta.id);

  const conteudo = alerta.conteudo;
  if (!conteudo?.numeroCnj) {
    await atualizar({ status: 'ignorado', erro: 'Alerta sem conteúdo (enfileirado antes do worker).' });
    return 'ignorado';
  }

  const contato = await carregarContato(db, alerta.user_id, contatos);
  const destino = alerta.canal === 'email' ? contato.email : contato.telefone;
  if (!destino) {
    await atualizar({ status: 'ignorado', erro: alerta.canal === 'email' ? 'Usuário sem e-mail cadastrado.' : 'Usuário sem telefone cadastrado.' });
    return 'ignorado';
  }

  const processo = { numeroCnj: conteudo.numeroCnj, tribunal: conteudo.tribunal };
  let envio;
  if (alerta.canal === 'email') {
    const token = gerarTokenDescadastro({ userId: alerta.user_id, processoId: alerta.processo_id, canal: 'email', numeroCnj: conteudo.numeroCnj });
    const descadastro = token ? { pagina: urlPaginaDescadastro(token), umClique: urlUmCliqueDescadastro(token) } : null;
    envio = await enviarAlertaMovimentacao(destino, processo, conteudo.movimentos, conteudo.resumo, descadastro);
  } else {
    envio = await enviarAlertaWhatsApp(destino, processo, conteudo.resumo, conteudo.movimentos);
  }

  if (envio.enviado) {
    await atualizar({ status: 'enviado', enviado_em: agora, erro: null, tentativas: alerta.tentativas + 1 });
    return 'enviado';
  }
  if (envio.naoConfigurado) {
    // Não conta tentativa: assim que as credenciais forem configuradas, o alerta (se ainda válido) sai.
    await atualizar({ erro: envio.erro ?? 'Canal não configurado no servidor.' });
    return 'aguardando';
  }

  const tentativas = alerta.tentativas + 1;
  const definitivo = 'definitivo' in envio && envio.definitivo === true;
  const desiste = definitivo || tentativas >= MAX_TENTATIVAS;
  await atualizar({ status: desiste ? 'ignorado' : 'falhou', erro: envio.erro ?? 'Falha desconhecida no envio.', tentativas });
  return desiste ? 'ignorado' : 'falhou';
}

/**
 * Worker: envia os alertas pendentes (e as falhas ainda elegíveis a nova tentativa), dos mais antigos
 * para os mais novos, até `ateMs` (timestamp absoluto). Alertas com mais de 3 dias viram 'ignorado'.
 * Nunca lança erro.
 */
export async function processarFilaAlertas(db: SupabaseClient, opcoes: { ateMs: number }): Promise<ResultadoFila> {
  const resultado: ResultadoFila = { enviados: 0, falhas: 0, ignorados: 0, aguardandoConfiguracao: 0, expirados: 0, restantes: 0 };
  const limiteValidade = new Date(Date.now() - VALIDADE_ALERTA_MS).toISOString();

  try {
    const expirados = await db
      .from('ap_alertas_pendentes')
      .update({ status: 'ignorado', erro: 'Expirado: não foi possível enviar em até 3 dias.' })
      .in('status', ['pendente', 'falhou'])
      .lt('created_at', limiteValidade)
      .select('id');
    resultado.expirados = expirados.data?.length ?? 0;

    const { data, error } = await db
      .from('ap_alertas_pendentes')
      .select('id, processo_id, user_id, canal, tentativas, conteudo')
      .in('status', ['pendente', 'falhou'])
      .lt('tentativas', MAX_TENTATIVAS)
      .gte('created_at', limiteValidade)
      .order('created_at', { ascending: true })
      .limit(LIMITE_POR_EXECUCAO);
    if (error) {
      console.error('[filaAlertas] falha ao ler a fila:', error.message);
      return resultado;
    }

    const fila = (data as AlertaFila[] | null) ?? [];
    const contatos = new Map<string, { email: string | null; telefone: string | null }>();
    let processados = 0;

    for (let i = 0; i < fila.length; i += CONCORRENCIA) {
      if (Date.now() >= opcoes.ateMs) break;
      const lote = fila.slice(i, i + CONCORRENCIA);
      const desfechos = await Promise.allSettled(lote.map(a => enviarUm(db, a, contatos)));
      processados += lote.length;
      for (const d of desfechos) {
        if (d.status === 'rejected') {
          resultado.falhas++;
          console.error('[filaAlertas] exceção ao processar alerta:', d.reason);
        } else if (d.value === 'enviado') resultado.enviados++;
        else if (d.value === 'falhou') resultado.falhas++;
        else if (d.value === 'ignorado') resultado.ignorados++;
        else resultado.aguardandoConfiguracao++;
      }
    }
    resultado.restantes = fila.length - processados;
  } catch (e) {
    console.error('[filaAlertas] falha no worker de alertas:', e);
  }
  return resultado;
}
