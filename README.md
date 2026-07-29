# Voxora AI Reader

## ElevenLabs Multilingual v2

The ElevenLabs integration keeps its API key on the Vercel server. Add a private
environment variable named `ELEVENLABS_API_KEY` in Vercel Project Settings, then
redeploy the project. Never put the real key in `.env.example`, the React source,
GitHub, or a browser-side environment variable.

Responsive React PWA за превръщане на потребителски текст в аудио преживяване.

## Стартиране

1. Стартирайте `START-VOXORA.bat`.
2. Отворете адреса, показан в прозореца (обикновено `http://localhost:4173`).

Приложението използва Gemini AI TTS гласовете от school-main: Kore и Leda (женски), Puck, Charon, Fenrir и Orus (мъжки). Нужен е Gemini API ключ, който се пази само в localStorage на устройството. PDF, DOCX и TXT се обработват локално.

Генерираният AI звук се възпроизвежда като 24 kHz WAV и може да се смесва с шестте фонови атмосфери.

## Android и iOS

Voxora включва Capacitor проекти в `android/` и `ios/`.

```bash
pnpm native:sync
pnpm native:android
pnpm native:ios
```

За Android са необходими Android Studio и Java JDK. За iOS са необходими macOS и Xcode.
`native:sync` прави production build и копира актуалните файлове и в двете платформи.
