// services/tts-service.js
import { EventEmitter } from 'events';
import { Buffer } from 'node:buffer';
import fetch from 'node-fetch';
import 'colors';

export class TextToSpeechService extends EventEmitter {
  constructor() {
    super();
  }

  async generate(gptReply, interactionCount) {
    const { partialResponseIndex, partialResponse } = gptReply;
    if (!partialResponse) return;

    try {
      // Hypothèse d'une API TTS openai
      const response = await fetch('https://api.openai.com/v1/audio/tts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: partialResponse,
          voice_model: 'openai-voice-sample',
          format: 'mulaw-8000'
        })
      });

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const base64String = Buffer.from(arrayBuffer).toString('base64');

        // Emettre 'speech' pour StreamService
        this.emit('speech', partialResponseIndex, base64String, partialResponse, interactionCount);
      } else {
        console.log('OpenAI TTS error:', response.status, response.statusText);
      }
    } catch (err) {
      console.error('Error in TTS generate =>', err);
    }
  }
}
