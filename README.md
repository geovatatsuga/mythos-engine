<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Mythos Engine

Repositorio principal e backup operacional do Mythos Engine.

Aplicacao React + Vite preparada para deploy no Vercel.

## Rodar localmente

Pre-requisito: Node.js 20+

1. Instale as dependencias com `npm install`
2. Inicie com `npm run dev`
3. Abra a landing page e salve as API keys do usuario
4. O engine so libera a inicializacao depois que as chaves forem salvas localmente no navegador

## Deploy no Vercel

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`

Nao e necessario configurar API keys do app nas variaveis de ambiente do Vercel para o fluxo atual, porque cada usuario salva as proprias chaves no navegador.

## Observacoes

- Os modelos default continuam configurados em build via `vite.config.ts`
- O build atual conclui com sucesso
- Ainda existe um aviso de bundle grande no Vite, mas isso nao bloqueia o deploy
