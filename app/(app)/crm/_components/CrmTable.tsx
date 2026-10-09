'use client';

import { Table, Badge, Avatar } from '@mantine/core';
import { Check, X } from 'lucide-react';
import styles from './crm-table.module.css';
import { LIMIAR_DIAS_ATENCAO, type CrmEtapa, type CrmItem, type CrmResponsavel } from '@/lib/crm';

const fmtReais = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function corEtapa(etapa: CrmEtapa | undefined): string {
  if (!etapa) return '#c4a86f';
  if (!etapa.ehFinal) return etapa.cor ?? '#c4a86f';
  // Etapas finais: verde para as que soam a sucesso, vermelho para o restante (mesma heurística
  // usada no preview visual — "Bem sucedido"/"Concluído"/"Resolvido"/"Pago" vs "Mal sucedido"/"Arquivado").
  const nomeLower = etapa.nome.toLowerCase();
  const soaASucesso = /sucedid|conclu|resolvid|pago/.test(nomeLower);
  return soaASucesso ? '#6fc4b1' : '#ee8c72';
}

function nomeResponsavel(id: string | null, responsaveis: CrmResponsavel[]): string | null {
  if (!id) return null;
  return responsaveis.find(r => r.id === id)?.nome ?? null;
}

export default function CrmTable({
  itens,
  etapas,
  responsaveis,
  onAbrirItem
}: {
  itens: CrmItem[];
  etapas: CrmEtapa[];
  responsaveis: CrmResponsavel[];
  onAbrirItem: (item: CrmItem) => void;
}) {
  const etapaPorId = new Map(etapas.map(e => [e.id, e]));

  return (
    <Table.ScrollContainer minWidth={960}>
      <Table layout="fixed" verticalSpacing="sm" highlightOnHover={false}>
        <colgroup>
          <col style={{ width: 190 }} />
          <col />
          <col style={{ width: 170 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 84 }} />
        </colgroup>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Etapa</Table.Th>
            <Table.Th>Cliente</Table.Th>
            <Table.Th>Movimentação</Table.Th>
            <Table.Th>Resp.</Table.Th>
            <Table.Th>Situação</Table.Th>
            <Table.Th ta="right">Valor</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {itens.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={7} ta="center" py="xl" c="dimmed">
                Nenhum item neste funil ainda.
              </Table.Td>
            </Table.Tr>
          )}
          {itens.map(item => {
            const etapa = etapaPorId.get(item.etapaId);
            const dias = item.diasSemMovimentacao ?? null;
            const atencao = dias != null && dias >= LIMIAR_DIAS_ATENCAO;
            const responsavelNome = nomeResponsavel(item.advogadoResponsavelId, responsaveis);
            return (
              <Table.Tr key={item.id} className={styles.row} tabIndex={0} onClick={() => onAbrirItem(item)}>
                <Table.Td>
                  <Badge variant="dot" color={corEtapa(etapa)} size="md" radius="sm">
                    {etapa?.nome ?? '—'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <button
                    type="button"
                    className={styles.clienteNome}
                    title={item.clienteNome ?? item.titulo}
                    onClick={e => {
                      e.stopPropagation();
                      onAbrirItem(item);
                    }}
                  >
                    {item.clienteNome ?? item.titulo}
                  </button>
                  <div className={styles.clienteMeta}>
                    {item.numeroCnj ?? 'Sem processo vinculado'}
                    {item.uf ? ` · ${item.uf}` : ''}
                  </div>
                </Table.Td>
                <Table.Td>
                  {item.ultimaMovimentacaoEm ? (
                    <>
                      <div className={styles.movData}>{new Date(item.ultimaMovimentacaoEm).toLocaleDateString('pt-BR')}</div>
                      {atencao ? (
                        <div className={styles.movAlerta}>
                          <span className={styles.pulse} aria-hidden />
                          31+ dias parado
                        </div>
                      ) : (
                        <div className={styles.movDias}>há {dias} dias</div>
                      )}
                    </>
                  ) : (
                    <div className={styles.movDias}>Sem movimentação</div>
                  )}
                </Table.Td>
                <Table.Td>
                  <div className={styles.responsavel}>
                    {responsavelNome ? (
                      <>
                        <Avatar size={28} radius="xl" color="brand">
                          {responsavelNome.charAt(0).toUpperCase()}
                        </Avatar>
                        <span className={styles.responsavelNome}>{responsavelNome}</span>
                      </>
                    ) : (
                      <span className={styles.movDias}>Sem responsável</span>
                    )}
                  </div>
                </Table.Td>
                <Table.Td>
                  {item.situacaoFinanceira === 'adimplente' && (
                    <span className={`${styles.situacao} ${styles.situacaoAdimplente}`}>
                      <Check size={15} strokeWidth={2.2} />
                      Adimplente
                    </span>
                  )}
                  {item.situacaoFinanceira === 'inadimplente' && (
                    <span className={`${styles.situacao} ${styles.situacaoInadimplente}`}>
                      <X size={15} strokeWidth={2.2} />
                      Inadimplente
                    </span>
                  )}
                  {!item.situacaoFinanceira && <span className={styles.movDias}>—</span>}
                </Table.Td>
                <Table.Td className={styles.valor}>{item.valorCausa != null ? fmtReais(item.valorCausa) : '—'}</Table.Td>
                <Table.Td>
                  <span className={styles.acao}>Abrir →</span>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
