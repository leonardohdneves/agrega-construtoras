import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aliquotaSimples, bdiCalculado, calcularDatas, codigoDoNo, folhasDaEap, formacaoPreco, lerCsvReferencia, nivelDoNovoNo, numeroBr, temCiclo } from '../src/lib/engenharia.ts';

test('planejamento: sucessora começa no dia seguinte ao fim da predecessora', () => {
  const datas = calcularDatas([
    { id: 'a', inicio: '2026-10-01', duracaoDias: 3, predecessoraId: null },
    { id: 'b', inicio: '2026-09-20', duracaoDias: 2, predecessoraId: 'a' },
    { id: 'c', inicio: '2026-10-10', duracaoDias: 1, predecessoraId: 'b' },
  ]);
  assert.deepEqual(datas.get('a'), { inicio: '2026-10-01', fim: '2026-10-03' });
  // b começa em 04/10 (fim de a + 1), não no início informado.
  assert.deepEqual(datas.get('b'), { inicio: '2026-10-04', fim: '2026-10-05' });
  // c tem início informado depois de b, então prevalece.
  assert.deepEqual(datas.get('c'), { inicio: '2026-10-10', fim: '2026-10-10' });
});

test('planejamento: detecta dependência circular', () => {
  assert.equal(temCiclo([{ id: 'a', inicio: '2026-10-01', duracaoDias: 1, predecessoraId: 'b' }, { id: 'b', inicio: '2026-10-01', duracaoDias: 1, predecessoraId: 'a' }]), true);
  assert.equal(temCiclo([{ id: 'a', inicio: '2026-10-01', duracaoDias: 1, predecessoraId: 'a' }]), true);
  assert.equal(temCiclo([{ id: 'a', inicio: '2026-10-01', duracaoDias: 1, predecessoraId: null }, { id: 'b', inicio: '2026-10-01', duracaoDias: 1, predecessoraId: 'a' }]), false);
});

test('BDI calculado pela fórmula do TCU', () => {
  // (1+0,0668) x (1+0,0123) x (1+0,074) / (1-0,0665) - 1 = 24,24%
  const bdi = bdiCalculado({ ac: 4, s: 0.8, r: 1.27, g: 0.61, df: 1.23, l: 7.4, i: 6.65 });
  assert.equal(bdi, 24.25);
  assert.equal(bdiCalculado({}), 0);
  assert.equal(bdiCalculado({ l: 10 }), 10);
});

test('níveis da EAP respeitam o nível de apropriação', () => {
  assert.equal(nivelDoNovoNo('obra', null), null, 'obra não usa EAP');
  assert.equal(nivelDoNovoNo('etapa', null), 'etapa');
  assert.equal(nivelDoNovoNo('etapa', 'etapa'), null, 'não passa do nível de apropriação');
  assert.equal(nivelDoNovoNo('subetapa', 'etapa'), 'subetapa');
  assert.equal(nivelDoNovoNo('subetapa', 'subetapa'), null);
  assert.equal(nivelDoNovoNo('tarefa', 'subetapa'), 'tarefa');
  assert.equal(nivelDoNovoNo('tarefa', 'tarefa'), null);
});

test('código hierárquico', () => {
  assert.equal(codigoDoNo(null, 0), '1');
  assert.equal(codigoDoNo(null, 2), '3');
  assert.equal(codigoDoNo('1.2', 0), '1.2.1');
});

test('números em pt-BR e com ponto', () => {
  assert.equal(numeroBr('1.234,56'), 1234.56);
  assert.equal(numeroBr('12,5'), 12.5);
  assert.equal(numeroBr('1234.56'), 1234.56);
  assert.equal(numeroBr(''), null);
  assert.equal(numeroBr('abc'), null);
});

test('CSV de referência: insumos, composições e componentes', () => {
  const csv = [
    'tipo;codigo;descricao;unidade;preco;grupo;insumo;coeficiente',
    'insumo;1;Cimento CP II;kg;"0,85";materiais;;',
    'insumo;2;Pedreiro;h;28,40;mao-de-obra;;',
    'composicao;C1;Alvenaria 1 vez;m2;;alvenaria;;',
    'componente;C1;;;;;1;4,5',
    'componente;C1;;;;;2;0,8',
  ].join('\n').replace('"0,85"', '0,85');
  const r = lerCsvReferencia(csv);
  assert.deepEqual(r.erros, []);
  assert.equal(r.insumos.length, 2);
  assert.equal(r.insumos[0].precoCentavos, 85);
  assert.equal(r.composicoes.length, 1);
  assert.equal(r.componentes.length, 2);
  assert.equal(r.componentes[0].coeficiente, 4.5);
});

