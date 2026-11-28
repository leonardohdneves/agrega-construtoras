// Código da página, em arquivo próprio (a política de segurança do Agrega não aceita script inline).
import * as THREE from './vendor/three/build/three.module.js';
import { OrbitControls } from './vendor/three/examples/jsm/controls/OrbitControls.js';
import { lerGeometriaIfc } from './agrega/ifc-servidor.js';
import { intervaloDaObra, diasUteis, corDoElemento, COR } from './cronograma.js';
import { classificar } from './classificacao_geometrica.js';
import { assinatura, aprender, sugerir } from './reconhecimento.js';

const ui = {
  slider: document.getElementById('slider'),
  data: document.getElementById('data'),
  play: document.getElementById('play'),
  status: document.getElementById('status'),
};

// --- cena ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.getElementById('cena').appendChild(renderer.domElement);
const cena = new THREE.Scene();
cena.background = new THREE.Color(0xf5f5f2);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 5000);
camera.position.set(40, 40, 40);
const controles = new OrbitControls(camera, renderer.domElement);
cena.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.2));
const sol = new THREE.DirectionalLight(0xffffff, 1.5);
sol.position.set(50, 100, 50);
cena.add(sol);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
(function loop() { requestAnimationFrame(loop); controles.update(); renderer.render(cena, camera); })();

// --- estado ---
// IFC é Z para cima; three.js é Y para cima. Rotação de −90° em X mantém o modelo de pé.
const grupoModelo = new THREE.Group();
grupoModelo.rotation.x = -Math.PI / 2;
cena.add(grupoModelo);

const estado = {
  elementos: [], tarefasPorId: new Map(), vinculos: {}, dias: [], hoje: new Date().toISOString().slice(0, 10),
  porGuid: new Map(),      // GlobalId -> [meshes] (um elemento pode ter várias peças)
  assinaturas: {},         // GlobalId -> assinatura (classe + dimensões)
  aprendizado: {},         // assinatura -> { atividadeId: contagem }
  selecao: new Set(),      // GlobalIds selecionados
};

// expõe o estado para depuração no console (window.viewer4d.estado)
window.viewer4d = { estado, atualizarSelecao: () => atualizarSelecao() };

// --- seleção por clique ---
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

function atualizarSelecao() {
  for (const m of estado.elementos) {
    m.material.emissive.setHex(estado.selecao.has(m.userData.globalId) ? 0x553300 : 0x000000);
  }
  const n = estado.selecao.size;
  document.getElementById('contagemSel').textContent = n
    ? `${n} elemento(s) selecionado(s).` : 'Nenhum elemento selecionado.';
  const temCron = estado.tarefasPorId.size > 0;
  document.getElementById('btnAssociar').disabled = !(n && temCron);
  document.getElementById('btnRemover').disabled = !n;
  document.getElementById('btnLimpar').disabled = !n;
}

function aviso(texto) { document.getElementById('aviso').textContent = texto; }

// classe e assinatura de cada elemento, a partir da caixa do mundo
function calcularAssinaturas() {
  estado.assinaturas = {};
  for (const [guid, meshes] of estado.porGuid) {
    const caixa = new THREE.Box3();
    for (const m of meshes) caixa.union(new THREE.Box3().setFromObject(m));
    if (caixa.isEmpty()) continue;
    const t = caixa.getSize(new THREE.Vector3());
    const dados = { dx: t.x, dy: t.z, dz: t.y }; // IFC: Z é a altura; three.js usa Y para cima
    const classe = classificar(dados);
    estado.assinaturas[guid] = assinatura({ classe, ...dados });
  }
}

// --- IFC -> three.js (o Agrega lê o IFC no servidor; cada peça guarda o GlobalId do elemento) ---
async function carregarIfc(arquivo) {
  const base = new URLSearchParams(location.search).get('api') || location.origin;
  const { pecas } = await lerGeometriaIfc({ base, dados: new Uint8Array(await arquivo.arrayBuffer()) });
  for (const p of pecas) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(p.nor, 3));
    geo.setIndex(new THREE.BufferAttribute(p.idx, 1));
    const mat = new THREE.MeshLambertMaterial({ color: COR.SEM_VINCULO, transparent: true, opacity: 0.95 });
    const m = new THREE.Mesh(geo, mat);
    m.applyMatrix4(new THREE.Matrix4().fromArray(p.matriz));
    m.userData.globalId = p.guid;
    grupoModelo.add(m);
    estado.elementos.push(m);
    if (!estado.porGuid.has(p.guid)) estado.porGuid.set(p.guid, []);
    estado.porGuid.get(p.guid).push(m);
  }
  calcularAssinaturas();
  const caixa = new THREE.Box3().setFromObject(grupoModelo);
  if (!caixa.isEmpty()) controles.target.copy(caixa.getCenter(new THREE.Vector3()));
}

// --- cronograma e vínculos ---
function prepararCronograma(json) {
  estado.tarefasPorId = new Map(json.tarefas.map((t) => [t.id, t]));
  const { inicio, fim } = intervaloDaObra(json.tarefas);
  estado.dias = diasUteis(inicio, fim);
  ui.slider.max = Math.max(estado.dias.length - 1, 0);
  ui.slider.value = 0;
  // lista de atividades folha para associar (ordenadas pela EAP)
  const select = document.getElementById('atividade');
  const folhas = json.tarefas.filter((t) => t.nivel === 2).sort((a, b) => (a.eapCodigo || '').localeCompare(b.eapCodigo || '', undefined, { numeric: true }));
  select.innerHTML = folhas.map((t) => `<option value="${t.id}">${t.eapCodigo ?? ''} ${t.nome}</option>`).join('');
  select.disabled = false;
  for (const id of ['btnExportarVinc', 'btnExportarAprend', 'btnSugerir']) document.getElementById(id).disabled = false;
  atualizarSelecao();
}

