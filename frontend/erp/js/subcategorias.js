// Módulo de subcategorias - CRUD e integração
if (!window.subcategoriasAPI) {
const subcategoriasAPI = {
  listar: function() {
    return $.ajax({
      url: API_URL + '/subcategorias',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  listarPorCategoria: function(categoria_id) {
    return $.ajax({
      url: API_URL + '/subcategorias/categoria/' + categoria_id,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  criar: function(dados) {
    return $.ajax({
      url: API_URL + '/subcategorias',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  atualizar: function(id, dados) {
    return $.ajax({
      url: API_URL + '/subcategorias/' + id,
      method: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify(dados),
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  },
  excluir: function(id) {
    return $.ajax({
      url: API_URL + '/subcategorias/' + id,
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
  }
};

// Exportar globalmente
window.subcategoriasAPI = subcategoriasAPI;
}
