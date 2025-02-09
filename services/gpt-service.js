// services/gpt-service.js
import { EventEmitter } from 'events';
import OpenAI from 'openai';

export class GptService extends EventEmitter {
  constructor() {
    super();
    // On initialise OpenAI avec la clé stockée dans .env
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.partialResponseIndex = 0;
  }

  /**
   * Appelle le modèle GPT-4o en créant une complétion chat
   * @param {string} userText - Le texte envoyé par l'utilisateur
   * @param {number} interactionCount - Compteur ou identifiant d'interaction
   */
  async completion(userText, interactionCount) {
    try {
      // Exemple minimal, basé sur le snippet officiel OpenAI
      // On peut ajuster selon vos besoins (messages, store, etc.)
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',       // ou autre modèle ex. 'gpt-4o-mini'
        messages: [
          { role: 'developer', content: 'You are a helpful assistant.' },
          { role: 'user', content: userText }
        ],
        store: true            // cf. snippet fourni (stocke la conversation côté OpenAI)
      });

      // Récupération du texte de la réponse
      const text = completion.choices[0].message.content;
      console.log('GPT =>', text);

      // Si vous voulez découper la réponse en symboles "•" pour TTS chunking :
      const splitted = text.split('•');
      for (const segment of splitted) {
        if (segment.trim().length > 0) {
          const gptReply = {
            partialResponseIndex: this.partialResponseIndex,
            partialResponse: segment.trim()
          };
          // On émet un événement 'gptreply' => TTS
          this.emit('gptreply', gptReply, interactionCount);
          this.partialResponseIndex++;
        }
      }

    } catch (error) {
      console.error('Error in GptService completion:', error);
    }
  }
}