// --- associação, remoção e sugestão ---
document.getElementById('btnAssociar').addEventListener('click', () => {
  const atividade = document.getElementById('atividade').value;
  for (const guid of estado.selecao) {
    estado.vinculos[guid] = atividade;
    if (estado.assinaturas[guid]) aprender(estado.aprendizado, estado.assinaturas[guid], atividade);
  }
  aviso(`${estado.selecao.size} elemento(s) associado(s) à atividade.`);
  atualizarData(+ui.slider.value);
});
document.getElementById('btnRemover').addEventListener('click', () => {
  for (const guid of estado.selecao) delete estado.vinculos[guid];
  aviso(`Vínculo removido de ${estado.selecao.size} elemento(s).`);
  atualizarData(+ui.slider.value);
});
document.getElementById('btnLimpar').addEventListener('click', () => { estado.selecao.clear(); atualizarSelecao(); });
document.getElementById('btnSugerir').addEventListener('click', () => {
  const sugestoes = sugerir(estado.assinaturas, estado.aprendizado, estado.vinculos);
  Object.assign(estado.vinculos, sugestoes);
  aviso(`${Object.keys(sugestoes).length} sugestão(ões) aplicada(s) por semelhança.`);
  atualizarData(+ui.slider.value);
});

function baixar(nome, objeto) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(objeto, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  URL.revokeObjectURL(url);
}
document.getElementById('btnExportarVinc').addEventListener('click', () => baixar('vinculos.json', {
  _como_usar: 'GlobalId do IFC -> id da atividade no cronograma do Agrega.', ...estado.vinculos,
}));
document.getElementById('btnExportarAprend').addEventListener('click', () => baixar('aprendizado.json', estado.aprendizado));
document.getElementById('arquivoAprend').addEventListener('change', async (e) => {
  estado.aprendizado = JSON.parse(await e.target.files[0].text());
  aviso(`Aprendizado carregado: ${Object.keys(estado.aprendizado).length} assinatura(s).`);
});

// --- atualização da cena para a data escolhida ---
function atualizarData(i) {
  const data = estado.dias[i];
  if (!data) return;
  ui.data.textContent = data.split('-').reverse().join('/');
  const contagem = {};
  for (const m of estado.elementos) {
    const r = corDoElemento(m.userData.globalId, estado.vinculos, estado.tarefasPorId, data, estado.hoje);
    m.material.color.setHex(r.cor);
    const chave = r.status ?? 'sem_vinculo';
    contagem[chave] = (contagem[chave] || 0) + 1;
  }
  ui.status.textContent = `Peças: ${estado.elementos.length} · ` + Object.entries(contagem).map(([k, v]) => `${k}: ${v}`).join(' · ');
}

ui.slider.addEventListener('input', () => atualizarData(+ui.slider.value));

let timer = null;
ui.play.addEventListener('click', () => {
  if (timer) { clearInterval(timer); timer = null; ui.play.textContent = '▶ Reproduzir'; return; }
  ui.play.textContent = '❚❚ Pausar';
  timer = setInterval(() => {
    const prox = +ui.slider.value + 1;
    if (prox > +ui.slider.max) { clearInterval(timer); timer = null; ui.play.textContent = '▶ Reproduzir'; return; }
    ui.slider.value = prox;
    atualizarData(prox);
  }, 300);
});

// --- entradas de arquivo (o IFC vai ao servidor do Agrega para ser lido; não fica gravado) ---
document.getElementById('arquivoIfc').addEventListener('change', async (e) => {
  ui.status.textContent = 'Carregando IFC…';
  estado.porGuid = new Map();
  estado.elementos.forEach((m) => grupoModelo.remove(m));
  estado.elementos = [];
  try {
    await carregarIfc(e.target.files[0]);
    ui.status.textContent = `IFC carregado (${estado.elementos.length} peças).`;
    if (estado.dias.length) atualizarData(+ui.slider.value);
  } catch (err) {
    ui.status.textContent = String(err.message ?? err);
  }
});
document.getElementById('arquivoCron').addEventListener('change', async (e) => {
  prepararCronograma(JSON.parse(await e.target.files[0].text()));
  atualizarData(0);
});
document.getElementById('arquivoVinc').addEventListener('change', async (e) => {
  estado.vinculos = JSON.parse(await e.target.files[0].text());
  atualizarData(+ui.slider.value);
});
// --- abertura por link: ?obraId=...&api=https://... lê o planejamento da obra no Agrega ---
import { buscarCronogramaDaObra } from './agrega/planejamento.js';
const parametros = new URLSearchParams(location.search);
const obraIdLink = parametros.get('obraId');
if (obraIdLink) {
  const apiBase = parametros.get('api') || location.origin;
  ui.status.textContent = 'Lendo o cronograma da obra no Agrega…';
  buscarCronogramaDaObra({ base: apiBase, obraId: obraIdLink })
    .then(({ tarefas }) => {
      if (!tarefas.length) throw new Error('A obra não tem atividades com datas no planejamento.');
      prepararCronograma({ tarefas });
      ui.status.textContent = `Cronograma da obra carregado: ${tarefas.length} linhas. Carregue o IFC para ver o modelo.`;
    })
    .catch((e) => { ui.status.textContent = e.message; });
}
