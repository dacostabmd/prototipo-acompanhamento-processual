import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { verificarRecursoPlano } from '@/lib/planos';
import { getRedis } from '@/lib/redis';

/**
 * Porta de entrada das rotas de peças: autenticação, restrição a advogados (409, mesmo no Pro) e plano Pro (403).
 * A restrição por perfil vem ANTES do plano, para um consultante avulso não pagar por um recurso que continuaria bloqueado.
 */
export async function autorizarPecas(request: Request): Promise<{ userId: string; role: string | null } | NextResponse> {
  const naoAutenticado = await requireUser(request);
  if (naoAutenticado) return naoAutenticado;

  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });

  const db = getAdminClient();
  const [acesso, perfil] = await Promise.all([
    verificarRecursoPlano(userId, 'pecasIa'),
    db ? db.from('ap_perfis').select('role').eq('id', userId).maybeSingle() : Promise.resolve({ data: null })
  ]);
  const role = ((perfil.data as { role?: string } | null)?.role ?? null) as string | null;

  if (role === 'cliente') {
    return NextResponse.json(
      {
        error:
          'Os modelos de peças são restritos a advogados. A consulta avulsa serve para acompanhar processos; para redigir peças, procure um advogado ou cadastre-se com perfil de advogado.',
        codigo: 'restrito_advogado'
      },
      { status: 409 }
    );
  }
  if (!acesso.permitido) {
    return NextResponse.json({ error: 'Os modelos de peças com IA são exclusivos do Plano Pro.', codigo: 'recurso_pro' }, { status: 403 });
  }
  return { userId, role };
}

// Sem Redis (dev/local), o limite vale só dentro da instância.
const contagemLocal = new Map<string, { n: number; expira: number }>();

/** Limite de gerações por usuário (cada uma custa uma chamada ao gpt-4o). true = excedeu. */
export async function excedeuLimiteGeracao(userId: string, escopo: 'rajada' | 'dia', limite: number, janelaSegundos: number): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      const chave = `ap:pecas:${escopo}:user:${userId}`;
      const n = await redis.incr(chave);
      if (n === 1) await redis.expire(chave, janelaSegundos);
      return n > limite;
    } catch (e) {
      console.error('[pecas] falha no limite por usuário', e);
      return false;
    }
  }
  const chave = `${escopo}:${userId}`;
  const agora = Date.now();
  const atual = contagemLocal.get(chave);
  if (!atual || atual.expira < agora) {
    contagemLocal.set(chave, { n: 1, expira: agora + janelaSegundos * 1000 });
    return false;
  }
  atual.n += 1;
  return atual.n > limite;
}
