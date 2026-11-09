import { NextResponse } from 'next/server';
import { autorizarAgenda, COLUNAS_PRAZO, type LinhaPrazo } from '@/lib/agendaApi';
import { gerarIcs, hojeSaoPaulo } from '@/lib/prazos';

/**
 * Exporta os prazos pendentes como calendário .ics (text/calendar, RFC 5545): um evento de dia inteiro por prazo,
 * com alarme 1 dia antes. A tela baixa via authFetch como blob (o download não carrega o token sozinho).
 */
export async function GET(request: Request) {
  const auth = await autorizarAgenda(request);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await auth.db
    .from('ap_prazos')
    .select(COLUNAS_PRAZO)
    .eq('user_id', auth.userId)
    .eq('concluido', false)
    .order('data_vencimento', { ascending: true })
    .limit(1000);

  if (error) {
    console.error('[api/agenda/ics] erro:', error.message);
    return NextResponse.json({ error: 'Não foi possível gerar o calendário.' }, { status: 500 });
  }

  const ics = gerarIcs(
    ((data as LinhaPrazo[] | null) ?? []).map(p => ({
      id: p.id,
      titulo: p.titulo,
      descricao: p.descricao,
      tipo: p.tipo,
      dataVencimento: p.data_vencimento,
      numeroCnj: p.numero_cnj
    })),
    { siteUrl: process.env.NEXT_PUBLIC_SITE_URL }
  );

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="jusconsulta-agenda-${hojeSaoPaulo()}.ics"`,
      'Cache-Control': 'no-store'
    }
  });
}
