# Voxora AI Reader

## Администраторски панел и активни слушатели

Панелът **Админ** показва активните слушатели, последната им книга, позиция,
устройство и история. От него може да се спира и възстановява достъпът на
конкретно устройство.

1. Във Vercel отвори **Marketplace**, добави **Upstash Redis** към проекта и
   разреши автоматичното добавяне на environment variables.
2. В **Project Settings → Environment Variables** добави:
   `VOXORA_ADMIN_PASSWORD` и `VOXORA_ADMIN_SECRET`.
3. Преразгърни проекта.

Поддържат се автоматично добавените имена `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN`, както и старите `KV_REST_API_URL` /
`KV_REST_API_TOKEN`. Паролата и Redis ключовете никога не се изпращат в
браузърния bundle. Активен слушател е устройство, което възпроизвежда и е
изпратило сигнал през последните 45 секунди.

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
