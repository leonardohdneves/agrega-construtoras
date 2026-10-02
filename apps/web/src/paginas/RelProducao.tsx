import { useEffect, useState } from 'react';
import { api, diaCurto, formatarMoeda, formatarNumero, NOMES_UNIDADE, type UnidadeInsumo } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { TabelaRelatorio } from '../componentes/Relatorio';
import { atalhosDias, SeletorDias, textoDias, type Dias } from './ProdMotoristas';

type Resp = {
  de: string;
  ate: string;
  resumo: {
    cargas: number; m3: number; bombeado: number; devolvido: number; devolvidoPct: number | null; diasComCarga: number; m3PorDia: number | null;
    m3PorBetoneiraDia: number | null; materialTeorico: number; materialPorM3: number | null; cimentoKgM3: number | null; canceladas: number; m3Cancelado: number;
  };
  porDia: { dia: string; cargas: number; m3: number; bombeado: number; devolvido: number; betoneiras: number; material: number; materialPorM3: number | null }[];
  porTraco: { codigo: string; descricao: string | null; cargas: number; m3: number; material: number; materialPorM3: number | null; cimentoKgM3: number | null }[];
  porCliente: { cliente: string; obras: number; cargas: number; m3: number; bombeado: number; devolvido: number }[];
  porBetoneira: { codigo: string; viagens: number; m3: number; m3PorViagem: number; dias: number; m3PorDia: number; viagensPorDia: number; devolvido: number; motoristas: number }[];
  porBomba: { codigo: string; bombeamentos: number; m3: number; dias: number; m3PorDia: number }[];
  consumo: { nome: string; tipo: string; unidade: UnidadeInsumo; consumo: number; porM3: number | null; custo: number; entradas: number; valorEntradas: number; ajustes: number }[];
};

const ABAS = [
  { id: 'dia', texto: 'Por dia' },
  { id: 'traco', texto: 'Por traço' },
  { id: 'cliente', texto: 'Por cliente' },
  { id: 'frota', texto: 'Betoneiras e bombas' },
  { id: 'consumo', texto: 'Consumo de insumos' },
] as const;

const m3 = (n: number | null) => (n === null ? '—' : `${formatarNumero(n, n % 1 ? 1 : 0)} m³`);

