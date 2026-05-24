import { Category, Priority } from '../../../generated/prisma';
import type { ClassificationOutput } from './llm';

/**
 * Conjunt de valors vàlids per validar la sortida de l'LLM. Si Gemini ens
 * retorna alguna cosa fora del whitelist (per error o per al·lucinació),
 * fem fallback a un default raonable en lloc de propagar dades corruptes.
 */
const VALID_CATEGORIES = new Set<string>(Object.values(Category));
const VALID_PRIORITIES = new Set<string>(Object.values(Priority));

/**
 * Parseja la resposta cru del model i normalitza els camps.
 *
 * Per què aquest node existeix:
 *  - Els LLMs de vegades retornen JSON dins d'un bloc de markdown ```json...```.
 *    Cal extreure'l.
 *  - De vegades retornen valors en minúscula o amb apòstrofs estranys.
 *  - De vegades inventen categories que no existeixen ("HOLES", "DAMAGE", etc).
 *  - El resum pot ser massa llarg.
 *
 * Aquesta capa converteix "el model probabilístic" en "dades estrictes que
 * pots desar a Postgres sense por". És l'antítesi del LLM: tot determinista.
 */
export const parseAndValidate = (raw: string): ClassificationOutput => {
  const cleaned = stripMarkdown(raw).trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Si el JSON no parseja, retornem un fallback segur. La resta del sistema
    // ja segueix endavant amb defaults raonables.
    return defaultOutput();
  }

  const category = normalizeCategory(parsed.category);
  const priority = normalizePriority(parsed.priority);
  const summary = normalizeSummary(parsed.summary);

  return { category, priority, summary };
};

/**
 * Treu el wrapping ```json ... ``` o ``` ... ``` que afegeix de vegades
 * Gemini al voltant de la sortida. Si no hi ha wrapping, retorna el text tal qual.
 */
const stripMarkdown = (raw: string): string => {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1]! : raw;
};

const normalizeCategory = (value: unknown): Category => {
  if (typeof value !== 'string') return Category.OTHER;
  const upper = value.toUpperCase().trim();
  return VALID_CATEGORIES.has(upper) ? (upper as Category) : Category.OTHER;
};

const normalizePriority = (value: unknown): Priority => {
  if (typeof value !== 'string') return Priority.MEDIUM;
  const upper = value.toUpperCase().trim();
  return VALID_PRIORITIES.has(upper) ? (upper as Priority) : Priority.MEDIUM;
};

const normalizeSummary = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  // Cap > 100 chars perquè cap al UI sense trencar layouts.
  const trimmed = value.trim();
  return trimmed.length > 100 ? `${trimmed.slice(0, 97)}…` : trimmed;
};

const defaultOutput = (): ClassificationOutput => ({
  category: Category.OTHER,
  priority: Priority.MEDIUM,
  summary: '',
});