test('CSV aponta erros de cabeçalho, linha incompleta e componente órfão', () => {
  assert.match(lerCsvReferencia('a;b').erros[0], /cabeçalho/);
  const r = lerCsvReferencia([
    'tipo;codigo;descricao;unidade;preco;grupo;insumo;coeficiente',
    'insumo;1;;kg;1;;;',
    'insumo;2;Areia;m3;abc;;;',
    'componente;X;;;;;9;1',
  ].join('\n'));
  assert.ok(r.erros.some((e) => /Linha 2: falta a descrição/.test(e)));
  assert.ok(r.erros.some((e) => /Linha 3: preço inválido/.test(e)));
  assert.ok(r.erros.some((e) => /composição X não existe/.test(e)));
  assert.ok(r.erros.some((e) => /insumo 9 não existe/.test(e)));
});

test('orçamento: só serviços (composições) que estão na obra', async () => {
  const { erroItemOrcamento } = await import('../src/lib/engenharia.ts');
  assert.equal(erroItemOrcamento({ tipo: 'composicao', obraId: 'o1' }, 'o1'), null);
  assert.match(erroItemOrcamento({ tipo: 'insumo', obraId: 'o1' }, 'o1') ?? '', /Só serviços/);
  assert.match(erroItemOrcamento({ tipo: 'composicao', obraId: 'o2' }, 'o1') ?? '', /não está na obra/);
  assert.match(erroItemOrcamento(null, 'o1') ?? '', /não está na obra/);
});

test('planilha: pai automático é a última linha acima de nível mais alto', async () => {
  const { paiAutomatico } = await import('../src/lib/engenharia.ts');
  const linhas = [
    { id: 'obra', nivel: 'obra' as const, codigo: '1' },
    { id: 'etapaA', nivel: 'etapa' as const, codigo: '1.1' },
    { id: 'tarefa1', nivel: 'tarefa' as const, codigo: '1.1.1' },
    { id: 'etapaB', nivel: 'etapa' as const, codigo: '1.2' },
    { id: 'sub', nivel: 'subetapa' as const, codigo: '1.2.1' },
  ];
  assert.equal(paiAutomatico(linhas, 'tarefa'), 'sub');
  assert.equal(paiAutomatico(linhas, 'subetapa'), 'etapaB');
  assert.equal(paiAutomatico(linhas, 'etapa'), 'obra');
  assert.equal(paiAutomatico(linhas, 'obra'), null);
  assert.equal(paiAutomatico([], 'tarefa'), null);
  // A ordem é a da planilha (código), não a da lista: 1.10 vem depois de 1.9.
  assert.equal(paiAutomatico([{ id: 'e10', nivel: 'etapa', codigo: '1.10' }, { id: 'e9', nivel: 'etapa', codigo: '1.9' }], 'tarefa'), 'e10');
});

test('planilha: hierarquia Obra › Etapa › Sub Etapa › Tarefa e serviço só na Tarefa', async () => {
  const { erroPaiPlanilha, erroServicoNaLinha } = await import('../src/lib/engenharia.ts');
  assert.equal(erroPaiPlanilha(null, 'tarefa'), null);
  assert.equal(erroPaiPlanilha('obra', 'tarefa'), null, 'pode pular níveis');
  assert.equal(erroPaiPlanilha('etapa', 'subetapa'), null);
  assert.match(erroPaiPlanilha('tarefa', 'tarefa') ?? '', /não pode ficar dentro/);
  assert.match(erroPaiPlanilha('subetapa', 'etapa') ?? '', /não pode ficar dentro/);
  assert.match(erroPaiPlanilha('obra', 'obra') ?? '', /não pode ficar dentro/);
  assert.equal(erroServicoNaLinha('tarefa', true), null);
  assert.equal(erroServicoNaLinha('etapa', false), null);
  assert.match(erroServicoNaLinha('etapa', true) ?? '', /Tarefa/);
  assert.match(erroServicoNaLinha('obra', true) ?? '', /Tarefa/);
});

