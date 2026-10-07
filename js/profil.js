// js/profil.js
// Menampilkan akun yang sedang masuk dan memasang tombol Logout.
// Ganti role lewat halaman ini sudah dihapus; pindah role lewat Logout (#login).

function initProfilPage() {
  const root = document.querySelector('.profil');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  const user = getCurrentUser();
  if (!user) return;

  root.querySelector('[data-user-name]').textContent = user.name;
  root.querySelector('[data-user-username]').textContent = user.username ? `@${user.username}` : 'Tanpa akun';
  root.querySelector('[data-role-value]').textContent = getRoleLabel();
  // Ambil dari getRoleLabel() supaya PJ tampil sebagai PJ, bukan Mahasiswa.
  root.querySelector('[data-account-state]').textContent = getRoleLabel();

  root.querySelector('[data-logout]').addEventListener('click', () => {
    logout();
    window.location.hash = '#login';
  });
}

window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
window.STUDENTHUB_PAGES.profil = { init: initProfilPage };