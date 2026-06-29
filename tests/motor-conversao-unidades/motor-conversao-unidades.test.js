/**
 * Testes automatizados — Motor de Conversão de Unidades (PARTE 25.11)
 * Executar: npm run test:conversao-unidades
 */
const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const motor = require('../../backend/lib/motorConversaoUnidades');
const { distribuirQuantidadeVenda } = require('../../backend/services/distribuidorEstoqueVenda');
const {
  calcularDevolucaoCompraFiscalPrimeiro,
  resolverQuantidadesCompraItemPersistido
} = require('../../backend/services/estoqueFiscalService');
const {
  validarItemComercialConversaoUnidadesFiscal,
  normalizarUnidadeComercialFiscal
} = require('../../backend/services/fiscal/unidadeFiscal');
const { executarMigracaoConversaoUnidades } = require('../../backend/services/migracaoConversaoUnidades');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function criarDbMemoria() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(`
          CREATE TABLE produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT,
            vendido_por_peso INTEGER DEFAULT 0,
            produto_fracionado INTEGER DEFAULT 0,
            peso_total_compra REAL DEFAULT 0,
            custo_por_kg REAL DEFAULT 0,
            preco_compra REAL DEFAULT 0,
            preco_venda REAL DEFAULT 0
          )
        `);
        db.run(`
          CREATE TABLE compras_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            produto_id INTEGER,
            vendido_por_peso INTEGER DEFAULT 0
          )
        `, (err2) => {
          if (err2) return reject(err2);
          resolve(db);
        });
      });
    });
  });
}

function fecharDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

