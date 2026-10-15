const SITE_THEMES = Object.freeze([
  'canopy', 'clay', 'coastal', 'editorial', 'neat', 'launcher', 'air', 'brivon-dark', 'brivon-light'
]);

function normalizeSiteTheme(theme, generatedTheme) {
  const selectedTheme = SITE_THEMES.includes(theme) ? theme : generatedTheme;
  const isBrivonPackage = String(generatedTheme || '').startsWith('brivon-');
  return selectedTheme.startsWith('brivon-') === isBrivonPackage ? selectedTheme : generatedTheme;
}

function packageThemeClass(theme) {
  return SITE_THEMES.includes(theme) ? `theme-${theme}` : 'theme-canopy';
}

export { normalizeSiteTheme, packageThemeClass, SITE_THEMES };
