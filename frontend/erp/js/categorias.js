const categoriasAPI = {
  listar: function(tipo = '') {
    const query = tipo ? `?tipo=${encodeURIComponent(tipo)}` : '';
    return $.ajax({
      url: API_URL + '/categorias' + query,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },

  buscar: function(id) {
    return $.ajax({
      url: API_URL + '/categorias/' + id,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },

  criar: function(dados) {
    return $.ajax({
      url: API_URL + '/categorias',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },

  atualizar: function(id, dados) {
    return $.ajax({
      url: API_URL + '/categorias/' + id,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },

  excluir: function(id) {
    return $.ajax({
      url: API_URL + '/categorias/' + id,
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  }
};

function textoTipoCategoria(tipo) {
  return tipo === 'despesa' ? 'Despesa' : 'Produto';
}

function loadCategorias() {
  const tipoFiltro = $('#filtro-tipo-categoria').val();
  categoriasAPI.listar(tipoFiltro).done(function(categorias) {
    let html = '';

    categorias.forEach(cat => {
      html += `
        <tr>
          <td>${cat.id}</td>
          <td>${cat.nome}</td>
          <td>${textoTipoCategoria(cat.tipo)}</td>
          <td>${cat.descricao || ''}</td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="editarCategoria(${cat.id})">Editar</button>
            <button class="btn btn-sm btn-danger" onclick="excluirCategoria(${cat.id})">Excluir</button>
          </td>
        </tr>
      `;
    });

    $('#categorias-tbody').html(html);
  });
}

function criarCategoria() {
  const nome = $('#categoria-nome').val().trim();
  const descricao = $('#categoria-descricao').val().trim();
  const tipo = $('#categoria-tipo').val();

  if (!nome) {
    alert('Nome é obrigatório!');
    return;
  }

  categoriasAPI.criar({ nome, descricao, tipo }).done(() => {
    limparFormularioCategoria();
    loadCategorias();

    $('#modal-categoria').modal('hide');

    if (typeof atualizarSelectCategoriasSubcategoria === 'function') {
      atualizarSelectCategoriasSubcategoria();
    }
  }).fail(err => {
    alert('Erro ao criar categoria: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function editarCategoria(id) {
  categoriasAPI.buscar(id).done(cat => {
    $('#categoria-id').val(cat.id);
    $('#categoria-nome').val(cat.nome);
    $('#categoria-descricao').val(cat.descricao || '');
    $('#categoria-tipo').val(cat.tipo || 'produto');
    $('#modal-categoria').modal('show');
  });
}

function salvarCategoria() {
  const id = $('#categoria-id').val();
  const nome = $('#categoria-nome').val().trim();
  const descricao = $('#categoria-descricao').val().trim();
  const tipo = $('#categoria-tipo').val();

  if (!nome) {
    alert('Nome é obrigatório!');
    return;
  }

  categoriasAPI.atualizar(id, { nome, descricao, tipo }).done(() => {
    limparFormularioCategoria();
    $('#modal-categoria').modal('hide');
    loadCategorias();

    if (typeof atualizarSelectCategoriasSubcategoria === 'function') {
      atualizarSelectCategoriasSubcategoria();
    }
  }).fail(err => {
    alert('Erro ao atualizar categoria: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function excluirCategoria(id) {
  if (!confirm('Deseja realmente excluir esta categoria?')) return;

  categoriasAPI.excluir(id).done(() => {
    loadCategorias();
  }).fail(err => {
    alert('Erro ao excluir categoria: ' + (err.responseJSON?.erro || err.statusText));
  });
}

function limparFormularioCategoria() {
  $('#categoria-id').val('');
  $('#categoria-nome').val('');
  $('#categoria-descricao').val('');
  $('#categoria-tipo').val('produto');
}

window.loadCategorias = loadCategorias;
window.criarCategoria = criarCategoria;
window.editarCategoria = editarCategoria;
window.salvarCategoria = salvarCategoria;
window.excluirCategoria = excluirCategoria;
window.categoriasAPI = categoriasAPI;