test('planilha: total de cada linha soma as linhas abaixo dela', async () => {
  const { totaisPlanilha } = await import('../src/lib/engenharia.ts');
  const t = totaisPlanilha([
    { id: 'obra', paiId: null, valor: 0 },
    { id: 'etapa', paiId: 'obra', valor: 0 },
    { id: 't1', paiId: 'etapa', valor: 100.1 },
    { id: 't2', paiId: 'etapa', valor: 50.2 },
    { id: 't3', paiId: 'obra', valor: 10 },
  ]);
  assert.equal(t.get('etapa'), 150.3);
  assert.equal(t.get('obra'), 160.3);
  assert.equal(t.get('t3'), 10);
});

test('relatório de orçamento: sintético com BDI e peso; analítico com insumos da composição', async () => {
  const { montarRelatorioOrcamento } = await import('../src/lib/engenharia.ts');
  const linhas = [
    { id: 'o', paiId: null, nivel: 'obra' as const, codigo: '1', descricao: 'Casa', servico: null },
    { id: 'e', paiId: 'o', nivel: 'etapa' as const, codigo: '1.1', descricao: 'Alvenaria', servico: null },
    { id: 't', paiId: 'e', nivel: 'tarefa' as const, codigo: '1.1.1', descricao: 'Parede de bloco', servico: { codigo: '103324', unidade: 'm2', quantidade: 10, custoUnitario: 80, itemId: 's1' } },
    { id: 'v', paiId: 'e', nivel: 'tarefa' as const, codigo: '1.1.2', descricao: 'A definir', servico: null },
  ];
  const sint = montarRelatorioOrcamento(linhas, 25, false);
  assert.equal(sint.custoTotal, 800);
  assert.equal(sint.precoTotal, 1000);
  assert.equal(sint.bdiValor, 200);
  const serv = sint.linhas.find((l) => l.tipo === 'servico');
  assert.ok(serv && serv.tipo === 'servico');
  assert.equal(serv.precoUnitario, 100);
  assert.equal(serv.total, 1000);
  assert.equal(serv.peso, 100);
  const grupo = sint.linhas.find((l) => l.tipo === 'grupo' && l.item === '1.1');
  assert.ok(grupo && grupo.tipo === 'grupo' && grupo.total === 1000);
  assert.ok(sint.linhas.some((l) => l.tipo === 'tarefa' && l.item === '1.1.2'), 'tarefa sem serviço aparece');
  assert.ok(!sint.linhas.some((l) => l.tipo === 'insumo'), 'sintético não lista insumos');

  const ana = montarRelatorioOrcamento(linhas, 25, true, new Map([['s1', [{ codigo: '7271', descricao: 'BLOCO', unidade: 'un', coeficiente: 12.5, precoUnitario: 4 }, { codigo: '88309', descricao: 'PEDREIRO', unidade: 'h', coeficiente: 1, precoUnitario: 30 }]]]));
  const insumos = ana.linhas.filter((l) => l.tipo === 'insumo');
  assert.equal(insumos.length, 2);
  const bloco = insumos[0];
  assert.ok(bloco.tipo === 'insumo');
  assert.equal(bloco.quantidade, 125);
  assert.equal(bloco.custoTotal, 500);
  // Os insumos vêm logo abaixo do serviço, na ordem da planilha.
  const iServ = ana.linhas.findIndex((l) => l.tipo === 'servico');
  assert.equal(ana.linhas[iServ + 1].tipo, 'insumo');
});

test('planilha: troca de nível respeita a linha de cima, as de baixo e o serviço', async () => {
  const { erroMudarNivel } = await import('../src/lib/engenharia.ts');
  // O caso da obra: "Casa Leo e Marcela" na raiz, com uma Sub Etapa abaixo, passa de Etapa a Obra.
  assert.equal(erroMudarNivel(null, 'obra', ['subetapa'], false), null);
  assert.equal(erroMudarNivel(null, 'etapa', ['subetapa'], false), null);
  assert.match(erroMudarNivel(null, 'subetapa', ['subetapa'], false) ?? '', /Sub Etapa abaixo/);
  assert.match(erroMudarNivel(null, 'tarefa', ['subetapa'], false) ?? '', /abaixo dela/);
  assert.match(erroMudarNivel('obra', 'obra', [], false) ?? '', /não pode ficar dentro/);
  assert.equal(erroMudarNivel('obra', 'etapa', ['tarefa'], false), null);
  assert.match(erroMudarNivel('etapa', 'subetapa', [], true) ?? '', /serviço lançado/);
  assert.equal(erroMudarNivel('etapa', 'tarefa', [], true), null);
});

