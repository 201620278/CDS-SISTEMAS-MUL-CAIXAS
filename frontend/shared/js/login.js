const API_URL = (() => {
  if (typeof window.API_URL === 'string' && window.API_URL.trim() !== '') {
    return window.API_URL;
  }

  const resolved = `${window.location.origin}/api`;
  window.API_URL = resolved;
  return resolved;
})();

(function redirectIfLoggedIn() {
  const token = localStorage.getItem('token');
  if (!token) return;

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch (e) {
      return {};
    }
  })();

  const destino = typeof obterDestinoPosLogin === 'function'
    ? obterDestinoPosLogin(user)
    : '/erp';

  window.location.replace(destino);
})();

$('#loginForm').on('submit', function(e) {
  e.preventDefault();
  const username = $('#username').val().trim();
  const password = $('#password').val();
  const $err = $('#login-error');
  const $btn = $('#btn-entrar');

  $err.addClass('d-none').text('');
  $btn.prop('disabled', true);

  $.ajax({
    url: `${API_URL}/auth/login`,
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ username, password }),
    success: function(data) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      const destino = typeof obterDestinoPosLogin === 'function'
        ? obterDestinoPosLogin(data.user)
        : '/erp';

      window.location.replace(destino);
    },
    error: function(xhr) {
      const msg = xhr.responseJSON && xhr.responseJSON.error
        ? xhr.responseJSON.error
        : 'Não foi possível entrar. Verifique o servidor.';
      $err.removeClass('d-none').text(msg);
    },
    complete: function() {
      $btn.prop('disabled', false);
    }
  });
});

$(document).ready(function() {
  $('.modal-backdrop').remove();
  $('body').removeClass('modal-open').css('overflow', '').css('padding-right', '');
  document.body.classList.remove('pdv-mode', 'menu-open');
  $('*').css('pointer-events', '');
  $('body, html').css('pointer-events', 'auto');

  const campoUsername = $('#username');
  if (campoUsername.length > 0 && !$('#password').is(':focus')) {
    campoUsername[0].focus();
  }

  setTimeout(() => {
    if (window.electronAPI && window.electronAPI.forcarReflow) {
      window.electronAPI.forcarReflow();
    }
  }, 100);
});
