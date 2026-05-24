import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { envs } from '../../config/env';
import type { Category, Priority } from '../../../generated/prisma';

/**
 * Sortida estructurada que esperem del model. Si Gemini retorna camps fora
 * d'aquest format, el node de regles s'encarregarà de normalitzar.
 */
export interface ClassificationOutput {
  category: Category;
  priority: Priority;
  summary: string;
}

/**
 * Llista d'opcions exposada a l'LLM. Mantinguda manualment per:
 *  - Donar un nom humà a cada categoria (millora la precisió de Gemini).
 *  - Permetre afegir descripció / pistes sense haver de tocar la migració.
 */
const CATEGORY_HINTS: Record<Category, string> = {
  LIGHTING: 'enllumenat públic, fanals, làmpades, tubs trencats',
  URBAN_FURNITURE: 'mobiliari urbà — bancs, papereres, baranes, cartelleres',
  PAVEMENT: 'pavimentació — voreres, asfalt, escales, llambordes',
  CLEANING: 'neteja — escombraries, pintades, residus al carrer',
  GREEN_AREAS: 'zones verdes — arbres, gespa, parterres, sots',
  SIGNAGE: 'senyalització — semàfors, senyals de trànsit, indicadors',
  ACCESSIBILITY: 'accessibilitat — rampes, vorades, accés per a mobilitat reduïda',
  TECHNOLOGY: 'tecnologia — pantalles, sensors, equipament digital al carrer',
  OTHER: 'qualsevol cosa que no encaixi clarament a les categories anteriors',
};

const PRIORITY_HINTS: Record<Priority, string> = {
  LOW: 'estètic o sense impacte funcional immediat',
  MEDIUM: "molèstia normal, cal arreglar però no urgent",
  HIGH: 'afecta seguretat o servei de manera significativa',
  CRITICAL: 'risc immediat per a persones o servei aturat completament',
};

/**
 * Construeix el prompt del sistema. Inclou totes les categories i prioritats
 * disponibles, instruccions explícites perquè el model retorni JSON, i
 * orientació sobre com tractar la categoria que hagi triat l'usuari.
 *
 * El "user-suggested category" entra com a hint, no com a ordre. L'IA pot
 * confirmar-la o sobreescriure-la si la imatge / text indiquen una altra cosa.
 */
const buildSystemPrompt = (): string => {
  const cats = (Object.keys(CATEGORY_HINTS) as Category[])
    .map((k) => `  - ${k}: ${CATEGORY_HINTS[k]}`)
    .join('\n');
  const prios = (Object.keys(PRIORITY_HINTS) as Priority[])
    .map((k) => `  - ${k}: ${PRIORITY_HINTS[k]}`)
    .join('\n');

  return `Ets un assistent de classificació d'incidències urbanes per a CityFix, una plataforma del campus universitari.

La teva tasca és, donada una incidència (títol, descripció, opcionalment una imatge i una categoria que ha triat l'usuari), determinar:
  1. La categoria correcta (potser cal corregir la de l'usuari si té errors)
  2. La prioritat real basada en l'impacte i la seguretat
  3. Un resum d'una sola línia (màxim 100 caràcters) per al panell d'admin

Categories disponibles:
${cats}

Prioritats disponibles:
${prios}

INSTRUCCIONS:
- Si la categoria triada per l'usuari és coherent amb el text/imatge, mantén-la.
- Si la imatge mostra clarament una cosa diferent, sobreescriu-la.
- Per a la prioritat, sigues conservador: només marca CRITICAL si hi ha risc clar (cables, perill de caiguda, accés bloquejat). HIGH per a coses que afecten seguretat o el servei. MEDIUM és el default raonable.
- El resum ha de ser concret i en català, no una repetició literal del títol.

Respon NOMÉS amb un objecte JSON vàlid amb aquesta forma exacta:
{"category": "<UNA_DE_LES_CATEGORIES>", "priority": "<UNA_DE_LES_PRIORITATS>", "summary": "<text breu>"}

Cap text abans ni després del JSON. Cap markdown.`;
};

/**
 * Crida directa a Gemini 2.0 Flash via LangChain. Es passa per parametre el
 * que sap el sistema sobre la incidència; tornem la sortida en cru (raw
 * string) perquè el node de regles la normalitzi i validi després.
 */
export const classifyWithGemini = async (params: {
  title: string;
  description: string;
  userCategory: Category | null;
  imageUrl: string | null;
}): Promise<string> => {
  if (!envs.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY no configurada');
  }

  // Gemini 2.0 Flash: ràpid, generós al free tier (15 RPM, 1500 RPD), suporta
  // visió. Temperatura baixa perquè volem classificacions consistents, no
  // creativitat.
  const model = new ChatGoogleGenerativeAI({
    apiKey: envs.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    temperature: 0.1,
    maxRetries: 2,
  });

  // Construïm el contingut del missatge humà. Quan hi ha imatge, fem servir
  // el format multimodal de LangChain (array d'objectes amb type 'text' i
  // type 'image_url').
  const userText = [
    `Títol: ${params.title}`,
    `Descripció: ${params.description}`,
    `Categoria triada per l'usuari: ${params.userCategory ?? 'cap'}`,
  ].join('\n');

  const humanContent: any[] = [{ type: 'text', text: userText }];
  if (params.imageUrl) {
    humanContent.push({
      type: 'image_url',
      image_url: params.imageUrl,
    });
  }

  const messages = [
    new SystemMessage(buildSystemPrompt()),
    new HumanMessage({ content: humanContent }),
  ];

  const response = await model.invoke(messages);
  // `response.content` pot ser string o array (multipart). En el nostre cas
  // (text-only response) és string.
  return typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);
};