test('curva ABC: ordem, percentual, acumulado e classes 80/95', async () => {
  const { curvaAbc } = await import('../src/lib/engenharia.ts');
  const item = (codigo: string, total: number) => ({ codigo, descricao: codigo, unidade: 'un', quantidade: 1, precoUnitario: total, total });
  const r = curvaAbc([item('c', 50), item('a', 700), item('b', 150), item('d', 100), item('zero', 0)]);
  assert.equal(r.total, 1000);
  assert.deepEqual(r.linhas.map((l) => [l.codigo, l.percentual, l.acumulado, l.classe]), [
    ['a', 70, 70, 'A'],
    ['b', 15, 85, 'A'], // começa em 70% (< 80%): ainda é A
    ['d', 10, 95, 'B'], // começa em 85%
    ['c', 5, 100, 'C'], // começa em 95%
  ]);
  assert.deepEqual(r.classes.A, { itens: 2, valor: 850, percentual: 85 });
  assert.deepEqual(r.classes.C, { itens: 1, valor: 50, percentual: 5 });
  assert.equal(curvaAbc([]).total, 0);
});

test('curva ABC de serviços soma o mesmo serviço em várias Tarefas; de insumos usa coeficiente × quantidade', async () => {
  const { abcServicos, abcInsumos } = await import('../src/lib/engenharia.ts');
  const linhas = [
    { id: 't1', paiId: null, nivel: 'tarefa' as const, codigo: '1', descricao: 'Parede térreo', servico: { codigo: 'S1', unidade: 'm2', quantidade: 10, custoUnitario: 80, itemId: 's1', descricaoServico: 'Alvenaria' } },
    { id: 't2', paiId: null, nivel: 'tarefa' as const, codigo: '2', descricao: 'Parede superior', servico: { codigo: 'S1', unidade: 'm2', quantidade: 5, custoUnitario: 80, itemId: 's1', descricaoServico: 'Alvenaria' } },
    { id: 't3', paiId: null, nivel: 'tarefa' as const, codigo: '3', descricao: 'Reboco', servico: { codigo: 'S2', unidade: 'm2', quantidade: 20, custoUnitario: 30, itemId: 's2', descricaoServico: 'Reboco' } },
  ];
  const serv = abcServicos(linhas, 25);
  const s1 = serv.find((s) => s.codigo === 'S1')!;
  assert.equal(serv.length, 2);
  assert.equal(s1.quantidade, 15);
  assert.equal(s1.precoUnitario, 100);
  assert.equal(s1.total, 1500);
  assert.equal(s1.descricao, 'Alvenaria');

  const comp = new Map([
    ['s1', [{ codigo: 'BLOCO', descricao: 'Bloco', unidade: 'un', coeficiente: 12.5, precoUnitario: 4 }, { codigo: 'PEDREIRO', descricao: 'Pedreiro', unidade: 'h', coeficiente: 1, precoUnitario: 30 }]],
    ['s2', [{ codigo: 'PEDREIRO', descricao: 'Pedreiro', unidade: 'h', coeficiente: 0.5, precoUnitario: 30 }]],
  ]);
  const ins = abcInsumos(linhas, comp);
  const pedreiro = ins.find((i) => i.codigo === 'PEDREIRO')!;
  assert.equal(pedreiro.quantidade, 25); // 1 × 15 + 0,5 × 20
  assert.equal(pedreiro.total, 750);
  assert.equal(ins.find((i) => i.codigo === 'BLOCO')!.total, 750); // 12,5 × 15 × 4
});

