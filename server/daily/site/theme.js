const systemTheme = matchMedia('(prefers-color-scheme: light)');
function applyTheme() {
  const theme = systemTheme.matches ? 'light' : 'dark';
  document.documentElement.dataset.reploidTheme = theme;
  document.body.dataset.poolTheme = theme;
}
applyTheme();
systemTheme.addEventListener('change', applyTheme);
