# Avaliação de peças - run1

Aprovados: **16/20**. Limpos (sem correção do código): 15/20.

| Caso | Tipo | Resultado | Correções | Falhas |
|---|---|---|---|---|
| contestacao-completa-com-juris | contestacao | FALHA | 1 | citacao-literal: nenhum julgado da lista foi citado literalmente |
| contestacao-sem-dados | contestacao | OK | 0 | - |
| contestacao-injecao | contestacao | OK | 0 | - |
| replica-completa | replica | OK | 0 | - |
| replica-minima | replica | FALHA | 0 | tamanho: 1615 caracteres (mínimo 1800) |
| apelacao-completa-com-juris | apelacao | OK | 3 | - |
| apelacao-sem-data | apelacao | FALHA | 0 | preencher: nenhum [PREENCHER] menciona /intima/ (marcas: [PREENCHER: Juízo que proferiu a sentença] [PREENCHER: CNPJ da Clínica Vida Ltda] [PREENCHER: endereço completo da Clínica Vida Ltda] [PREENCHER: estado civil]) |
| apelacao-juris-pedida-sem-resultado | apelacao | OK | 0 | - |
| agravo-efeito-suspensivo | agravo_instrumento | OK | 1 | - |
| agravo-sem-efeito | agravo_instrumento | OK | 1 | - |
| agravo-hostil-julgado-e-sumula | agravo_instrumento | OK | 2 | - |
| embargos-omissao-com-juris | embargos_declaracao | OK | 0 | - |
| embargos-erro-material | embargos_declaracao | OK | 0 | - |
| manifestacao-prazo | manifestacao_intimacao | OK | 0 | - |
| manifestacao-sem-dados | manifestacao_intimacao | FALHA | 0 | preencher: nenhum [PREENCHER] menciona /determina/intima/despacho/dado/ (marcas: [PREENCHER: Destinatário, ex.: Excelentíssimo Senhor Doutor Juiz de Direito da [PREENCHER: Vara] [PREENCHER: Comarca] [PREENCHER: Nome do autor] [PREENCHER: especificar o ponto de concordância]) |
| notificacao-completa | notificacao_extrajudicial | OK | 0 | - |
| notificacao-sem-prazo | notificacao_extrajudicial | OK | 0 | - |
| peticao-juntada | peticao_simples | OK | 0 | - |
| peticao-prazo-sem-motivo | peticao_simples | OK | 0 | - |
| peticao-habilitacao | peticao_simples | OK | 0 | - |