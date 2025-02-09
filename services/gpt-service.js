// services/gpt-service.js
import { EventEmitter } from 'events';
import OpenAI from 'openai'; // v4 syntax
import 'colors';

export class GptService extends EventEmitter {
  constructor() {
    super();

    // Instancie la classe OpenAI en lui passant la clé
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Stocke le contexte de conversation
    this.userContext = [
      {
        role: 'system',
        content: 'You are Pam Mark II, an AI specialized in e-commerce and energy providers. Keep answers short and helpful.'
      }
    ];
    this.partialResponseIndex = 0;
  }

  async completion(userText, interactionCount, role = 'user') {
    // Ajoute la requête de l'utilisateur au contexte
    this.userContext.push({ role, content: userText });

    try {
      // Appel chat completions
      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo', // ou 'gpt-4'
        messages: this.userContext
        // Pas de stream = on reçoit la réponse d'un coup
      });

      const text = response.choices[0].message.content;
      console.log(`GPT => ${text}`.green);

      // On coupe la réponse en symboles "•" si vous voulez un chunk TTS
      const splitted = text.split('•');
      for (const segment of splitted) {
        if (segment.trim().length > 0) {
          const gptReply = {
            partialResponseIndex: this.partialResponseIndex,
            partialResponse: segment.trim()
          };
          this.emit('gptreply', gptReply, interactionCount);
          this.partialResponseIndex++;
        }
      }

      // Ajoute la réponse finale au contexte
      this.userContext.push({ role: 'assistant', content: text });

    } catch (err) {
      console.error('Error in GPT completion => ', err);
    }
  }
}
