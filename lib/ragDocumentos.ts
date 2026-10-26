import { getAdminClient } from '@/lib/track';
import { OpenAIEmbeddings } from '@langchain/openai';

export interface TrechoProcessual {
  id: string;
  numeroCnj: string;
  tipoDocumento: string;
  titulo: string;
  conteudoTexto: string;
  similaridade?: number;
  origem: 'vetorial' | 'movimentacao_relacional';
}

export interface IndexarDocumentoInput {
  processoId?: string;
  numeroCnj: string;
  tipoDocumento: 'sentenca' | 'liminar' | 'peticao_inicial' | 'intimacao' | 'contestacao' | 'acordao' | 'outro';
  titulo: string;
  textoCompleto: string;
  metadata?: Record<string, unknown>;
}

/**
 * Divide um texto longo em blocos menores com sobreposição para embeddings.
 */
export function particionarTextoEmChunks(texto: string, chunkSize = 1000, overlap = 200): string[] {
  const limpo = texto.replace(/\r\n/g, '\n').trim();
  if (limpo.length <= chunkSize) return [limpo];

  const chunks: string[] = [];
  let inicio = 0;

  while (inicio < limpo.length) {
    let fim = inicio + chunkSize;
    if (fim >= limpo.length) {
      chunks.push(limpo.slice(inicio).trim());
      break;
    }

    // Tenta quebrar em quebra de linha ou ponto final próximo
    const quebraLinha = limpo.lastIndexOf('\n', fim);
    const pontoFinal = limpo.lastIndexOf('. ', fim);
    const corte = Math.max(quebraLinha, pontoFinal);

    if (corte > inicio + chunkSize * 0.6) {
      fim = corte + (limpo[corte] === '.' ? 2 : 1);
    }

    chunks.push(limpo.slice(inicio, fim).trim());
    inicio = fim - overlap;
  }

  return chunks.filter(c => c.length > 20);
}

/**
 * Gera embedding vetorial para busca semântica via OpenAI text-embedding-3-small (1536 dimensões).
 */
export async function gerarEmbedding(texto: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
      apiKey
    });
    return await embeddings.embedQuery(texto);
  } catch (err) {
    console.error('[ragDocumentos] Falha ao gerar embedding:', err);
    return null;
  }
}

/**
 * Busca trechos relevantes em documentos processuais por similaridade semântica (RAG).
 * Possui fallback gracioso para busca relacional em ap_movimentacoes se a tabela vetorial
 * ainda não tiver registros para o processo.
 */
export async function buscarTrechosProcessuais({
  numeroCnj,
  query,
  limite = 4
}: {
  numeroCnj: string;
  query: string;
  limite?: number;
}): Promise<TrechoProcessual[]> {
  const db = getAdminClient();
  if (!db) return [];

  const embedding = await gerarEmbedding(query);

  // 1. Tenta busca semântica na base vetorial (pgvector)
  if (embedding) {
    try {
      const { data: vetoriais, error: errRpc } = await db.rpc('match_documentos_processo', {
        query_embedding: embedding,
        filter_cnj: numeroCnj,
        match_threshold: 0.6,
        match_count: limite
      });

      if (!errRpc && vetoriais && vetoriais.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return vetoriais.map((v: any) => ({
          id: v.id,
          numeroCnj: v.numero_cnj,
          tipoDocumento: v.tipo_documento,
          titulo: v.titulo || 'Trecho processual',
          conteudoTexto: v.conteudo_texto,
          similaridade: v.similarity,
          origem: 'vetorial'
        }));
      }
    } catch {
      // Ignora erro se a tabela/função ainda não foi executada no Supabase e segue para fallback
    }
  }

  // 2. Fallback resiliente: busca em ap_movimentacoes / ap_processos no banco relacional
  try {
    const { data: proc } = await db
      .from('ap_processos')
      .select('id')
      .eq('numero_cnj', numeroCnj)
      .maybeSingle();

    if (!proc?.id) return [];

    const { data: movs } = await db
      .from('ap_movimentacoes')
      .select('id, titulo, conteudo, data_movimentacao')
      .eq('processo_id', proc.id)
      .order('data_movimentacao', { ascending: false })
      .limit(limite);

    if (movs && movs.length > 0) {
      return movs.map(m => ({
        id: m.id,
        numeroCnj,
        tipoDocumento: 'movimentacao',
        titulo: m.titulo,
        conteudoTexto: m.conteudo || m.titulo,
        origem: 'movimentacao_relacional'
      }));
    }
  } catch (err) {
    console.error('[ragDocumentos] Erro no fallback relacional:', err);
  }

  return [];
}

/**
 * Indexa um documento na base vetorial ap_documentos_vetoriais.
 */
export async function indexarDocumentoProcessual({
  processoId,
  numeroCnj,
  tipoDocumento,
  titulo,
  textoCompleto,
  metadata = {}
}: IndexarDocumentoInput): Promise<{ chunksIndexados: number }> {
  const db = getAdminClient();
  if (!db) return { chunksIndexados: 0 };

  const chunks = particionarTextoEmChunks(textoCompleto);
  if (chunks.length === 0) return { chunksIndexados: 0 };

  let indexados = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await gerarEmbedding(chunk);

    const { error } = await db.from('ap_documentos_vetoriais').insert({
      processo_id: processoId || null,
      numero_cnj: numeroCnj,
      tipo_documento: tipoDocumento,
      titulo,
      conteudo_texto: chunk,
      chunk_index: i,
      embedding: embedding || null,
      metadata: { ...metadata, totalChunks: chunks.length }
    });

    if (!error) indexados++;
  }

  return { chunksIndexados: indexados };
}
