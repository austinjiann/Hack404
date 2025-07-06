import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY } from './geminiConfig';

export const gemini = new GoogleGenAI({ apiKey: GEMINI_API_KEY });