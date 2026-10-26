import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient } from '@/lib/track';
import { cleanDigits, isValidCpf, isValidCnpj } from '@/lib/format';
import { formatProcessNumber } from '@/lib/cnj';
import { normalizarTelefoneBr, enviarTextoWhatsApp } from '@/lib/whatsapp';
import { FONTES_DATAJUD } from '@/lib/fontesDatajud';

export interface DocumentoMonitorado {
  id: string;
  documento: string;
  tipo: 'cpf' | 'cnpj';
  nomeTitular: string | null;
  ativo: boolean;
  notificarWhatsapp: boolean;
  notificarEmail: boolean;
  totalProcessosConhecidos: number;
  ultimaVarreduraEm: string | null;
  proximaVarreduraEm: string | null;
}

/**
 * Cadastra ou reativa o monitoramento contínuo de um CPF ou CNPJ.
 */
export async function cadastrarDocumentoMonitoramento({
  userId,
  documentoRaw,
  nomeTitular,
  notificarWhatsapp = true,
  notificarEmail = true
}: {
  userId: string;
  documentoRaw: string;
  nomeTitular?: string;
  notificarWhatsapp?: boolean;
  notificarEmail?: boolean;
}): Promise<{ sucesso: boolean; id?: string; erro?: string }> {
  const db = getAdminClient();
  if (!db) return { sucesso: false, erro: 'Banco indisponível.' };

  const digits = cleanDigits(documentoRaw);
  const ehCpf = digits.length === 11 && isValidCpf(digits);
  const ehCnpj = digits.length === 14 && isValidCnpj(digits);

  if (!ehCpf && !ehCnpj) {
    return { sucesso: false, erro: 'Documento inválido. Informe um CPF com 11 dígitos ou CNPJ com 14 dígitos válido.' };
  }

  const tipo = ehCpf ? 'cpf' : 'cnpj';

  const { data, error } = await db
    .from('ap_monitoramento_documentos')
    .upsert(
      {
        user_id: userId,
        documento: digits,
        tipo,
        nome_titular: nomeTitular || null,
        ativo: true,
        notificar_whatsapp: notificarWhatsapp,
        notificar_email: notificarEmail,
        proxima_varredura_em: new Date().toISOString()
      },
      { onConflict: 'user_id,documento' }
    )
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[monitoramentoCpf] Erro ao cadastrar documento:', error.message);
    return { sucesso: false, erro: 'Falha ao salvar monitoramento do documento.' };
  }

  return { sucesso: true, id: data?.id };
}

/**
 * Lista os CPFs e CNPJs que o usuário acompanha para novas ações judiciais.
 */
export async function listarDocumentosMonitorados(userId: string): Promise<DocumentoMonitorado[]> {
  const db = getAdminClient();
  if (!db) return [];

  const { data, error } = await db
    .from('ap_monitoramento_documentos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data.map(d => ({
    id: d.id,
    documento: d.documento,
    tipo: d.tipo,
    nomeTitular: d.nome_titular,
    ativo: d.ativo,
    notificarWhatsapp: d.notificar_whatsapp,
    notificarEmail: d.notificar_email,
    totalProcessosConhecidos: Array.isArray(d.processos_conhecidos_cnjs) ? d.processos_conhecidos_cnjs.length : 0,
    ultimaVarreduraEm: d.ultima_varredura_em,
    proximaVarreduraEm: d.proxima_varredura_em
  }));
}

/**
 * Consulta a API do DataJud para verificar se novos processos surgiram para o documento monitorado.
 */
