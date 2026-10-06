import { getAdminClient } from './track';

export type TipoBuscaHistorico = 'cpf' | 'cnpj' | 'nome' | 'numero';

export interface ConsultaHistoricoInput {
  tipoBusca: TipoBuscaHistorico;
  /** CPF/CNPJ (só dígitos), nº CNJ ou nome da parte, conforme o tipo. */
  termo: string;
  nomeParte?: string;
  tribunais: string[];
  totalProcessos: number;
  /** Soma dos preços de tabela dos serviços consultados (o que a tela mostrou antes da busca). */
  custoEstimado: number;
  /** Soma do preço informado pela Infosimples em cada resposta (header.price). */
  custoCobrado: number;
}

export interface ConsultaHistorico {
  id: string;
  user_id: string | null;
  usuario_nome: string | null;
  usuario_email: string | null;
  tipo_busca: TipoBuscaHistorico;
  termo: string;
  nome_parte: string | null;
  tribunais: string[];
  total_processos: number;
  custo_estimado: number;
  custo_cobrado: number;
  created_at: string;
}

/** Preço cobrado numa resposta da Infosimples: o envelope traz header.price (string, "0.0" quando não há cobrança). */
export function precoDaRespostaInfosimples(resposta: any): number {
  const preco = Number(resposta?.header?.price);
  return Number.isFinite(preco) && preco > 0 ? preco : 0;
}

/** Registra no Supabase quem fez a consulta, o que consultou e quanto custou. Nunca lança erro. */
export async function registrarHistoricoConsulta(userId: string | null, consulta: ConsultaHistoricoInput) {
  try {
    const db = getAdminClient();
    if (!db || !userId) return;

    const { data: perfil } = await db.from('ap_perfis').select('nome,email').eq('id', userId).maybeSingle();

    const { error } = await db.from('ap_historico_consultas').insert({
      user_id: userId,
      usuario_nome: perfil?.nome ?? null,
      usuario_email: perfil?.email ?? null,
      tipo_busca: consulta.tipoBusca,
      termo: consulta.termo,
      nome_parte: consulta.nomeParte?.trim() || null,
      tribunais: consulta.tribunais,
      total_processos: consulta.totalProcessos,
      custo_estimado: Number(consulta.custoEstimado.toFixed(2)),
      custo_cobrado: Number(consulta.custoCobrado.toFixed(2))
    });
    if (error) console.error('[historico] falha ao registrar consulta:', error.message);
  } catch (e) {
    console.error('[historico] falha ao registrar consulta', e);
  }
}
