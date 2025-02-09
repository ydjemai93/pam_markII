# pam_markII

Ce projet Node.js gère un flux Twilio Media Streams, en exploitant **OpenAI** pour :
- STT (Whisper ou Realtime STT),
- LLM (GPT),
- TTS (voix OpenAI, si disponible, ou tout autre TTS).

Ce code sert de "micro-serveur" pour votre IA téléphonique, nommé "Pam Mark II."

## Installation

```bash
git clone https://github.com/USER/pam_markII.git
cd pam_markII
npm install
cp .env.example .env
# Puis éditez .env pour y mettre vos clés
npm start