export async function varrerNovosProcessosPorDocumento(
  db: SupabaseClient,
  monitoramento: {
    id: string;
    user_id: string;
    documento: string;
    tipo: string;
    nome_titular?: string | null;
    processos_conhecidos_cnjs: string[];
    notificar_whatsapp: boolean;
  }
): Promise<{ novosProcessosEncontrados: number; cnjsNovos: string[] }> {
  const apiKey = process.env.DATAJUD_API_KEY;
  if (!apiKey) return { novosProcessosEncontrados: 0, cnjsNovos: [] };

  const conhecidosSet = new Set(monitoramento.processos_conhecidos_cnjs || []);
  const novosCnjs: string[] = [];

  // Busca o telefone do usuário caso precise alertar no WhatsApp
  let telefoneNormalizado: string | null = null;
  if (monitoramento.notificar_whatsapp) {
    const { data: perfil } = await db.from('ap_perfis').select('telefone').eq('id', monitoramento.user_id).maybeSingle();
    telefoneNormalizado = normalizarTelefoneBr(perfil?.telefone as string | null);
  }

  // Consulta tribunais principais (ex: TJSP, TRF3, TRT2 ou aliases disponíveis)
  const tribunaisPrincipais = ['tjsp', 'trf3', 'trt2', 'tjrj', 'tjmg'].filter(alias =>
    FONTES_DATAJUD.some(f => f.id === alias)
  );

  for (const alias of tribunaisPrincipais) {
    try {
      const res = await fetch(`https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: {
            match_phrase: {
              'dadosBasicos.polo.parte.pessoa.numeroDocumentoPrincipal': monitoramento.documento
            }
          },
          size: 10
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) continue;

      const body = await res.json().catch(() => null);
      const hits = body?.hits?.hits || [];

      for (const hit of hits) {
        const numCnjRaw = hit._source?.numeroProcesso;
        if (!numCnjRaw) continue;

        const cnjLimpo = cleanDigits(numCnjRaw);
        if (cnjLimpo.length !== 20 || conhecidosSet.has(cnjLimpo)) continue;

        // Novo processo localizado!
        conhecidosSet.add(cnjLimpo);
        novosCnjs.push(cnjLimpo);

        // 1. Vincula processo ao banco geral e ao monitoramento do usuário
        const { data: procSalvo } = await db
          .from('ap_processos')
          .upsert(
            {
              numero_cnj: cnjLimpo,
              tribunal: alias.toUpperCase(),
              classe_processual: hit._source?.classe?.nome || null,
              assunto_principal: hit._source?.assuntos?.[0]?.nome || null,
              status: 'ativo'
            },
            { onConflict: 'numero_cnj' }
          )
          .select('id')
          .maybeSingle();

        if (procSalvo?.id) {
          await db.from('ap_processos_monitorados').upsert(
            {
              user_id: monitoramento.user_id,
              processo_id: procSalvo.id,
              notificar_whatsapp: monitoramento.notificar_whatsapp,
              notificar_email: true
            },
            { onConflict: 'user_id,processo_id' }
          );
        }

        // 2. Grava notificação no feed interno do app
        const cnjFormatado = formatProcessNumber(cnjLimpo);
        await db.from('ap_notificacoes').insert({
          user_id: monitoramento.user_id,
          processo_id: procSalvo?.id || null,
          titulo: `Novo processo distribuído no seu ${monitoramento.tipo.toUpperCase()}`,
          mensagem: `Identificamos uma nova ação distribuída no tribunal ${alias.toUpperCase()}: processo nº ${cnjFormatado}. O monitoramento já foi ativado automaticamente.`
        });

        // 3. Notifica via WhatsApp se habilitado
        if (telefoneNormalizado) {
          const msgWhatsApp =
            `*Novo processo identificado no seu ${monitoramento.tipo.toUpperCase()}!*\n\n` +
            `Nossa varredura automática localizou uma nova distribuição:\n` +
            `• *Processo*: ${cnjFormatado}\n` +
            `• *Tribunal*: ${alias.toUpperCase()}\n` +
            `• *Classe*: ${hit._source?.classe?.nome || 'Ação Cível/Trabalhista'}\n\n` +
            `Já incluímos este processo no seu acompanhamento inteligente com IA. Você será avisado de qualquer despacho ou determinação importante.`;

          await enviarTextoWhatsApp(telefoneNormalizado, msgWhatsApp);
        }
      }
    } catch {
      // Falhas individuais de timeout em tribunal não interrompem os demais
    }
  }

  // Atualiza registro de monitoramento com a lista atualizada de CNJs e agenda próxima varredura
  const agora = new Date();
  const proxima = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000); // varredura semanal

  await db
    .from('ap_monitoramento_documentos')
    .update({
      processos_conhecidos_cnjs: Array.from(conhecidosSet),
      ultima_varredura_em: agora.toISOString(),
      proxima_varredura_em: proxima.toISOString()
    })
    .eq('id', monitoramento.id);

  return {
    novosProcessosEncontrados: novosCnjs.length,
    cnjsNovos: novosCnjs
  };
}
