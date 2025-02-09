// services/gpt-service.js
import { EventEmitter } from 'events';
import { Configuration, OpenAIApi } from 'openai';
import 'colors';

export class GptService extends EventEmitter {
  constructor() {
    super();
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.openai = new OpenAIApi(configuration);

    this.userContext = [
      {
        role: 'system',
        content: 'You are Pam Mark II, an AI specialized in e-commerce and energy providers. Keep answers brief, friendly, etc.'
      }
    ];
    this.partialResponseIndex = 0;
  }

  async completion(userText, interactionCount, role = 'user') {
    this.userContext.push({ role, content: userText });

    try {
      const response = await this.openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages: this.userContext
      });

      const text = response.data.choices[0].message.content;
      console.log(`GPT => ${text}`.green);

      // On coupe la réponse avec un symbole "•" ou autre
      // Si pas besoin, on peut juste tout envoyer d'un coup
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

      // Ajouter la réponse finale au contexte
      this.userContext.push({ role: 'assistant', content: text });

    } catch (err) {
      console.error('Error in GPT completion => ', err);
    }
  }
}
