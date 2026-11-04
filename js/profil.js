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

  // Preferensi Tema
  const themeLabel = root.querySelector('[data-theme-label]');
  const updateThemeLabel = () => {
    if (!themeLabel) return;
    const isDark = (document.documentElement.getAttribute('data-theme') === 'dark');
    themeLabel.textContent = 'Tema saat ini: ' + (isDark ? 'Gelap (Dark Mode)' : 'Terang (Light Mode)');
  };
  updateThemeLabel();

  const themeBtn = root.querySelector('[data-profile-theme-toggle]');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      if (typeof window.shToggleTheme === 'function') {
        window.shToggleTheme();
        updateThemeLabel();
      }
    });
  }

  // Preferensi Notifikasi Browser
  const notifBtn = root.querySelector('[data-profile-notif-toggle]');
  const notifStatus = root.querySelector('[data-notif-status-text]');
  const updateNotifStatus = () => {
    if (!('Notification' in window)) {
      if (notifStatus) notifStatus.textContent = 'Browser tidak mendukung notifikasi.';
      if (notifBtn) notifBtn.disabled = true;
      return;
    }
    if (Notification.permission === 'granted') {
      if (notifStatus) notifStatus.textContent = '✓ Pengingat aktif (H-1 & kuliah)';
      if (notifBtn) {
        notifBtn.textContent = '✓ Aktif';
        notifBtn.disabled = true;
      }
    } else if (Notification.permission === 'denied') {
      if (notifStatus) notifStatus.textContent = 'Notifikasi diblokir di setelan browser.';
      if (notifBtn) notifBtn.disabled = true;
    } else {
      if (notifStatus) notifStatus.textContent = 'Klik untuk aktifkan pengingat.';
      if (notifBtn) notifBtn.textContent = '🔔 Aktifkan';
    }
  };
  updateNotifStatus();

  if (notifBtn) {
    notifBtn.addEventListener('click', () => {
      if ('Notification' in window && typeof window.shRequestNotificationPermission === 'function') {
        window.shRequestNotificationPermission().then(() => {
          updateNotifStatus();
        });
      }
    });
  }
}

window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
window.STUDENTHUB_PAGES.profil = { init: initProfilPage };