async function run() {
  console.log('=== TESTES — MOTOR DE CONVERSÃO DE UNIDADES (25.11) ===\n');

  await test('Compra de rolo — 10 × 50 MT = 500 MT', () => {
    const item = motor.montarItemCompraConversaoUnidades({
      compra_em: 'Rolo',
      quantidade_embalagens: 10,
      quantidade_por_embalagem: 50,
      valor_total_embalagem: 566.7,
      quantidade_fiscal: 500,
      unidade: 'MT'
    });
    assert.strictEqual(item.quantidade, 500);
    assert.strictEqual(item.preco_unitario, 1.1334);
    assert.strictEqual(item.subtotal, 566.7);
    assert.strictEqual(motor.validarDistribuicaoConversaoUnidadesItem(item), null);
  });

  await test('Compra de bobina — 2 × 100 MT', () => {
    const item = motor.montarItemCompraConversaoUnidades({
      compra_em: 'Bobina',
      quantidade_embalagens: 2,
      quantidade_por_embalagem: 100,
      valor_total_embalagem: 226.68,
      quantidade_fiscal: 200,
      unidade: 'MT'
    });
    assert.strictEqual(item.quantidade, 200);
    assert.strictEqual(item.preco_unitario, 1.1334);
    assert.strictEqual(item.subtotal, 226.68);
  });

  await test('Compra de galão — 5 × 20 LT = 100 LT', () => {
    const item = motor.montarItemCompraConversaoUnidades({
      compra_em: 'Galão',
      quantidade_embalagens: 5,
      quantidade_por_embalagem: 20,
      valor_total_embalagem: 150,
      quantidade_fiscal: 100,
      quantidade_nao_fiscal: 0,
      unidade: 'LT'
    });
    assert.strictEqual(item.quantidade, 100);
    assert.strictEqual(item.preco_unitario, 1.5);
    assert.strictEqual(item.subtotal, 150);
    assert.strictEqual(motor.validarDistribuicaoConversaoUnidadesItem(item), null);

    const incompleto = { ...item, quantidade_fiscal: 60, quantidade_nao_fiscal: 0 };
    assert.ok(motor.validarDistribuicaoConversaoUnidadesItem(incompleto) !== null);

    const misto = { ...item, quantidade_fiscal: 60, quantidade_nao_fiscal: 40 };
    assert.strictEqual(motor.validarDistribuicaoConversaoUnidadesItem(misto), null);
    assert.strictEqual(motor.calcularSubtotalFinanceiroItemCompra(misto), 150);
  });

  await test('Compra de saco — 20 × 25 KG (legado)', () => {
    const item = motor.montarItemCompraConversaoUnidades({
      compra_em: 'Saco',
      quantidade_embalagens: 20,
      quantidade_por_embalagem: 25,
      valor_total_embalagem: 500,
      quantidade_fiscal: 500,
      unidade: 'KG'
    });
    assert.strictEqual(item.quantidade, 500);
    assert.strictEqual(item.preco_unitario, 1);
    assert.strictEqual(item.subtotal, 500);
  });

  await test('Compra mista Fiscal/Não Fiscal — 300 + 200 = 500', () => {
    const item = {
      produto_fracionado: 1,
      quantidade_embalagens: 10,
      quantidade_por_embalagem: 50,
      valor_total_embalagem: 566.7,
      quantidade_fiscal: 300,
      quantidade_nao_fiscal: 200,
      preco_unitario: 1.1334
    };
    assert.strictEqual(motor.validarDistribuicaoConversaoUnidadesItem(item), null);
    const estoque = motor.resolverQuantidadesEstoqueCompraItem(item);
    assert.strictEqual(estoque.quantidade_fiscal, 300);
    assert.strictEqual(estoque.quantidade_nao_fiscal, 200);
    assert.strictEqual(estoque.quantidade, 500);
  });

  await test('Venda não fiscal — consome estoque não fiscal primeiro', () => {
    const venda = distribuirQuantidadeVenda(7.25, 300, 200, false);
    assert.strictEqual(venda.sucesso, true);
    assert.strictEqual(venda.quantidadeNaoFiscal, 7.25);
    assert.strictEqual(venda.quantidadeFiscal, 0);
  });

  await test('Venda fiscal — consome estoque fiscal primeiro', () => {
    const venda = distribuirQuantidadeVenda(7.25, 300, 200, true);
    assert.strictEqual(venda.sucesso, true);
    assert.strictEqual(venda.quantidadeFiscal, 7.25);
    assert.strictEqual(venda.quantidadeNaoFiscal, 0);
  });

  await test('Venda parcial — 7,25 MT de 500 MT em estoque', () => {
    const venda = distribuirQuantidadeVenda(7.25, 300, 200);
    assert.strictEqual(venda.sucesso, true);
    assert.strictEqual(venda.quantidadeFiscal, 7.25);
    assert.strictEqual(venda.quantidadeNaoFiscal, 0);
    const valorFiscal = motor.moeda(venda.quantidadeFiscal * 2.5);
    assert.strictEqual(valorFiscal, 18.13);
  });

  await test('Venda decimal — quantidade com 3 casas decimais', () => {
    assert.strictEqual(motor.custoUnitarioVenda(3.8), 3.8);
    assert.strictEqual(motor.custoUnitarioVenda(1.35), 1.35);
    const venda = distribuirQuantidadeVenda(3.8, 10, 5);
    assert.strictEqual(venda.sucesso, true);
    assert.strictEqual(venda.quantidadeFiscal, 3.8);
  });

  await test('Cancelamento — estoque da compra igual à quantidade convertida', () => {
    const item = motor.montarItemCompraConversaoUnidades({
      compra_em: 'Rolo',
      quantidade_embalagens: 1,
      quantidade_por_embalagem: 50,
      valor_total_embalagem: 56.67,
      quantidade_fiscal: 50,
      unidade: 'MT'
    });
    const quantidadeBaixar = motor.resolverQuantidadesEstoqueCompraItem(item).quantidade;
    assert.strictEqual(quantidadeBaixar, 50);
    assert.ok(item.quantidade >= quantidadeBaixar);
  });

  await test('Devolução — 7,25 MT fiscal primeiro', () => {
    const itemCompra = {
      quantidade: 500,
      quantidade_fiscal: 300,
      quantidade_nao_fiscal: 200,
      item_fiscal: 1
    };
    const qtds = resolverQuantidadesCompraItemPersistido(itemCompra);
    const dev = calcularDevolucaoCompraFiscalPrimeiro(itemCompra, 7.25, { fiscal: 0, nao_fiscal: 0 });
    assert.strictEqual(dev.qtdFiscal, 7.25);
    assert.strictEqual(dev.qtdNaoFiscal, 0);
    assert.strictEqual(dev.qtdTotal, 7.25);
    assert.strictEqual(qtds.quantidade_fiscal + qtds.quantidade_nao_fiscal, 500);
  });

  await test('NFC-e — uCom/qCom/vUnCom para conversão de unidades MT', () => {
    assert.strictEqual(normalizarUnidadeComercialFiscal('mt'), 'MT');
    const erros = validarItemComercialConversaoUnidadesFiscal({
      produto_fracionado: 1,
      unidade: 'MT',
      produto_nome: 'Tecido',
      quantidade_fiscal: 7.25,
      valor_fiscal: 18.13,
      preco_unitario: 2.5
    });
    assert.strictEqual(erros.length, 0);
  });

  await test('Migração — vendido_por_peso → produto_fracionado sem perder dados', async () => {
    const db = await criarDbMemoria();
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO produtos (nome, vendido_por_peso, peso_total_compra, custo_por_kg, preco_compra)
           VALUES ('Arame legado', 1, 500, 1.1334, 1.1334)`,
          (err) => (err ? reject(err) : resolve())
        );
      });

      const stats = await executarMigracaoConversaoUnidades(db);
      assert.strictEqual(stats.migradosParaFracionado, 1);

      const produto = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM produtos WHERE id = 1', (err, row) => (err ? reject(err) : resolve(row)));
      });

      assert.strictEqual(produto.vendido_por_peso, 1);
      assert.strictEqual(produto.produto_fracionado, 1);
      assert.strictEqual(produto.peso_total_compra, 500);
      assert.strictEqual(produto.custo_por_kg, 1.1334);
      assert.strictEqual(produto.preco_compra, 1.1334);

      const stats2 = await executarMigracaoConversaoUnidades(db);
      assert.strictEqual(stats2.migradosParaFracionado, 0);
    } finally {
      await fecharDb(db);
    }
  });

  await test('Custo unitário produto cadastro — corrige valor de embalagem legado', () => {
    const legado = {
      produto_fracionado: 1,
      preco_compra: 56.67,
      valor_total_compra: 56.67,
      peso_total_compra: 50,
      custo_por_kg: 1.1334
    };
    assert.strictEqual(motor.resolverCustoUnitarioProdutoCadastro(legado), 1.1334);

    const semLegado = {
      produto_fracionado: 1,
      preco_compra: 56.67,
      peso_total_compra: 50
    };
    assert.strictEqual(motor.resolverCustoUnitarioProdutoCadastro(semLegado), 1.1334);

    const calculoUsuario = motor.simularConversaoEmbalagem({
      qtdEmbalagens: 1,
      qtdPorEmbalagem: 50,
      valorTotal: 50.67
    });
    assert.strictEqual(calculoUsuario.custoUnitario, 1.0134);
  });

  await test('Aliases legados — produtoEhFracionado e montarItemCompraFracionado', () => {
    assert.strictEqual(motor.produtoUsaConversaoUnidades({ vendido_por_peso: 1 }), true);
    assert.strictEqual(motor.produtoEhFracionado({ produto_fracionado: 1 }), true);
    assert.strictEqual(motor.itemCompraEhFracionado({ vendido_por_peso: 1 }), true);
    const viaAlias = motor.montarItemCompraFracionado({
      quantidade_embalagens: 1,
      quantidade_por_embalagem: 10,
      valor_total_embalagem: 10,
      quantidade_fiscal: 10
    });
    assert.strictEqual(viaAlias.quantidade, 10);
  });

  console.log(`\n=== RESULTADO: ${passou} OK, ${falhou} FALHOU ===\n`);
  if (falhou > 0) {
    process.exitCode = 1;
  }
}

run();
