// services/transcription-service.js
import { EventEmitter } from 'events';
import 'colors';

export class TranscriptionService extends EventEmitter {
  constructor() {
    super();
    // config pour openai stt
    // ex: this.wsOpenAiStt = ...
  }

  send(payloadBase64) {
    // Envoyer le payload à un STT openai “realtime”
    // A défaut, chunk par chunk => Whisper transcriptions
    // Lorsque c'est final, on fait:
    // this.emit('transcription', "Texte final");
  }
}