test('planilha: mover Etapa leva as linhas de baixo junto e renumera tudo', async () => {
  const { moverLinha, renumerar } = await import('../src/lib/engenharia.ts');
  const nos = [
    { id: 'obra', paiId: null, codigo: '1' },
    { id: 'fund', paiId: 'obra', codigo: '1.1' },
    { id: 'estacas', paiId: 'fund', codigo: '1.1.1' },
    { id: 'blocos', paiId: 'fund', codigo: '1.1.2' },
    { id: 'alv', paiId: 'obra', codigo: '1.2' },
    { id: 'parede', paiId: 'alv', codigo: '1.2.1' },
  ];
  const desce = moverLinha(nos, 'fund', 'baixo')!;
  assert.deepEqual(Object.fromEntries(desce), { obra: '1', alv: '1.1', parede: '1.1.1', fund: '1.2', estacas: '1.2.1', blocos: '1.2.2' });
  const sobe = moverLinha(nos, 'blocos', 'cima')!;
  assert.equal(sobe.get('blocos'), '1.1.1');
  assert.equal(sobe.get('estacas'), '1.1.2');
  assert.equal(moverLinha(nos, 'fund', 'cima'), null, 'primeira não sobe');
  assert.equal(moverLinha(nos, 'alv', 'baixo'), null, 'última não desce');
  assert.equal(moverLinha(nos, 'obra', 'cima'), null);
  // Buracos de exclusão somem (1.3 vira 1.2; 1.10 vem depois de 1.9).
  const r = renumerar([
    { id: 'a', paiId: null, codigo: '1' },
    { id: 'b', paiId: 'a', codigo: '1.1' },
    { id: 'c', paiId: 'a', codigo: '1.3' },
    { id: 'd', paiId: 'c', codigo: '1.3.10' },
    { id: 'e', paiId: 'c', codigo: '1.3.9' },
  ]);
  assert.deepEqual(Object.fromEntries(r), { a: '1', b: '1.1', c: '1.2', e: '1.2.1', d: '1.2.2' });
});

test('planejamento pela EAP: as folhas da planilha viram atividades, na ordem da planilha', () => {
  const linhas = [
    { id: 'obra', paiId: null, codigo: '1' },
    { id: 'etapa2', paiId: 'obra', codigo: '1.2' },
    { id: 'tarefa10', paiId: 'etapa2', codigo: '1.2.10' },
    { id: 'etapa1', paiId: 'obra', codigo: '1.1' },
    { id: 'tarefa1', paiId: 'etapa1', codigo: '1.1.1' },
    { id: 'tarefa2', paiId: 'etapa1', codigo: '1.1.2' },
    { id: 'tarefa9', paiId: 'etapa2', codigo: '1.2.9' },
  ];
  assert.deepEqual(folhasDaEap(linhas).map((l) => l.id), ['tarefa1', 'tarefa2', 'tarefa9', 'tarefa10']);
  assert.deepEqual(folhasDaEap([]), []);
});

test('formação do preço: adm/imprevistos/financeiro sobre direto+indireto; impostos e lucro sobre a nova base', () => {
  const f = formacaoPreco(1000, 200, { administracao: 10, imprevistos: 2, financeiro: 1, lucro: 10 }, [6, 2]);
  assert.equal(f.base1, 1200);
  assert.equal(f.administracao, 120);
  assert.equal(f.imprevistos, 24);
  assert.equal(f.financeiro, 12);
  assert.equal(f.base2, 1356);
  assert.equal(f.impostos, 108.48);
  assert.equal(f.lucro, 135.6);
  assert.equal(f.precoVenda, 1600.08);
});

test('formação do preço sem percentuais devolve o próprio custo', () => {
  const f = formacaoPreco(500, 0, { administracao: 0, imprevistos: 0, financeiro: 0, lucro: 0 }, []);
  assert.equal(f.precoVenda, 500);
});

test('BDI calculado é preço de venda sobre custo direto, menos 1', () => {
  const f = formacaoPreco(1000, 200, { administracao: 10, imprevistos: 2, financeiro: 1, lucro: 10 }, [6, 2]);
  assert.equal(f.bdi, 60.01);
  assert.equal(formacaoPreco(0, 0, { administracao: 5, imprevistos: 0, financeiro: 0, lucro: 0 }, []).bdi, 0);
});

test('Simples Nacional: alíquota nominal da faixa escolhida por anexo', () => {
  assert.equal(aliquotaSimples('IV', 1), 4.5);
  assert.equal(aliquotaSimples('III', 6), 33);
  assert.equal(aliquotaSimples('V', 3), 19.5);
  assert.equal(aliquotaSimples(null, 2), null);
  assert.equal(aliquotaSimples('IV', 7), null);
});
