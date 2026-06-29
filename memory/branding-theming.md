---
name: branding-theming
description: CampusFix rebrand, green brand color, and how theming/i18n are wired across app + web
metadata:
  type: project
---

El producte es diu **CampusFix** (abans CityFix). El rename és només a text visible i config display (app.json `name`, index.html title, UI). Els identificadors tècnics es mantenen com `cityfix`: slug `cityfix-mobile`, scheme `cityfix`, bundleId `com.cityfix.campus`, TOKEN_KEY `cityfix_token`, package.json name — NO canviar per no trencar EAS/sessions.

Color de marca: **verd bosc green-700 `#15803d`** (alineat amb el logo `files/logoUAB.png`, ara a `app/assets/*` i `frontend/src/assets/logo.png`).

**Web (Tailwind v4):** el lila era `indigo-*`. En lloc de tocar ~25 fitxers, a `frontend/src/index.css` es **remapa la paleta `--color-indigo-*` a verd dins `@theme`** + `@custom-variant dark (&:where(.dark,.dark *))`. Tema gestionat per `frontend/src/context/ThemeContext.tsx` (light/dark/system, persisteix a localStorage `campusfix_theme`, alterna `.dark` a <html>).

**App (NativeWind):** paleta `brand` a `app/tailwind.config.js` és verd; hex hardcodejats substituïts per `#15803d`. Tema via `app/src/context/ThemeContext.tsx` (usa `useColorScheme` de nativewind, persisteix `campusfix_theme` a AsyncStorage). `userInterfaceStyle: automatic` a app.json.

**i18n** (ca/es/en): web `frontend/src/i18n/index.ts` (i18next + LanguageDetector, localStorage `campusfix_lang`); app `app/src/i18n/index.ts` (expo-localization per detecció, AsyncStorage). Selector a les pàgines de Settings.

**Limitació coneguda:** el mode fosc està estilitzat completament al shell + Login + Settings (web) i Settings + tab bar (app). La resta de pantalles segueixen amb targetes clares (text llegible però no tematitzades). Cal afegir variants `dark:` a Dashboard/Reports/etc. per completar-lo.
