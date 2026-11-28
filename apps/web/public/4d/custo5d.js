// Código da página, em arquivo próprio (a política de segurança do Agrega não aceita script inline).
import * as THREE from './vendor/three/build/three.module.js';
import { OrbitControls } from './vendor/three/examples/jsm/controls/OrbitControls.js';
import { lerGeometriaIfc } from './agrega/ifc-servidor.js';
import { lerModelo3d } from './agrega/modelo3d.js';
import { corDoElemento, COR } from './cronograma.js';
import { carregarDadosObra, hojeIso } from './agrega/dados5d.js';
import { classificar } from './classificacao_geometrica.js';
import { assinatura, aprender, sugerir } from './reconhecimento.js';

const $ = (id) => document.getElementById(id);
const brl = (v) => (v === null || v === undefined) ? '-' : 'R$ ' + Math.round(v).toLocaleString('pt-BR');
const dataBR = (iso) => iso.split('-').reverse().join('/');
const mesBR = (iso) => { const m = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']; const [a, mm] = iso.split('-'); return `${m[+mm - 1]}/${a.slice(2)}`; };

const estado = {
  cron: null, curva: null, pr: null,
  tarefasPorId: new Map(), vinculos: {}, elementos: [], raio: 30,
  porGuid: new Map(), assinaturas: {}, aprendizado: {}, selecao: new Set(), alvo: null,
  refAz: 0, refEl: 11, // frente de referência (graus); muda quando o usuário trava a vista
  travado: false,
  hoje: new Date().toISOString().slice(0, 10),
};

// ---------- 3D ----------
const host = $('viewer');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);
const cena = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
const controles = new OrbitControls(camera, renderer.domElement);
// giro mais suave e previsível
controles.enableDamping = true;
controles.dampingFactor = 0.08;
controles.rotateSpeed = 0.45;
controles.zoomSpeed = 0.6;
controles.panSpeed = 0.6;
controles.minPolarAngle = 0.02; // impede o giro até a posição exatamente vertical
controles.screenSpacePanning = true;
cena.add(new THREE.HemisphereLight(0xffffff, 0x9a9a92, 1.2));
const sol = new THREE.DirectionalLight(0xffffff, 1.2);
sol.position.set(50, 100, 50);
cena.add(sol);
// IFC é Z para cima; three.js é Y para cima. Rotação de −90° em X, como no MKT BUILDER de pé.
const grupoModelo = new THREE.Group();
grupoModelo.rotation.x = -Math.PI / 2;
// grupo externo: "Virar" inverte o modelo de cabeça para baixo, sem mexer na orientação interna
const grupoVirar = new THREE.Group();
grupoVirar.add(grupoModelo);
cena.add(grupoVirar);
let virado = false;
function ajustar() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', ajustar);
ajustar();
// o laço só começa depois que o módulo terminou de carregar (o indicador usa constantes declaradas abaixo)
function loop() { requestAnimationFrame(loop); controles.update(); renderer.render(cena, camera); desenharGizmo(); }
requestAnimationFrame(loop);

// enquadra a caixa inteira do modelo e guarda o raio para as vistas
function enquadrar() {
  const caixa = new THREE.Box3().setFromObject(grupoModelo);
  if (caixa.isEmpty()) return;
  const centro = caixa.getCenter(new THREE.Vector3());
  const raio = Math.max(caixa.getSize(new THREE.Vector3()).length() / 2, 1);
  estado.raio = raio;
  controles.target.copy(centro);
  camera.near = raio / 500;
  camera.far = raio * 50;
  camera.updateProjectionMatrix();
  controles.minDistance = raio * 0.05;
  controles.maxDistance = raio * 20;
  vista('iso');
}