export function RelProducao() {
  const [periodo, setPeriodo] = useState<Dias>(atalhosDias()[0].p);
  const [aba, setAba] = useState<(typeof ABAS)[number]['id']>('dia');
  const [d, setD] = useState<Resp | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setErro('');
    api<Resp>(`/prod/relatorios?de=${periodo.de}&ate=${periodo.ate}`).then(setD).catch((e) => setErro((e as Error).message));
  }, [periodo]);
  const atual = ABAS.find((a) => a.id === aba)!;

  return (
    <>
      <CabecalhoDocumento
        modulo="Produção"
        titulo={`Relatório de produção · ${atual.texto}`}
        descricao="Concreto produzido na usina, pelas cargas registradas, com o custo de material pelo traço."
        periodo={textoDias(periodo)}
      />
      <SeletorDias valor={periodo} aoMudar={setPeriodo} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      {d && (
        <div className="grade">
          <div className="card indicador">
            <span className="rotulo-ind">Volume produzido</span>
            <span className="valor-ind mono">{m3(d.resumo.m3)}</span>
            <span className="small muted">{d.resumo.cargas} cargas · {d.resumo.diasComCarga} dias</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Média por dia</span>
            <span className="valor-ind mono">{m3(d.resumo.m3PorDia)}</span>
            <span className="small muted">{m3(d.resumo.m3PorBetoneiraDia)} por betoneira</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Material por m³ (traço)</span>
            <span className="valor-ind mono">{d.resumo.materialPorM3 === null ? '—' : formatarMoeda(d.resumo.materialPorM3)}</span>
            <span className="small muted">cimento {d.resumo.cimentoKgM3 ?? '—'} kg/m³</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Bombeado</span>
            <span className="valor-ind mono">{m3(d.resumo.bombeado)}</span>
            <span className="small muted">
              devolvido {m3(d.resumo.devolvido)}
              {d.resumo.devolvidoPct !== null ? ` (${(d.resumo.devolvidoPct * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : ''}
            </span>
          </div>
        </div>
      )}

      <div className="abas nao-imprimir" role="tablist">
        {ABAS.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} className={aba === a.id ? 'ativa' : ''} onClick={() => setAba(a.id)}>
            {a.texto}
          </button>
        ))}
      </div>

      {d && aba === 'dia' && (
        <TabelaRelatorio
          titulo="Produção por dia"
          arquivo="producao-por-dia"
          linhas={d.porDia}
          colunas={[
            { titulo: 'Dia', valor: (l) => diaCurto(l.dia) },
            { titulo: 'Cargas', valor: (l) => l.cargas, formato: 'numero', total: true },
            { titulo: 'm³', valor: (l) => l.m3, formato: 'decimal', total: true },
            { titulo: 'Bombeado (m³)', valor: (l) => l.bombeado, formato: 'decimal', total: true },
            { titulo: 'Devolvido (m³)', valor: (l) => l.devolvido, formato: 'decimal', total: true },
            { titulo: 'Betoneiras', valor: (l) => l.betoneiras, formato: 'numero' },
            { titulo: 'Material (traço)', valor: (l) => l.material, formato: 'moeda', total: true },
            { titulo: 'Material por m³', valor: (l) => l.materialPorM3, formato: 'moeda' },
          ]}
        />
      )}
      {d && aba === 'traco' && (
        <TabelaRelatorio
          titulo="Produção por traço"
          arquivo="producao-por-traco"
          linhas={d.porTraco}
          colunas={[
            { titulo: 'Traço', valor: (l) => l.codigo },
            { titulo: 'Descrição', valor: (l) => l.descricao },
            { titulo: 'Cargas', valor: (l) => l.cargas, formato: 'numero', total: true },
            { titulo: 'm³', valor: (l) => l.m3, formato: 'decimal', total: true },
            { titulo: 'Participação', valor: (l) => (d.resumo.m3 ? l.m3 / d.resumo.m3 : null), formato: 'pct' },
            { titulo: 'Cimento (kg/m³)', valor: (l) => l.cimentoKgM3, formato: 'numero' },
            { titulo: 'Material', valor: (l) => l.material, formato: 'moeda', total: true },
            { titulo: 'Material por m³', valor: (l) => l.materialPorM3, formato: 'moeda' },
          ]}
        />
      )}
      {d && aba === 'cliente' && (
        <TabelaRelatorio
          titulo="Produção por cliente"
          arquivo="producao-por-cliente"
          linhas={d.porCliente}
          colunas={[
            { titulo: 'Cliente', valor: (l) => l.cliente },
            { titulo: 'Obras', valor: (l) => l.obras, formato: 'numero' },
            { titulo: 'Cargas', valor: (l) => l.cargas, formato: 'numero', total: true },
            { titulo: 'm³', valor: (l) => l.m3, formato: 'decimal', total: true },
            { titulo: 'Participação', valor: (l) => (d.resumo.m3 ? l.m3 / d.resumo.m3 : null), formato: 'pct' },
            { titulo: 'Bombeado (m³)', valor: (l) => l.bombeado, formato: 'decimal', total: true },
            { titulo: 'Devolvido (m³)', valor: (l) => l.devolvido, formato: 'decimal', total: true },
          ]}
        />
      )}
      {d && aba === 'frota' && (
        <>
          <TabelaRelatorio
            titulo="Betoneiras"
            arquivo="producao-por-betoneira"
            linhas={d.porBetoneira}
            colunas={[
              { titulo: 'Betoneira', valor: (l) => l.codigo },
              { titulo: 'Viagens', valor: (l) => l.viagens, formato: 'numero', total: true },
              { titulo: 'm³', valor: (l) => l.m3, formato: 'decimal', total: true },
              { titulo: 'm³ por viagem', valor: (l) => l.m3PorViagem, formato: 'decimal' },
              { titulo: 'Dias com carga', valor: (l) => l.dias, formato: 'numero' },
              { titulo: 'Viagens por dia', valor: (l) => l.viagensPorDia, formato: 'decimal' },
              { titulo: 'm³ por dia', valor: (l) => l.m3PorDia, formato: 'decimal' },
              { titulo: 'Devolvido (m³)', valor: (l) => l.devolvido, formato: 'decimal', total: true },
              { titulo: 'Motoristas', valor: (l) => l.motoristas, formato: 'numero' },
            ]}
          />
          <TabelaRelatorio
            titulo="Bombas"
            arquivo="producao-por-bomba"
            linhas={d.porBomba}
            vazio="Nenhum bombeamento no período."
            colunas={[
              { titulo: 'Bomba', valor: (l) => l.codigo },
              { titulo: 'Bombeamentos', valor: (l) => l.bombeamentos, formato: 'numero', total: true },
              { titulo: 'm³ bombeado', valor: (l) => l.m3, formato: 'decimal', total: true },
              { titulo: 'Dias com bombeamento', valor: (l) => l.dias, formato: 'numero' },
              { titulo: 'm³ por dia', valor: (l) => l.m3PorDia, formato: 'decimal' },
            ]}
          />
        </>
      )}
      {d && aba === 'consumo' && (
        <TabelaRelatorio
          titulo="Consumo de insumos"
          descricao="Consumo pelo traço das cargas, comparado com as compras (entradas das notas) e os acertos de inventário no período."
          arquivo="producao-consumo-insumos"
          linhas={d.consumo}
          vazio="Nenhum consumo no período."
          colunas={[
            { titulo: 'Insumo', valor: (l) => l.nome },
            { titulo: 'Consumo (traço)', valor: (l) => `${formatarNumero(l.consumo, 0)} ${NOMES_UNIDADE[l.unidade]}` },
            { titulo: 'Por m³', valor: (l) => (l.porM3 === null ? '—' : `${formatarNumero(l.porM3, l.porM3 < 10 ? 2 : 0)} ${NOMES_UNIDADE[l.unidade]}`) },
            { titulo: 'Custo (traço)', valor: (l) => l.custo, formato: 'moeda', total: true },
            { titulo: 'Compras', valor: (l) => (l.entradas ? `${formatarNumero(l.entradas, 0)} ${NOMES_UNIDADE[l.unidade]}` : '—') },
            { titulo: 'Valor das compras', valor: (l) => l.valorEntradas, formato: 'moeda', total: true },
            {
              titulo: 'Acerto de inventário',
              valor: (l) => (l.ajustes ? `${l.ajustes > 0 ? '+' : ''}${formatarNumero(l.ajustes, 0)} ${NOMES_UNIDADE[l.unidade]}` : '—'),
              destaque: (l) => (l.ajustes < 0 ? 'perigo' : undefined),
            },
          ]}
        />
      )}
      {d && d.resumo.canceladas > 0 && (
        <p className="small muted">
          {d.resumo.canceladas} carga(s) cancelada(s) no período ({m3(d.resumo.m3Cancelado)}) não entram nos totais.
        </p>
      )}
    </>
  );
}