// vistas prontas: posiciona a câmera em torno do alvo, sem depender do giro do mouse
// As vistas partem da FRENTE: quando travado, a frente é a vista em que o usuário travou.
// [deslocamento horizontal em graus a partir da frente, elevação em graus]
// Topo fica a ~62°; quando virado, o topo fica do lado −Y, então a elevação inverte.
function vista(tipo, dir = null) {
  const c = controles.target, r = estado.raio;
  // distância que faz a caixa inteira caber no campo de visão vertical (40°), com folga
  const d = (r / Math.sin((camera.fov * Math.PI / 180) / 2)) * 1.1;
  let az, el;
  if (dir) { // vista a partir de um eixo (indicador de giro)
    az = Math.atan2(dir.x, dir.z);
    el = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  } else {
    const base = { az: estado.refAz, el: estado.refEl };
    const [deslocamento, elevacao] = { frente: [0, base.el], fundos: [180, base.el], lateral: [90, base.el], iso: [45, 35], topo: [0, 62] }[tipo];
    az = (base.az + deslocamento) * Math.PI / 180;
    el = elevacao * Math.PI / 180;
  }
  el = el * (virado ? -1 : 1);
  camera.position.set(
    c.x + d * Math.cos(el) * Math.sin(az),
    c.y + d * Math.sin(el),
    c.z + d * Math.cos(el) * Math.cos(az),
  );
  // zera o movimento residual do giro (inércia do arraste), que podia levar a câmera para cima
  const amortecimento = controles.enableDamping;
  controles.enableDamping = false;
  controles.update();
  controles.enableDamping = amortecimento;
}
$('vEnquadrar').addEventListener('click', enquadrar);
$('vFrente').addEventListener('click', () => vista('frente'));
$('vFundos').addEventListener('click', () => vista('fundos'));
$('vLateral').addEventListener('click', () => vista('lateral'));
$('vTopo').addEventListener('click', () => vista('topo'));
$('vIso').addEventListener('click', () => vista('iso'));
// Girar: mostra/oculta o indicador de eixos (ferramenta de órbita). Arraste o indicador para girar o modelo;
// clique numa esfera para ver o modelo a partir desse eixo.
$('vGirar').addEventListener('click', () => {
  const visivel = $('gizmo').hidden;
  $('gizmo').hidden = !visivel;
  $('vGirar').classList.toggle('on', visivel);
});
// Travar: a vista atual (direção e inclinação) vira a frente de referência.
// A câmera não se move; o giro com o mouse fica bloqueado até destravar.
// Frente volta exatamente a essa vista; as demais são calculadas a partir dela.
function referenciaAtual() {
  const o = camera.position.clone().sub(controles.target);
  const r = o.length() || 1;
  return { az: Math.atan2(o.x, o.z) * 180 / Math.PI, el: Math.asin(Math.max(-1, Math.min(1, o.y / r))) * 180 / Math.PI };
}
$('vTravar').addEventListener('click', () => {
  estado.travado = !estado.travado;
  $('vTravar').classList.toggle('on', estado.travado);
  // travado: a imagem não gira nem desloca; o zoom continua livre
  controles.enableRotate = !estado.travado;
  controles.enablePan = !estado.travado;
  $('gizmo').classList.toggle('bloqueado', estado.travado);
  if (estado.travado) {
    const ref = referenciaAtual();
    estado.refAz = ref.az;
    estado.refEl = ref.el;
  }
});
// ---------- indicador de eixos (ferramenta de órbita) ----------
// Desenhado a cada quadro a partir da orientação da câmera. Arrastar gira; clicar numa esfera alinha a vista.
const GIZMO_R = 34;
const EIXOS_GIZMO = [
  { nome: 'X', v: [1, 0, 0], cor: '#e53935' },
  { nome: 'Y', v: [0, 1, 0], cor: '#43a047' },
  { nome: 'Z', v: [0, 0, 1], cor: '#1e88e5' },
];
function desenharGizmo() {
  if ($('gizmo').hidden) return;
  const inv = camera.matrixWorldInverse;
  const alvos = [];
  for (const e of EIXOS_GIZMO) {
    const w = new THREE.Vector3(...e.v);
    const vv = w.clone().transformDirection(inv); // espaço da câmera: x direita, y cima, z para o observador
    alvos.push({ ...e, sx: vv.x, sy: -vv.y, z: vv.z, dir: w.clone(), positivo: true });
    alvos.push({ ...e, sx: -vv.x, sy: vv.y, z: -vv.z, dir: w.clone().multiplyScalar(-1), positivo: false });
  }
  alvos.sort((a, b) => a.z - b.z);
  estado.gizmoAlvos = alvos.map((a) => ({ x: a.sx * GIZMO_R, y: a.sy * GIZMO_R, dir: a.dir, positivo: a.positivo }));
  let g = '<circle cx="0" cy="0" r="42" fill="var(--card)" stroke="var(--linha)" stroke-width="1"/>';
  for (const a of alvos) {
    const x = a.sx * GIZMO_R, y = a.sy * GIZMO_R;
    if (a.positivo) {
      g += `<line x1="0" y1="0" x2="${x}" y2="${y}" stroke="${a.cor}" stroke-width="2"/>`;
      g += `<circle cx="${x}" cy="${y}" r="9" fill="${a.cor}"/>`;
      g += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="500" fill="#fff">${a.nome}</text>`;
    } else {
      g += `<circle cx="${x}" cy="${y}" r="7" fill="var(--card)" stroke="${a.cor}" stroke-width="1.5"/>`;
    }
  }
  $('gizmoSvg').innerHTML = g;
}
function eixoMaisProximo(px, py) {
  let melhor = null, dist = 14; // raio de captura em pixels do indicador
  for (const a of estado.gizmoAlvos ?? []) {
    const d = Math.hypot(px - a.x, py - a.y);
    if (d < dist) { dist = d; melhor = a; }
  }
  return melhor;
}
// posição do ponteiro no sistema do indicador (origem no centro do SVG de 96 px)
function posGizmo(e) {
  const r = $('gizmoSvg').getBoundingClientRect();
  return { x: (e.clientX - r.left - r.width / 2) * (100 / r.width), y: (e.clientY - r.top - r.height / 2) * (100 / r.height) };
}
let arrasto = null;
$('gizmoSvg').addEventListener('pointerdown', (e) => {
  if (estado.travado) return;
  arrasto = { x: e.clientX, y: e.clientY, moveu: false };
  $('gizmoSvg').setPointerCapture(e.pointerId);
});
$('gizmoSvg').addEventListener('pointermove', (e) => {
  if (!arrasto || estado.travado) return;
  const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
  if (Math.hypot(dx, dy) > 3) arrasto.moveu = true;
  if (!arrasto.moveu) return;
  arrasto.x = e.clientX; arrasto.y = e.clientY;
  // gira a câmera em torno do alvo: horizontal = azimute, vertical = inclinação
  const c = controles.target;
  const o = camera.position.clone().sub(c);
  const r = o.length();
  let theta = Math.atan2(o.x, o.z) - dx * 0.012;
  let phi = Math.acos(Math.max(-1, Math.min(1, o.y / r))) - dy * 0.012;
  phi = Math.max(0.05, Math.min(Math.PI - 0.05, phi));
  camera.position.set(c.x + r * Math.sin(phi) * Math.sin(theta), c.y + r * Math.cos(phi), c.z + r * Math.sin(phi) * Math.cos(theta));
  const amortecimento = controles.enableDamping;
  controles.enableDamping = false;
  controles.update();
  controles.enableDamping = amortecimento;
});
$('gizmoSvg').addEventListener('pointerup', (e) => {
  const foi = arrasto;
  arrasto = null;
  if (!foi || foi.moveu || estado.travado) return;
  const p = posGizmo(e);
  const alvo = eixoMaisProximo(p.x, p.y);
  if (alvo) vista(null, alvo.dir);
});

$('vVirar').addEventListener('click', () => {
  virado = !virado;
  grupoVirar.rotation.x = virado ? Math.PI : 0;
  grupoVirar.updateMatrixWorld(true);
  enquadrar();
});

// ---------- carregamento do IFC com barra de progresso ----------
const LOTE = 150; // elementos por lote; entre lotes a tela é redesenhada (barra avança)

function mostrarCarregando(fase, pct) {
  $('carregando').hidden = false;
  $('fase').textContent = fase;
  $('barraCarr').style.width = pct + '%';
  $('pctCarr').textContent = Math.round(pct) + '%';
}
function ocultarCarregando() { $('carregando').hidden = true; }
// pausa curta para o navegador redesenhar a barra; não depende de requestAnimationFrame (que pausa em abas ocultas)
const proximoQuadro = () => new Promise((r) => setTimeout(r, 0));

// O Agrega lê o IFC no servidor; aqui só montamos as malhas.
async function carregarIfc(arquivo) {
  try {
    mostrarCarregando('Enviando o modelo ao Agrega', 5);
    await proximoQuadro();
    const base = new URLSearchParams(location.search).get('api') || location.origin;
    const { pecas, ignoradas } = await lerGeometriaIfc({ base, dados: new Uint8Array(await arquivo.arrayBuffer()) });
    // só as classes de elemento conhecidas entram nesta tela
    const elementos = pecas.filter((p) => p.tipo);

    grupoModelo.clear();
    estado.extras = null;
    $('rotuloExtras').hidden = true;
    estado.elementos = [];
    estado.porGuid = new Map();
    for (let inicio = 0; inicio < elementos.length; inicio += LOTE) {
      const fim = Math.min(inicio + LOTE, elementos.length);
      for (let k = inicio; k < fim; k++) {
        const p = elementos[k];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(p.nor, 3));
        geo.setIndex(new THREE.BufferAttribute(p.idx, 1));
        const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COR.SEM_VINCULO }));
        m.applyMatrix4(new THREE.Matrix4().fromArray(p.matriz));
        m.userData.globalId = p.guid;
        m.userData.nome = p.nome;
        m.userData.tipo = p.tipo;
        grupoModelo.add(m);
        estado.elementos.push(m);
        if (!estado.porGuid.has(p.guid)) estado.porGuid.set(p.guid, []);
        estado.porGuid.get(p.guid).push(m);
      }
      mostrarCarregando('Montando a geometria', 10 + (fim / elementos.length) * 85);
      await proximoQuadro();
    }
    mostrarCarregando('Calculando classes', 97);
    await proximoQuadro();
    calcularAssinaturas();
    enquadrar();
    if (ignoradas) console.warn(`${ignoradas} geometria(s) com coordenadas inválidas foram ignoradas.`);
    atualizarTempo();
    renderLista();
  } finally {
    ocultarCarregando();
  }
}

// Modelo convertido no computador (.agrega3d): nada é enviado. Cada forma vira uma geometria compartilhada.
// Elementos da obra são peças clicáveis; parafusos e afins vão em lote, escondidos até a pessoa pedir.
async function carregarModelo3d(arquivo) {
  try {
    mostrarCarregando('Abrindo o modelo convertido', 5);
    await proximoQuadro();
    const modelo = await lerModelo3d(await arquivo.arrayBuffer());
    const geometrias = modelo.formas.map((f) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(f.pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(f.nor, 3));
      geo.setIndex(new THREE.BufferAttribute(f.idx, 1));
      return geo;
    });

    grupoModelo.clear();
    estado.elementos = [];
    estado.porGuid = new Map();
    estado.selecao.clear();
    const emLote = new Map(); // forma -> peças sem classe de elemento
    for (let inicio = 0; inicio < modelo.pecas; inicio += 2000) {
      const fim = Math.min(inicio + 2000, modelo.pecas);
      for (let k = inicio; k < fim; k++) {
        const el = modelo.elementos[modelo.pecaElemento[k]];
        const forma = modelo.pecaForma[k];
        if (!el.tipo) {
          if (!emLote.has(forma)) emLote.set(forma, []);
          emLote.get(forma).push(k);
          continue;
        }
        const m = new THREE.Mesh(geometrias[forma], new THREE.MeshLambertMaterial({ color: COR.SEM_VINCULO }));
        m.applyMatrix4(new THREE.Matrix4().fromArray(modelo.matrizes, k * 16));
        m.userData.globalId = el.guid;
        m.userData.nome = el.nome;
        m.userData.tipo = el.tipo;
        grupoModelo.add(m);
        estado.elementos.push(m);
        if (!estado.porGuid.has(el.guid)) estado.porGuid.set(el.guid, []);
        estado.porGuid.get(el.guid).push(m);
      }
      mostrarCarregando('Montando a geometria', 10 + (fim / modelo.pecas) * 80);
      await proximoQuadro();
    }

    const extras = new THREE.Group();
    const cinza = new THREE.MeshLambertMaterial({ color: 0x5f5e5a });
    let quantosExtras = 0;
    for (const [forma, lista] of emLote) {
      const lote = new THREE.InstancedMesh(geometrias[forma], cinza, lista.length);
      lista.forEach((k, i) => lote.setMatrixAt(i, new THREE.Matrix4().fromArray(modelo.matrizes, k * 16)));
      extras.add(lote);
      quantosExtras += lista.length;
    }
    extras.visible = $('chkExtras').checked;
    grupoModelo.add(extras);
    estado.extras = extras;
    $('rotuloExtras').hidden = !quantosExtras;
    $('quantosExtras').textContent = quantosExtras.toLocaleString('pt-BR');

    mostrarCarregando('Calculando classes', 95);
    await proximoQuadro();
    calcularAssinaturas();
    enquadrar();
    atualizarTempo();
    renderLista();
    $('avisoAside').textContent = `Modelo aberto do computador: ${modelo.origem}.`;
  } finally {
    ocultarCarregando();
  }
}

// classe e assinatura de cada elemento, a partir da caixa no mundo (para o reconhecimento)
function calcularAssinaturas() {
  estado.assinaturas = {};
  for (const [guid, meshes] of estado.porGuid) {
    if (!guid) continue;
    const caixa = new THREE.Box3();
    for (const m of meshes) caixa.union(new THREE.Box3().setFromObject(m));
    if (caixa.isEmpty()) continue;
    const t = caixa.getSize(new THREE.Vector3());
    const dados = { dx: t.x, dy: t.z, dz: t.y }; // no mundo do three.js, a altura é Y
    estado.assinaturas[guid] = assinatura({ classe: classificar(dados), ...dados });
  }
}

// ---------- seleção por clique ----------
const raio = new THREE.Raycaster();
const ponteiro = new THREE.Vector2();
let inicioClique = null;
renderer.domElement.addEventListener('pointerdown', (e) => { inicioClique = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!inicioClique || Math.hypot(e.clientX - inicioClique.x, e.clientY - inicioClique.y) > 5) return;
  const r = renderer.domElement.getBoundingClientRect();
  ponteiro.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ponteiro.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raio.setFromCamera(ponteiro, camera);
  const hit = raio.intersectObjects(estado.elementos, false)[0];
  const guid = hit?.object.userData.globalId ?? null;
  const multi = e.ctrlKey || e.metaKey;
  if (!multi) estado.selecao.clear();
  if (guid) {
    if (multi && estado.selecao.has(guid)) estado.selecao.delete(guid);
    else estado.selecao.add(guid);
  }
  atualizarSelecao();
});

// ---------- janela de informações do elemento ----------
function dataAtual() {
  const pontos = estado.curva?.pontos ?? [];
  return pontos[+$('tempo').value]?.data ?? estado.hoje;
}
// informações de um elemento para a coluna esquerda
function infoDe(guid) {
  const peca = (estado.porGuid.get(guid) ?? [])[0];
  const atualId = estado.vinculos[guid];
  const atual = atualId ? estado.tarefasPorId.get(atualId) : null;
  const nova = estado.alvo ? estado.tarefasPorId.get(estado.alvo) : null;
  const eapDe = (t) => t ? `${t.eapCodigo ?? ''} ${t.nome.charAt(0) + t.nome.slice(1).toLowerCase()}` : 'sem vínculo';
  // custo: do nó da EAP da atividade vinculada (o custo por elemento ainda não existe)
  const linha = atual ? (estado.pr?.linhas ?? []).find((l) => l.id === atual.eapNoId) : null;
  const status = atual ? corDoElemento(guid, estado.vinculos, estado.tarefasPorId, dataAtual(), estado.hoje).status : null;
  const nomesStatus = { nao_iniciado: 'Não iniciado', em_execucao: 'Em execução', concluido: 'Concluído', atrasado: 'Atrasado' };
  const nomeIfc = peca?.userData.nome;
  const tipo = peca?.userData.tipo ?? '-';
  const mudou = !!(nova && nova.id !== atualId);
  return {
    // o IFC de proxies traz "Undefined" como nome; nesse caso usa o tipo
    titulo: (nomeIfc && nomeIfc !== 'Undefined') ? nomeIfc : `Elemento ${tipo}`,
    tipo,
    guidCurto: guid ? guid.slice(0, 12) + '…' : '-',
    status: status ? nomesStatus[status] : 'Sem vínculo',
    atual: eapDe(atual),
    prev: linha ? brl(linha.custoPrevisto) : '-',
    exec: linha ? brl(linha.executado) : '-',
    nova: nova
      ? (mudou ? `Nova atividade (escolhida na lista): ${eapDe(nova)}` : 'A atividade escolhida na lista é a atual.')
      : 'Escolha uma atividade na lista da EAP para trocar o vínculo.',
    mudou,
  };
}
// coluna esquerda: informações do elemento selecionado (primeiro da seleção)
function atualizarPopup() {
  const guid = [...estado.selecao][0] ?? null;
  const n = estado.selecao.size;
  if (guid) {
    const i = infoDe(guid);
    $('esqInfo').innerHTML = `<h3>${i.titulo}${n > 1 ? ` (+${n - 1})` : ''}</h3>
      <dl><dt>Tipo IFC</dt><dd>${i.tipo}</dd><dt>GlobalId</dt><dd>${i.guidCurto}</dd>
      <dt>Status</dt><dd>${i.status}</dd><dt>Vínculo atual</dt><dd>${i.atual}</dd>
      <dt>Custo previsto</dt><dd>${i.prev}</dd><dt>Custo executado</dt><dd>${i.exec}</dd></dl>
      <div class="aviso2">${i.nova}</div>`;
    $('esqConfirmar').disabled = !i.mudou;
  } else {
    $('esqInfo').innerHTML = '<div class="aviso2">Nenhum elemento selecionado. Clique numa peça do 3D.</div>';
    $('esqConfirmar').disabled = true;
  }
}
// confirma a atividade escolhida na lista para todos os elementos selecionados
function confirmarVinculo() {
  const guids = [...estado.selecao];
  if (!guids.length || !estado.alvo) return;
  for (const guid of guids) {
    estado.vinculos[guid] = estado.alvo;
    if (estado.assinaturas[guid]) aprender(estado.aprendizado, estado.assinaturas[guid], estado.alvo);
  }
  $('avisoAside').textContent = `${guids.length} elemento(s) associado(s).`;
  for (const btn of ['btnExportarVinc', 'btnExportarAprend', 'btnSugerir']) $(btn).disabled = false;
  renderLista();
  atualizarTempo();
  atualizarPopup();
}
$('esqConfirmar').addEventListener('click', confirmarVinculo);

function atualizarSelecao() {
  for (const m of estado.elementos) {
    m.material.emissive.setHex(estado.selecao.has(m.userData.globalId) ? 0xb37400 : 0x000000);
  }
  const n = estado.selecao.size;
  $('contagemSel').textContent = n ? `${n} elemento(s) selecionado(s).` : 'Nenhum elemento selecionado.';
  $('btnAssociar').disabled = !(n && estado.alvo);
  $('btnRemover').disabled = !n;
  $('btnLimpar').disabled = !n;
}

// ---------- lista de atividades da EAP ----------
function renderLista() {
  const lista = $('lista');
  if (!estado.cron) { lista.innerHTML = ''; return; }
  const termo = $('busca').value.trim().toLowerCase();
  const folhas = estado.cron.tarefas.filter((t) => t.nivel === 2)
    .sort((a, b) => (a.eapCodigo || '').localeCompare(b.eapCodigo || '', undefined, { numeric: true }));
  // quantos elementos já apontam para cada atividade
  const contagem = {};
  for (const atv of Object.values(estado.vinculos)) if (typeof atv === 'string') contagem[atv] = (contagem[atv] || 0) + 1;
  lista.innerHTML = folhas.filter((t) => !termo || (t.nome + ' ' + (t.eapCodigo || '')).toLowerCase().includes(termo))
    .map((t) => `<button type="button" data-id="${t.id}" class="${t.id === estado.alvo ? 'ativo' : ''}">
      ${t.eapCodigo ?? ''} ${t.nome.charAt(0) + t.nome.slice(1).toLowerCase()}
      <span class="v">${contagem[t.id] ? '· ' + contagem[t.id] + ' peça(s)' : ''}</span></button>`).join('');
}
$('busca').addEventListener('input', renderLista);
$('lista').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  estado.alvo = b.dataset.id;
  renderLista();
  atualizarSelecao();
  atualizarPopup();
});

// ---------- associação, remoção e sugestão ----------
$('btnAssociar').addEventListener('click', () => {
  for (const guid of estado.selecao) {
    estado.vinculos[guid] = estado.alvo;
    if (estado.assinaturas[guid]) aprender(estado.aprendizado, estado.assinaturas[guid], estado.alvo);
  }
  $('avisoAside').textContent = `${estado.selecao.size} elemento(s) associado(s).`;
  for (const btn of ['btnExportarVinc', 'btnExportarAprend', 'btnSugerir']) $(btn).disabled = false;
  renderLista();
  atualizarTempo();
});
$('btnRemover').addEventListener('click', () => {
  for (const guid of estado.selecao) delete estado.vinculos[guid];
  $('avisoAside').textContent = `Vínculo removido de ${estado.selecao.size} elemento(s).`;
  renderLista();
  atualizarTempo();
});
$('btnLimpar').addEventListener('click', () => { estado.selecao.clear(); atualizarSelecao(); });
$('btnSugerir').addEventListener('click', () => {
  const sug = sugerir(estado.assinaturas, estado.aprendizado, estado.vinculos);
  Object.assign(estado.vinculos, sug);
  $('avisoAside').textContent = `${Object.keys(sug).length} sugestão(ões) aplicada(s) por semelhança.`;
  renderLista();
  atualizarTempo();
});
function baixar(nome, objeto) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(objeto, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  URL.revokeObjectURL(url);
}
$('btnExportarVinc').addEventListener('click', () => baixar('vinculos.json', {
  _como_usar: 'GlobalId do IFC -> id da atividade no cronograma do Agrega.', ...estado.vinculos,
}));
$('btnExportarAprend').addEventListener('click', () => baixar('aprendizado.json', estado.aprendizado));
$('arquivoAprend').addEventListener('change', async (e) => {
  estado.aprendizado = JSON.parse(await e.target.files[0].text());
  $('avisoAside').textContent = `Aprendizado carregado: ${Object.keys(estado.aprendizado).length} assinatura(s).`;
});

// ---------- dados ----------
function prepararCronograma(json) {
  estado.cron = json;
  estado.tarefasPorId = new Map(json.tarefas.map((t) => [t.id, t]));
  renderLista();
}

function prepararCurva(json) {
  estado.curva = json;
  $('tempo').max = Math.max(json.pontos.length - 1, 0);
  $('tempo').value = Math.max(json.pontos.findIndex((p) => p.data >= estado.hoje), 0);
  $('kTotal').textContent = brl(json.custoTotal);
  desenharCurva();
}

function prepararEtapas(json) {
  estado.pr = json;
  const etapas = json.linhas.filter((l) => l.nivel === 'etapa');
  const maxP = Math.max(0, ...etapas.map((e) => e.custoPrevisto)) || 1;
  $('etapas').innerHTML = etapas.map((e) => {
    const pv = (e.custoPrevisto / maxP * 100).toFixed(1);
    const ex = (e.executado / maxP * 100).toFixed(1);
    const pct = Math.round(e.percentualExecutado ?? 0);
    return `<div class="linhaEtapa">
      <div>${e.codigo} ${e.descricao.charAt(0) + e.descricao.slice(1).toLowerCase()}</div>
      <div style="text-align:right;color:var(--sub);">${brl(e.executado)} / ${brl(e.custoPrevisto)}</div>
      <div style="text-align:right;">${pct}%</div>
      <div class="barra"><div class="p" style="width:${pv}%"></div><div class="e" style="width:${ex}%"></div></div>
    </div>`;
  }).join('');
}

// ---------- curva ----------
function desenharCurva(i = +$('tempo').value) {
  const pontos = estado.curva?.pontos;
  if (!pontos) return;
  const W = 400, H = 240, pl = 52, pr = 10, pt = 10, pb = 28;
  // obra sem custo ou com um só mês: a escala não pode dividir por zero
  const max = Math.ceil(Math.max(0, ...pontos.map((p) => p.previsto)) / 10000) * 10000 || 10000;
  const xi = (j) => pl + (j / Math.max(pontos.length - 1, 1)) * (W - pl - pr);
  const yv = (v) => pt + (1 - v / max) * (H - pt - pb);
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = max / 4 * k;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${yv(v)}" y2="${yv(v)}" stroke="var(--linha)" stroke-width="0.5"/>
      <text x="${pl - 6}" y="${yv(v) + 4}" text-anchor="end" font-size="11" fill="var(--mut)">${Math.round(v / 1000)}k</text>`;
  }
  pontos.forEach((p, j) => {
    if (j % 2 === 0) g += `<text x="${xi(j)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--mut)">${mesBR(p.data)}</text>`;
  });
  const linha = (chave, cor) => {
    const pts = pontos.map((p, j) => [j, p[chave]]).filter(([j, v]) => v !== null && j <= i);
    if (!pts.length) return '';
    return `<polyline fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round" points="${pts.map(([j, v]) => xi(j) + ',' + yv(v)).join(' ')}"/>`;
  };
  g += linha('previsto', '#2a78d6') + linha('executado', '#eb6834') + linha('realizado', '#1baf7a');
  g += `<line x1="${xi(i)}" x2="${xi(i)}" y1="${pt}" y2="${H - pb}" stroke="var(--sub)" stroke-width="1" stroke-dasharray="3 3"/>`;
  $('curva').innerHTML = g;
}

// ---------- tempo: KPIs e cores 4D ----------
function valorAte(chave, i) {
  // último valor conhecido até o índice i (executado só existe até a última medição)
  for (let j = i; j >= 0; j--) {
    const v = estado.curva.pontos[j][chave];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

function atualizarTempo() {
  const i = +$('tempo').value;
  const pontos = estado.curva?.pontos ?? [];
  const p = pontos[i];
  if (p) {
    $('dataLbl').textContent = mesBR(p.data);
    const prev = p.previsto;
    const exec = valorAte('executado', i);
    const ultima = estado.curva.dataUltimaMedicao;
    $('kPrev').textContent = brl(prev);
    $('kPrevS').textContent = 'fim do mês ' + dataBR(p.data);
    $('kExec').textContent = brl(exec);
    $('kExecS').textContent = exec === null ? 'sem medição' : (p.data > ultima ? 'última medição ' + dataBR(ultima) : 'medido até ' + dataBR(p.data));
    $('kDesvio').textContent = exec === null ? '-' : brl(prev - exec);
    desenharCurva(i);
  }
  // 4D: cor de cada peça pela data do mês selecionado
  const data = p ? p.data : estado.hoje;
  const cont = {};
  for (const m of estado.elementos) {
    const r = estado.cron ? corDoElemento(m.userData.globalId, estado.vinculos, estado.tarefasPorId, data, estado.hoje)
      : { cor: COR.SEM_VINCULO, status: null };
    m.material.color.setHex(r.cor);
    const k = r.status ?? 'sem_vinculo';
    cont[k] = (cont[k] || 0) + 1;
  }
  if (estado.elementos.length) {
    $('aviso').textContent = 'Peças: ' + estado.elementos.length + ' · ' + Object.entries(cont).map(([k, v]) => `${k}: ${v}`).join(' · ');
  }
  atualizarPopup();
}

// painéis flutuantes: mostrar/ocultar pela caixa de seleção e arrastar pelo cabeçalho
// ao mostrar um painel, garante que ele caiba dentro da janela
function encaixar(p) {
  const r = p.getBoundingClientRect();
  if (r.right > innerWidth - 8) p.style.left = Math.max(8, innerWidth - r.width - 8) + 'px';
  if (r.bottom > innerHeight - 8) p.style.top = Math.max(8, innerHeight - r.height - 8) + 'px';
}
$('chkCurva').addEventListener('change', (e) => { $('pCurva').hidden = !e.target.checked; if (e.target.checked) encaixar($('pCurva')); });
$('chkEtapas').addEventListener('change', (e) => { $('pEtapas').hidden = !e.target.checked; if (e.target.checked) encaixar($('pEtapas')); });
document.querySelectorAll('.flutuante .cabecalho').forEach((cab) => {
  let arr = null;
  cab.addEventListener('pointerdown', (e) => {
    const p = cab.parentElement;
    const r = p.getBoundingClientRect();
    arr = { dx: e.clientX - r.left, dy: e.clientY - r.top, p };
    cab.setPointerCapture(e.pointerId);
  });
  cab.addEventListener('pointermove', (e) => {
    if (!arr) return;
    const x = Math.min(Math.max(0, e.clientX - arr.dx), innerWidth - 80);
    const y = Math.min(Math.max(0, e.clientY - arr.dy), innerHeight - 40);
    arr.p.style.left = x + 'px';
    arr.p.style.top = y + 'px';
  });
  const soltar = () => { arr = null; };
  cab.addEventListener('pointerup', soltar);
  cab.addEventListener('pointercancel', soltar);
});
$('tempo').addEventListener('input', atualizarTempo);
let timer = null;
$('play').addEventListener('click', () => {
  if (timer) { clearInterval(timer); timer = null; $('play').textContent = 'Reproduzir'; return; }
  $('play').textContent = 'Pausar';
  timer = setInterval(() => {
    const max = +$('tempo').max;
    if (+$('tempo').value >= max) { clearInterval(timer); timer = null; $('play').textContent = 'Reproduzir'; return; }
    $('tempo').value = +$('tempo').value + 1;
    atualizarTempo();
  }, 700);
});

// ---------- entradas ----------
$('arquivoIfc').addEventListener('change', async (e) => {
  $('aviso').textContent = 'Carregando IFC…';
  try {
    await carregarIfc(e.target.files[0]);
  } catch (err) {
    $('aviso').textContent = 'O modelo 3D não abriu: ' + String(err.message ?? err).slice(0, 160);
  }
});
$('arquivoModelo').addEventListener('change', async (e) => {
  if (!e.target.files[0]) return;
  $('aviso').textContent = 'Abrindo o modelo…';
  try {
    await carregarModelo3d(e.target.files[0]);
  } catch (err) {
    $('aviso').textContent = 'O modelo 3D não abriu: ' + String(err.message ?? err).slice(0, 160);
  }
});
$('chkExtras').addEventListener('change', (e) => { if (estado.extras) estado.extras.visible = e.target.checked; });
$('arquivoVinc').addEventListener('change', async (e) => {
  estado.vinculos = JSON.parse(await e.target.files[0].text());
  renderLista();
  atualizarTempo();
});

// ---------- carga inicial (dados reais e exemplo) ----------
async function carregarJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
// Com ?obraId=... (link do botão do Agrega) os dados vêm da API, pela obra escolhida; sem ele, a amostra gravada.
const parametrosLink = new URLSearchParams(location.search);
const obraIdLink = parametrosLink.get('obraId');
(async () => {
  try {
    let cron, curva, pr;
    if (obraIdLink) {
      const dados = await carregarDadosObra({ base: parametrosLink.get('api') || location.origin, obraId: obraIdLink });
      ({ cron, curva, pr } = dados);
      $('subtitulo').textContent = `${dados.obra} · dados da API do Agrega em ${hojeIso()}`;
      $('fonteDados').textContent = 'Cronograma, curva e etapas: API do Agrega (obra escolhida)';
    } else {
      [cron, curva, pr] = await Promise.all([
        carregarJson('data/agrega_obra_leo.json'),
        carregarJson('data/curvaS_leo.json'),
        carregarJson('data/previsto_realizado_leo.json'),
      ]);
      $('subtitulo').textContent = 'CASA LEO&MARCELA · amostra gravada da API do Agrega';
      $('fonteDados').textContent = 'Cronograma, curva e etapas: amostra gravada da API';
    }
    prepararCronograma(cron);
    prepararCurva(curva);
    prepararEtapas(pr);
    atualizarTempo();
  } catch (err) {
    $('aviso').textContent = 'Não foi possível ler os dados: ' + err.message;
    $('subtitulo').textContent = 'Não foi possível carregar a obra';
  }
  try {
    const blob = await (await fetch('data/exemplo_casa.ifc')).blob();
    await carregarIfc(new File([blob], 'exemplo_casa.ifc'));
  } catch (err) {
    // Custos e cronograma seguem na tela; só o 3D fica de fora.
    $('aviso').textContent = 'Os dados foram carregados, mas o modelo 3D não abriu: ' + String(err.message ?? err).slice(0, 160);
  }
})();
